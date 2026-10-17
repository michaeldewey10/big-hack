"""Bounded live-roster reader and one-at-a-time Big Walk command runner."""

import argparse
import importlib
import json
import os
from pathlib import Path
import queue
import sys
import time
from big_walk_commands import COMMANDS_BY_KEY, validate_arguments
from big_walk_paths import find_game_directory, verify_game_build


def import_frida():
    try:
        return importlib.import_module("frida")
    except ImportError:
        user_profile = Path(os.environ.get("USERPROFILE", str(Path.home())))
        bundled = user_profile / "Documents" / "Codex" / "2026-10-11" / "c-program-files-x86-steam-steamapps" / "work" / "pydeps"
        if bundled.exists():
            sys.path.insert(0, str(bundled))
            return importlib.import_module("frida")
        raise RuntimeError("Frida is unavailable. Use the supplied GUI launcher.")


JS = r"""
const mod = Process.getModuleByName('GameAssembly.dll');
function exp(name) {
  const address = mod.findExportByName(name);
  if (!address) throw new Error('Missing IL2CPP export: ' + name);
  return address;
}
const domainGet = new NativeFunction(exp('il2cpp_domain_get'), 'pointer', []);
const threadAttach = new NativeFunction(exp('il2cpp_thread_attach'), 'pointer', ['pointer']);
const domainGetAssemblies = new NativeFunction(exp('il2cpp_domain_get_assemblies'), 'pointer', ['pointer', 'pointer']);
const assemblyGetImage = new NativeFunction(exp('il2cpp_assembly_get_image'), 'pointer', ['pointer']);
const imageGetName = new NativeFunction(exp('il2cpp_image_get_name'), 'pointer', ['pointer']);
const classFromName = new NativeFunction(exp('il2cpp_class_from_name'), 'pointer', ['pointer', 'pointer', 'pointer']);
const fieldFromName = new NativeFunction(exp('il2cpp_class_get_field_from_name'), 'pointer', ['pointer', 'pointer']);
const fieldStaticGet = new NativeFunction(exp('il2cpp_field_static_get_value'), 'void', ['pointer', 'pointer']);
const methodFromName = new NativeFunction(exp('il2cpp_class_get_method_from_name'), 'pointer', ['pointer', 'pointer', 'int']);
const runtimeInvoke = new NativeFunction(exp('il2cpp_runtime_invoke'), 'pointer', ['pointer', 'pointer', 'pointer', 'pointer']);
const stringNew = new NativeFunction(exp('il2cpp_string_new'), 'pointer', ['pointer']);

const domain = domainGet();
if (domain.isNull()) throw new Error('IL2CPP domain is unavailable');
threadAttach(domain);
const countBuffer = Memory.alloc(4);
const assemblies = domainGetAssemblies(domain, countBuffer);
const assemblyCount = countBuffer.readU32();
let gameImage = ptr(0);
for (let i = 0; i < assemblyCount; i++) {
  const assembly = assemblies.add(i * Process.pointerSize).readPointer();
  const image = assemblyGetImage(assembly);
  const namePointer = imageGetName(image);
  const name = namePointer.isNull() ? '' : namePointer.readCString();
  if (name === 'Assembly-CSharp.dll') gameImage = image;
}
if (gameImage.isNull()) throw new Error('Assembly-CSharp.dll was not found');

const pcClass = classFromName(gameImage, Memory.allocUtf8String(''), Memory.allocUtf8String('PlayerCharacter'));
const pnClass = classFromName(gameImage, Memory.allocUtf8String(''), Memory.allocUtf8String('PlayerNetworking'));
if (pcClass.isNull() || pnClass.isNull()) throw new Error('Player classes were not found');
const allCharsField = fieldFromName(pcClass, Memory.allocUtf8String('allPlayerCharacters'));
const cmdMethod = methodFromName(pnClass, Memory.allocUtf8String('CmdPickUpPlayer'), 1);
const updateMethod = methodFromName(pcClass, Memory.allocUtf8String('Update'), 0);
if (allCharsField.isNull() || cmdMethod.isNull() || updateMethod.isNull()) throw new Error('Pickup field or method was not found');
const cmdAddress = cmdMethod.readPointer();
const updateAddress = updateMethod.readPointer();
if (cmdAddress.isNull() || updateAddress.isNull()) throw new Error('Pickup native method address is unavailable');
const peckClass = classFromName(gameImage, Memory.allocUtf8String(''), Memory.allocUtf8String('PeckEffectTextInput'));
const peckListField = peckClass.isNull() ? ptr(0) : fieldFromName(peckClass, Memory.allocUtf8String('allPeckTexts'));

function readString(object, maximumLength) {
  if (object.isNull()) return null;
  const length = object.add(0x10).readS32();
  const maximum = Number.isInteger(maximumLength) ? maximumLength : 256;
  if (length < 0 || length > maximum) return '<invalid-string-length:' + length + '>';
  return object.add(0x14).readUtf16String(length);
}

function getCharacters() {
  const valueBuffer = Memory.alloc(Process.pointerSize);
  fieldStaticGet(allCharsField, valueBuffer);
  const list = valueBuffer.readPointer();
  if (list.isNull()) return [];
  const size = list.add(0x18).readS32();
  const items = list.add(0x10).readPointer();
  if (size < 0 || size > 32 || items.isNull()) throw new Error('Unexpected live player list');
  const arrayLength = items.add(0x18).readS32();
  if (arrayLength < size || arrayLength > 64) throw new Error('Unexpected player array length');
  const result = [];
  for (let i = 0; i < size; i++) {
    const pc = items.add(0x20 + i * Process.pointerSize).readPointer();
    if (!pc.isNull()) result.push(pc);
  }
  return result;
}

function describePlayers() {
  return getCharacters().map(pc => {
    const pn = pc.add(0x1a0).readPointer();
    const networkIdentity = pn.isNull() ? ptr(0) : pn.add(0x40).readPointer();
    const name = pn.isNull() ? null : readString(pn.add(0x100).readPointer());
    const backReference = pn.isNull() ? ptr(0) : pn.add(0x70).readPointer();
    const caster = pc.add(0xe0).readPointer();
    return {
      pc: pc.toString(),
      pn: pn.toString(),
      name,
      backrefMatches: !pn.isNull() && backReference.equals(pc),
      isLocalPlayer: !networkIdentity.isNull() && networkIdentity.add(0x22).readU8() !== 0,
      isOwned: !networkIdentity.isNull() && networkIdentity.add(0x23).readU8() !== 0,
      controlsVelocity: pn.isNull() ? null : [pn.add(0xd8).readFloat(), pn.add(0xdc).readFloat(), pn.add(0xe0).readFloat()],
      pickupRange: caster.isNull() ? null : caster.add(0x10).readFloat(),
      pickupRangeUp: caster.isNull() ? null : caster.add(0x14).readFloat()
    };
  });
}

function describeTextInputs() {
  if (peckListField.isNull()) return [];
  const valueBuffer = Memory.alloc(Process.pointerSize);
  fieldStaticGet(peckListField, valueBuffer);
  const list = valueBuffer.readPointer();
  if (list.isNull()) return [];
  const size = list.add(0x18).readS32();
  const items = list.add(0x10).readPointer();
  if (size < 0 || size > 2048 || items.isNull()) throw new Error('Unexpected active sign list');
  const arrayLength = items.add(0x18).readS32();
  if (arrayLength < size || arrayLength > 4096) throw new Error('Unexpected active sign array length');
  const result = [];
  for (let i = 0; i < size; i++) {
    const component = items.add(0x20 + i * Process.pointerSize).readPointer();
    if (!component.isNull()) result.push({
      index: i,
      component: component.toString(),
      text: readString(component.add(0xa8).readPointer(), 500),
      author: readString(component.add(0xb0).readPointer(), 256)
    });
  }
  return result;
}

let players = [];
let textInputs = [];
let textInputsError = null;
let readError = null;
try { players = describePlayers(); } catch (error) { readError = String(error); }
try { textInputs = describeTextInputs(); } catch (error) { textInputsError = String(error); }
send({
  type: 'snapshot',
  players,
  textInputs,
  textInputsError,
  error: readError,
  pid: Process.id,
  commandRva: ptr(cmdAddress).sub(mod.base).toString()
});

let armed = false;
let fired = false;
let listener = null;
let senderPc = ptr(0);
let senderPn = ptr(0);
let targetPc = ptr(0);
let targetName = '';
rpc.exports = {
  arm: function(senderText, targetText, selectedName) {
    if (armed || fired) return {ok: false, reason: 'This run has already been armed'};
    if (typeof selectedName !== 'string' || selectedName.length < 1 || selectedName.length > 256) {
      return {ok: false, reason: 'Selected player name is invalid'};
    }
    const current = describePlayers();
    const owners = current.filter(p => p.isLocalPlayer && p.isOwned && p.backrefMatches);
    const senders = owners.filter(p => p.pc === senderText);
    const targets = current.filter(p =>
      p.pc === targetText &&
      !p.isLocalPlayer &&
      typeof p.name === 'string' &&
      p.name.toLowerCase() === selectedName.toLowerCase() &&
      p.backrefMatches
    );
    if (senders.length !== 1 || targets.length !== 1 || senders[0].pc === targets[0].pc) {
      return {ok: false, reason: 'The selected target or locally owned sender changed; refresh the roster'};
    }
    senderPc = ptr(senderText);
    targetPc = ptr(targetText);
    senderPn = ptr(senders[0].pn);
    targetName = selectedName;

    const command = new NativeFunction(cmdAddress, 'void', ['pointer', 'pointer', 'pointer'], 'win64');
    armed = true;
    listener = Interceptor.attach(updateAddress, {
      onEnter(args) {
        if (!armed || fired || !args[0].equals(senderPc)) return;
        try {
          const latest = describePlayers();
          const sender = latest.filter(p =>
            p.pc === senderPc.toString() &&
            p.pn === senderPn.toString() &&
            p.isLocalPlayer &&
            p.isOwned &&
            p.backrefMatches
          );
          const target = latest.filter(p =>
            p.pc === targetPc.toString() &&
            !p.isLocalPlayer &&
            typeof p.name === 'string' &&
            p.name.toLowerCase() === targetName.toLowerCase() &&
            p.backrefMatches
          );
          if (sender.length !== 1 || target.length !== 1 || sender[0].pc === target[0].pc) {
            armed = false;
            fired = true;
            listener.detach();
            send({type: 'not_sent', reason: 'Sender or selected player changed before invocation'});
            return;
          }
          const commandResult = command(senderPn, targetPc, cmdMethod);
          armed = false;
          fired = true;
          listener.detach();
          send({
            type: 'invoked_once',
            sender: sender[0],
            target: target[0],
            commandHash: '0x8E2DC22B',
            commandRva: ptr(cmdAddress).sub(mod.base).toString()
          });
        } catch (error) {
          armed = false;
          fired = true;
          if (listener) listener.detach();
          send({type: 'invoke_error', error: String(error)});
        }
      }
    });
    return {ok: true, scheduled: true};
  },
  armCommand: function(senderText, commandKey, argsJson, instanceKind, instanceText, instanceIndex) {
    if (armed || fired) return {ok: false, reason: 'This run has already been armed'};
    if (typeof commandKey !== 'string' || commandKey.length > 256 ||
        typeof argsJson !== 'string' || argsJson.length > 8192) {
      return {ok: false, reason: 'Command request is invalid'};
    }
    let request;
    try { request = JSON.parse(argsJson); } catch (_) { return {ok: false, reason: 'Command arguments are not valid JSON'}; }
    if (!request || typeof request.method !== 'string' || !Array.isArray(request.args) ||
        request.args.length > 8 || !Number.isInteger(request.arity) || request.arity > 8 ||
        !Number.isInteger(request.trailingNullArgs) || request.trailingNullArgs < 0 || request.trailingNullArgs > 2 ||
        request.arity !== request.args.length + request.trailingNullArgs) {
      return {ok: false, reason: 'Command request shape is invalid'};
    }
    const current = describePlayers();
    const owners = current.filter(p => p.isLocalPlayer && p.isOwned && p.backrefMatches && p.pn === senderText);
    if (owners.length !== 1) return {ok: false, reason: 'The locally owned sender changed; refresh the roster'};

    let instance = ptr(0);
    let commandClass = ptr(0);
    if (instanceKind === 'player_networking') {
      instance = ptr(owners[0].pn);
      commandClass = pnClass;
    } else if (instanceKind === 'peck_text') {
      if (!Number.isInteger(instanceIndex) || typeof instanceText !== 'string') {
        return {ok: false, reason: 'Select an active sign from the refreshed list'};
      }
      const signs = describeTextInputs();
      const matches = signs.filter(item => item.index === instanceIndex && item.component === instanceText);
      if (matches.length !== 1) return {ok: false, reason: 'The selected sign changed; refresh the live list'};
      instance = ptr(matches[0].component);
      commandClass = peckClass;
    }
    if (instance.isNull() || commandClass.isNull()) return {ok: false, reason: 'A supported live command component was not found'};

    const method = methodFromName(commandClass, Memory.allocUtf8String(request.method), request.arity);
    if (method.isNull()) return {ok: false, reason: 'The selected command signature was not found in this running build'};
    const methodCode = method.readPointer();
    if (methodCode.isNull()) return {ok: false, reason: 'The selected command has no native wrapper address'};

    const argSlots = [];
    const argTypes = request.types;
    if (!Array.isArray(argTypes) || argTypes.length !== request.args.length) {
      return {ok: false, reason: 'Argument type list does not match'};
    }
    try {
      for (let i = 0; i < request.args.length; i++) {
        const type = argTypes[i];
        const value = request.args[i];
        let slot;
        if (type === 'bool') {
          slot = Memory.alloc(1); slot.writeU8(value ? 1 : 0);
        } else if (type === 'i32' || type === 'enum_i32') {
          slot = Memory.alloc(4); slot.writeS32(value);
        } else if (type === 'u16') {
          slot = Memory.alloc(2); slot.writeU16(value);
        } else if (type === 'u32') {
          slot = Memory.alloc(4); slot.writeU32(value);
        } else if (type === 'u64') {
          slot = Memory.alloc(8); slot.writeU64(uint64(value));
        } else if (type === 'unit_float' || type === 'f32' || type === 'f32_world') {
          slot = Memory.alloc(4); slot.writeFloat(value);
        } else if (type === 'bounded_double' || type === 'f64') {
          slot = Memory.alloc(8); slot.writeDouble(value);
        } else if (type === 'v2') {
          slot = Memory.alloc(8); slot.writeFloat(value[0]); slot.add(4).writeFloat(value[1]);
        } else if (type === 'v3' || type === 'v3_world') {
          slot = Memory.alloc(12); slot.writeFloat(value[0]); slot.add(4).writeFloat(value[1]); slot.add(8).writeFloat(value[2]);
        } else if (type === 'string' || type === 'sign_text' || type === 'short_string') {
          const managedString = stringNew(Memory.allocUtf8String(value));
          if (managedString.isNull()) throw new Error('Could not allocate managed string');
          slot = managedString;
        } else if (type === 'player') {
          const player = current.filter(p => p.pc === value && !p.isLocalPlayer && p.backrefMatches);
          if (player.length !== 1) throw new Error('Selected remote player changed; refresh the roster');
          slot = ptr(player[0].pc);
        } else {
          throw new Error('Unsupported argument type: ' + type);
        }
        argSlots.push(slot);
      }
      for (let i = 0; i < request.trailingNullArgs; i++) {
        argSlots.push(ptr(0));
      }
    } catch (error) {
      return {ok: false, reason: String(error)};
    }

    const parameters = Memory.alloc(Math.max(1, argSlots.length) * Process.pointerSize);
    for (let i = 0; i < argSlots.length; i++) parameters.add(i * Process.pointerSize).writePointer(argSlots[i]);
    const exceptionBuffer = Memory.alloc(Process.pointerSize);
    exceptionBuffer.writePointer(ptr(0));
    armed = true;
    listener = Interceptor.attach(updateAddress, {
      onEnter(args) {
        if (!armed || fired || !args[0].equals(ptr(owners[0].pc))) return;
        let invokeStage = 'recheck_sender';
        try {
          const latest = describePlayers();
          const senderMatches = latest.filter(p => p.pc === owners[0].pc && p.pn === senderText && p.isLocalPlayer && p.isOwned && p.backrefMatches);
          if (senderMatches.length !== 1) {
            armed = false; fired = true; listener.detach();
            send({type: 'not_sent', reason: 'The locally owned sender changed before invocation'});
            return;
          }
          invokeStage = 'runtime_invoke';
          runtimeInvoke(method, instance, parameters, exceptionBuffer);
          invokeStage = 'read_exception';
          const managedException = exceptionBuffer.readPointer();
          armed = false; fired = true; listener.detach();
          if (!managedException.isNull()) {
            send({type: 'invoke_error', error: 'The managed command wrapper returned an exception'});
            return;
          }
          send({type: 'command_invoked_once', commandKey, method: request.method, instanceKind});
        } catch (error) {
          armed = false; fired = true;
          if (listener) listener.detach();
          send({type: 'invoke_error', stage: invokeStage, error: String(error)});
        }
      }
    });
    return {ok: true, scheduled: true};
  }
};
"""


