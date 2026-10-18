"""Persistent local JSON-lines bridge for the native Big Hack UI.

Only snapshots, reconnect, detach and the named feature actions are accepted. All game
access is limited to the audited Big Walk executable and verified build.
"""
import importlib.util
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
import uuid

sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
sys.stdin.reconfigure(encoding="utf-8", errors="strict")

HERE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location("big_walk_pickup_helper", HERE / "Big-Walk-Pickup.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
from big_walk_paths import EXPECTED_HASHES, UnsupportedBuild
OUTPUT_LOCK = threading.Lock()


def emit(event):
    with OUTPUT_LOCK:
        print(json.dumps(event, ensure_ascii=False, allow_nan=False), flush=True)


def main():
    commands = queue.Queue()
    messages = queue.Queue()
    stopped = threading.Event()

    def stdin_reader():
        for line in sys.stdin:
            try:
                command = json.loads(line)
                if isinstance(command, dict):
                    commands.put(command)
            except Exception:
                emit({"type": "status", "state": "error", "message": "Invalid local command"})
        stopped.set()

    threading.Thread(target=stdin_reader, daemon=True).start()
    frida = helper.import_frida()
    device = frida.get_local_device()
    session = script = None
    generation = ""
    pid = None
    paused = False
    last_scan = last_status = 0
    pending = {}
    build_checks = {}  # file signature -> None when supported, else the warning

    def check_build(game_dir):
        nonlocal last_status
        signature = tuple((str(game_dir / p), (game_dir / p).stat().st_mtime_ns) for p in EXPECTED_HASHES)
        if signature not in build_checks:
            emit({"type": "status", "state": "checking", "message": "Checking the installed game version…"})
            try:
                helper.verify_game_build(game_dir)
                build_checks[signature] = None
            except UnsupportedBuild as error:
                build_checks[signature] = str(error)
            last_status = 0  # Replace the "checking" status on this scan.
        return build_checks[signature]

    try:
        install_dir = helper.find_game_directory()
    except Exception:
        install_dir = None  # Located from the running process instead.

    def disconnect():
        nonlocal session, script, pid, generation
        if script:
            try:
                restore = script.exports_sync.prepare_detach()
                if restore.get("pending"):
                    deadline = time.monotonic() + 6
                    while time.monotonic() < deadline:
                        token, event = messages.get(timeout=max(0.01, deadline-time.monotonic()))
                        if token == generation and event.get("type") == "settings_restored":
                            if not event.get("ok"):
                                emit({"type":"status","state":"error","message":event.get("message", "Could not restore character settings")})
                            break
                    else:
                        emit({"type":"status","state":"error","message":"Character settings restore timed out. Re-enter the session to reset them."})
            except queue.Empty:
                emit({"type":"status","state":"error","message":"Character settings restore timed out. Re-enter the session to reset them."})
            except Exception:
                pass  # A closed game has no live values to restore.
        generation = ""
        for req_id in list(pending):
            emit({"type": "action_result", "request_id": req_id, "ok": False, "message": "Game disconnected before the result arrived. Check the game before retrying."})
        pending.clear()
        if script:
            try:
                script.unload()
            except Exception:
                pass
        if session:
            try:
                session.detach()
            except Exception:
                pass
        session = script = pid = None

    def on_message(message, data, token):
        payload = message.get("payload", message)
        messages.put((token, payload))

    emit({"type": "status", "state": "searching", "message": "Looking for Big Walk.exe…"})
    try:
        while not stopped.is_set():
            now = time.monotonic()
            try:
                while True:
                    command = commands.get_nowait()
                    kind = command.get("type")
                    if kind == "shutdown":
                        stopped.set()
                        break
                    if kind == "pause":
                        paused = True
                        disconnect()
                        emit({"type": "status", "state": "paused", "message": "Detached. Press reconnect to resume scanning."})
                    elif kind == "reconnect":
                        paused = False
                        disconnect()
                        last_scan = 0
                    elif kind == "held_heartbeat":
                        if script and command.get("generation") == generation:
                            try:
                                script.exports_sync.held_heartbeat(command)
                            except Exception:
                                pass  # Missing heartbeats let the Unity-thread lease expire.
                    elif kind == "cancel":
                        req_id = command.get("request_id", "")
                        if script and req_id in pending:
                            try:
                                result = script.exports_sync.cancel_pending(req_id)
                                if result.get("queued_cancelled"):
                                    pending.pop(req_id, None)
                                    emit({"type":"action_result", "request_id":req_id, "ok":False, "message":"Action cancelled before execution."})
                            except Exception as error:
                                emit({"type":"status", "state":"error", "message":str(error)})
                    elif kind == "action":
                        req_id = command.get("request_id", "")
                        if not script or command.get("generation") != generation or not req_id or pending:
                            emit({"type": "action_result", "request_id": req_id, "ok": False, "message": "Connection changed or an action is busy. Wait for a fresh snapshot."})
                            continue
                        try:
                            if command.get("action") == "grab_all_items":
                                selected_items = command.get("items", [])
                                if not isinstance(selected_items, list):
                                    raise RuntimeError("Invalid item selection")
                                item_count = len(selected_items)
                                if not 1 <= item_count <= 4096:
                                    raise RuntimeError("Invalid item count")
                                timeout = item_count * 4 + 8
                            else:
                                timeout = 47 if command.get("target_kind") == "fun" else 8
                            result = script.exports_sync.enqueue(command)
                            if not result.get("ok"):
                                raise RuntimeError(result.get("reason", "Action was not queued"))
                            pending[req_id] = (now, timeout)
                        except Exception as error:
                            emit({"type": "action_result", "request_id": req_id, "ok": False, "message": str(error)})
            except queue.Empty:
                pass
            try:
                while True:
                    token, event = messages.get_nowait()
                    if token != generation:
                        continue
                    kind = event.get("type")
                    if kind == "snapshot" and "sequence" in event:
                        emit({**event, "generation": generation, "pid": pid})
                        last_status = now
                    elif kind == "action_result":
                        pending.pop(event.get("request_id"), None)
                        emit(event)
                    elif kind == "action_progress":
                        if event.get("request_id") in pending:
                            if event.get("action") == "clear_corpses":
                                total = event.get("total")
                                if isinstance(total, int) and not isinstance(total, bool) and 1 <= total <= 4096:
                                    began, _ = pending[event["request_id"]]
                                    pending[event["request_id"]] = (began, total * 4 + 8)
                            emit(event)
                    elif kind in {"error", "telemetry_error"}:
                        emit({"type": "status", "state": "error", "message": event.get("message", event.get("description", "Telemetry read failed")), "pid": pid})
                    elif kind == "detached":
                        disconnect()
                        emit({"type": "status", "state": "searching", "message": "Big Walk closed. Waiting for the next launch…"})
            except queue.Empty:
                pass
            for req_id, (began, timeout) in list(pending.items()):
                if now - began > timeout:
                    try:
                        script.exports_sync.cancel_pending(req_id)
                    except Exception:
                        pass
                    pending.pop(req_id, None)
                    emit({"type": "action_result", "request_id": req_id, "ok": False, "message": "Action timed out; it may have run if the result was lost. Check the game before retrying."})
            if not paused and session is None and now - last_scan >= 1:
                last_scan = now
                try:
                    matches = [p for p in device.enumerate_processes() if p.name.casefold() == "big walk.exe"]
                    if len(matches) > 1:
                        raise RuntimeError("Multiple Big Walk processes found. Close the extra client to attach.")
                    if not matches:
                        warning = check_build(install_dir) if install_dir else None
                        if now - last_status > 3:
                            if warning:
                                emit({"type": "status", "state": "unsupported", "message": warning})
                            else:
                                emit({"type": "status", "state": "searching", "message": "Waiting for Big Walk. Launch the game to connect automatically."})
                            last_status = now
                    else:
                        process = matches[0]
                        game_dir = helper.find_game_directory(process.pid)
                        warning = check_build(game_dir)
                        if warning:
                            if now - last_status > 3:
                                emit({"type": "status", "state": "unsupported", "message": warning})
                                last_status = now
                        else:
                            pid = process.pid
                            generation = uuid.uuid4().hex
                            token = generation
                            session = device.attach(pid)
                            session.on("detached", lambda *args, token=token: messages.put((token, {"type": "detached"})))
                            modules = ("you_settings.js", "fun_actions.js", "telemetry.js", "character_tools.js", "camera_tools.js", "location_tools.js", "pocket_tools.js", "flare_tools.js")
                            script = session.create_script(helper.JS + "\n" + "\n".join((HERE / name).read_text(encoding="utf-8") for name in modules))
                            script.on("message", lambda message, data, token=token: on_message(message, data, token))
                            script.load()
                            emit({"type": "status", "state": "attached", "message": "Attached to Big Walk. Waiting for your character…", "pid": pid, "generation": generation})
                            last_status = now
                except Exception as error:
                    disconnect()
                    emit({"type": "status", "state": "error", "message": str(error)})
                    last_scan = now + 3
            stopped.wait(0.025)
    finally:
        disconnect()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"type": "status", "state": "error", "message": str(error)})
        raise SystemExit(1)