def find_process(frida, requested_pid):
    device = frida.get_local_device()
    processes = device.enumerate_processes()
    if requested_pid:
        matches = [process for process in processes if process.pid == requested_pid]
        if len(matches) != 1 or "big walk" not in matches[0].name.casefold():
            raise RuntimeError(f"PID {requested_pid} is not a running Big Walk process")
        return device, matches[0]
    matches = [process for process in processes if process.name.casefold().removesuffix(".exe") == "big walk"]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one running Big Walk process; found {len(matches)}.")
    return device, matches[0]


def run(args):
    frida = import_frida()
    device, process = find_process(frida, args.pid)
    game_directory = find_game_directory(process.pid)
    verify_game_build(game_directory)
    session = device.attach(process.pid)
    script = session.create_script(JS)
    messages = queue.Queue()
    script.on("message", lambda message, data: messages.put(message.get("payload", message)))
    try:
        script.load()
        snapshot = messages.get(timeout=10)
        if snapshot.get("type") != "snapshot" or snapshot.get("error"):
            raise RuntimeError(snapshot.get("error") or "Could not read the live party roster")

        players = snapshot.get("players", [])
        if args.list_only:
            return {
                "ok": True,
                "type": "snapshot",
                "pid": process.pid,
                "players": players,
                "text_inputs": snapshot.get("textInputs", []),
                "text_inputs_error": snapshot.get("textInputsError"),
            }

        owners = [
            p for p in players
            if p.get("isLocalPlayer") and p.get("isOwned") and p.get("backrefMatches")
        ]
        targets = [
            p for p in players
            if p.get("pc") == args.target_pc
            and not p.get("isLocalPlayer")
            and isinstance(p.get("name"), str)
            and p["name"].casefold() == args.target_name.casefold()
            and p.get("backrefMatches")
        ]
        if len(owners) != 1 or len(targets) != 1 or owners[0]["pc"] == targets[0]["pc"]:
            raise RuntimeError(
                f"Selected target or sender is ambiguous or stale; no request sent "
                f"(senders={len(owners)}, selected matches={len(targets)})"
            )

        armed = script.exports_sync.arm(owners[0]["pc"], targets[0]["pc"], targets[0]["name"])
        if not armed.get("ok"):
            raise RuntimeError(f"{armed.get('reason', 'Live identity check failed')}; no request sent")

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = messages.get(timeout=max(0.1, deadline - time.monotonic()))
            if isinstance(result, dict) and result.get("type") in {"invoked_once", "not_sent", "invoke_error"}:
                if result.get("type") != "invoked_once":
                    raise RuntimeError(json.dumps(result, ensure_ascii=False))
                return {
                    "ok": True,
                    "type": "invoked_once",
                    "pid": process.pid,
                    "result": result,
                }
        raise RuntimeError("No local player update arrived in time; no request was sent")
    finally:
        try:
            script.unload()
        except Exception:
            pass
        try:
            session.detach()
        except Exception:
            pass


def run_command(args):
    command = COMMANDS_BY_KEY.get(args.command_key)
    if not command:
        raise RuntimeError("Command is not in the recovered catalog; no call was made")
    if not command.get("runnable"):
        raise RuntimeError(command.get("reason") or "Command has no safe typed runner; no call was made")
    try:
        supplied_values = json.loads(args.arguments)
    except (TypeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Invalid argument JSON: {error}; no call was made") from None
    values = validate_arguments(command, supplied_values)

    frida = import_frida()
    device, process = find_process(frida, args.pid)
    game_directory = find_game_directory(process.pid)
    verify_game_build(game_directory)
    session = device.attach(process.pid)
    script = session.create_script(JS)
    messages = queue.Queue()
    script.on("message", lambda message, data: messages.put(message.get("payload", message)))
    try:
        script.load()
        snapshot = messages.get(timeout=10)
        if snapshot.get("type") != "snapshot" or snapshot.get("error"):
            raise RuntimeError(snapshot.get("error") or "Could not read the live party roster")

        players = snapshot.get("players", [])
        owners = [
            player for player in players
            if player.get("isLocalPlayer") and player.get("isOwned") and player.get("backrefMatches")
        ]
        if len(owners) != 1:
            raise RuntimeError(f"Expected exactly one locally owned sender; found {len(owners)}. No call was made.")

        target_name = None
        target_pc = None
        for spec, value in zip(command["args"], values):
            if spec["kind"] == "player":
                target_pc = value
        if target_pc is not None:
            matches = [
                player for player in players
                if player.get("pc") == target_pc
                and not player.get("isLocalPlayer")
                and player.get("backrefMatches")
                and isinstance(player.get("name"), str)
                and player.get("name").casefold() == (args.target_name or "").casefold()
            ]
            if len(matches) != 1 or not args.target_name:
                raise RuntimeError("Selected remote player is stale or ambiguous; no call was made")
            target_name = matches[0]["name"]

        instance_pointer = ""
        instance_index = -1
        if command["instance"] == "peck_text":
            signs = snapshot.get("textInputs", [])
            matches = [
                sign for sign in signs
                if sign.get("index") == args.instance_index
                and sign.get("component") == args.instance_pointer
            ]
            if len(matches) != 1:
                reason = snapshot.get("textInputsError") or "Refresh the active sign list and select a live sign"
                raise RuntimeError(f"{reason}; no call was made")
            instance_pointer = matches[0]["component"]
            instance_index = matches[0]["index"]

        request = {
            "method": command["method"],
            "arity": command["arity"],
            "trailingNullArgs": command.get("trailing_null_args", 0),
            "args": values,
            "types": [spec["kind"] for spec in command["args"]],
        }
        armed = script.exports_sync.arm_command(
            owners[0]["pn"],
            command["key"],
            json.dumps(request, ensure_ascii=False, allow_nan=False),
            command["instance"],
            instance_pointer,
            instance_index,
        )
        if not armed.get("ok"):
            raise RuntimeError(f"{armed.get('reason', 'Live identity check failed')}; no call was made")

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = messages.get(timeout=max(0.1, deadline - time.monotonic()))
            if isinstance(result, dict) and result.get("type") in {
                "command_invoked_once", "not_sent", "invoke_error"
            }:
                if result.get("type") != "command_invoked_once":
                    raise RuntimeError(json.dumps(result, ensure_ascii=False))
                return {
                    "ok": True,
                    "type": "command_invoked_once",
                    "pid": process.pid,
                    "command": command["key"],
                    "target": target_name,
                    "instance_index": instance_index if command["instance"] == "peck_text" else None,
                    "result": result,
                    "note": "The local Mirror command wrapper returned; this does not confirm host-side acceptance or effect.",
                }
        raise RuntimeError("No local player update arrived in time; no call was sent")
    finally:
        try:
            script.unload()
        except Exception:
            pass
        try:
            session.detach()
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Read Big Walk's live party or send one selected pickup request.")
    parser.add_argument("--pid", type=int, default=0, help="Optional Big Walk process ID")
    parser.add_argument("--list", dest="list_only", action="store_true", help="Read the current roster without sending a command")
    parser.add_argument("--target-name", help="Exact live roster name selected by the GUI")
    parser.add_argument("--target-pc", help="Live player object identity from the refreshed roster")
    parser.add_argument("--command", dest="command_key", help="One command catalog key to invoke once")
    parser.add_argument("--arguments", default="[]", help="JSON array of typed values for the selected command")
    parser.add_argument("--instance-index", type=int, default=-1, help="Internal active-sign list index")
    parser.add_argument("--instance-pointer", default="", help="Internal refreshed sign object identity")
    parser.add_argument("--json", action="store_true", help="Print a single JSON result for the GUI")
    args = parser.parse_args()

    if args.command_key:
        if args.list_only or bool(args.target_pc) != bool(args.target_name):
            parser.error("command mode cannot be combined with --list and target name/identity must be paired")
    elif not args.list_only and (not args.target_name or not args.target_pc):
        parser.error("use --list or provide both --target-name and --target-pc")

    try:
        result = run_command(args) if args.command_key else run(args)
        print(json.dumps(result, ensure_ascii=False) if args.json else json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        payload = {"ok": False, "error": str(error)}
        print(json.dumps(payload, ensure_ascii=False) if args.json else f"ERROR: {error}", file=sys.stdout)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
