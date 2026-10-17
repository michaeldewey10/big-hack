"""Recovered Big Walk Mirror command catalog and bounded runner metadata.

The catalog is static evidence from the audited Steam build. Only entries with
``runnable=True`` have a typed, bounded argument marshaller in the live helper.
"""

from __future__ import annotations


def _command(
    class_name: str,
    method: str,
    signature: str,
    args: tuple[tuple[str, str], ...] = (),
    *,
    namespace: str = "",
    requires_authority: bool = True,
    channel: int = 0,
    instance: str = "player_networking",
    arity: int | None = None,
    trailing_null_args: int = 0,
    reason: str = "",
) -> dict:
    safe_kinds = {
        "bool", "i32", "enum_i32", "u16", "u32", "u64", "unit_float",
        "bounded_double", "v2", "v3", "v3_world", "string", "sign_text",
        "short_string", "player",
    }
    runnable = instance in {"player_networking", "peck_text"} and all(kind in safe_kinds for _, kind in args)
    if not runnable and not reason:
        if instance in {"player_networking", "peck_text"}:
            reason = "Needs a valid live game object or custom struct value; raw pointers/bytes are not accepted."
        else:
            reason = "Needs a live component/object reference not resolved by this runner."
    return {
        "key": f"{namespace}.{class_name}.{method}" if namespace else f"{class_name}.{method}",
        "namespace": namespace,
        "class": class_name,
        "method": method,
        "signature": signature,
        "args": [{"name": name, "kind": kind} for name, kind in args],
        "arity": len(args) if arity is None else arity,
        "trailing_null_args": trailing_null_args,
        "requires_authority": requires_authority,
        "channel": channel,
        "instance": instance,
        "runnable": runnable,
        "reason": reason,
    }


COMMANDS = [
    _command("PlayerNetworking", "CmdAddToSyncedBlockList", "CmdAddToSyncedBlockList(ulong blockedUser)", (("blockedUser", "u64"),)),
    _command("PlayerNetworking", "CmdChangeLook", "CmdChangeLook(int lookId, LookPart lookPart)", (("lookId", "i32"), ("lookPart", "enum_i32"))),
    _command("PlayerNetworking", "CmdDropHeldPlayer", "CmdDropHeldPlayer()"),
    _command("PlayerNetworking", "CmdDudJump", "CmdDudJump()"),
    _command("PlayerNetworking", "CmdDudUseHeld", "CmdDudUseHeld()"),
    _command("PlayerNetworking", "CmdEnterPose", "CmdEnterPose(ShellReference poseShellReference, int poseActionNumber)", (("poseShellReference", "ShellReference"), ("poseActionNumber", "i32"))),
    _command("PlayerNetworking", "CmdExitPose", "CmdExitPose(int poseActionNumber)", (("poseActionNumber", "i32"),)),
    _command("PlayerNetworking", "CmdFellToFar", "CmdFellToFar()"),
    _command("PlayerNetworking", "CmdOnJump", "CmdOnJump()"),
    _command("PlayerNetworking", "CmdPickUp", "CmdPickUp(PlayerHeldInformation heldInformation)", (("heldInformation", "PlayerHeldInformation"),)),
    _command("PlayerNetworking", "CmdPickUpPlayer", "CmdPickUpPlayer(PlayerCharacter pickedUpCharacter)", (("pickedUpCharacter", "player"),)),
    _command("PlayerNetworking", "CmdPlaceHeldPlayerIntoPose", "CmdPlaceHeldPlayerIntoPose(ShellReference poseShellReference)", (("poseShellReference", "ShellReference"),)),
    _command("PlayerNetworking", "CmdPlaceInHome", "CmdPlaceInHome(Prop prop, ShellReference propHomeReference)", (("prop", "Prop"), ("propHomeReference", "ShellReference"))),
    _command("PlayerNetworking", "CmdRecordProvenWalking", "CmdRecordProvenWalking()"),
    _command("PlayerNetworking", "CmdReleaseHeldSwitch", "CmdReleaseHeldSwitch(ShellReference peckSwitchReference, PeckContext peckContext, int actionNumber)", (("peckSwitchReference", "ShellReference"), ("peckContext", "PeckContext"), ("actionNumber", "i32"))),
    _command("PlayerNetworking", "CmdRemoveFromSyncedBlockList", "CmdRemoveFromSyncedBlockList(ulong blockedUser)", (("blockedUser", "u64"),)),
    _command("PlayerNetworking", "CmdSendTextChatMessage", "CmdSendTextChatMessage(string message)", (("message", "string"),)),
    _command("PlayerNetworking", "CmdSet2DVoice", "CmdSet2DVoice(bool is2D)", (("is2D", "bool"),)),
    _command("PlayerNetworking", "CmdSetAudioGhost", "CmdSetAudioGhost(bool isAudioGhost)", (("isAudioGhost", "bool"),)),
    _command("PlayerNetworking", "CmdSetControlsVelocity", "CmdSetControlsVelocity(Vector3 controlsVelocity)", (("controlsVelocity", "v3"),), channel=1),
    _command("PlayerNetworking", "CmdSetCrouchness", "CmdSetCrouchness(float crouchness)", (("crouchness", "unit_float"),)),
    _command("PlayerNetworking", "CmdSetEchoAmount", "CmdSetEchoAmount(float echoValue)", (("echoValue", "unit_float"),)),
    _command("PlayerNetworking", "CmdSetGestureLeftPoint", "CmdSetGestureLeftPoint(bool active)", (("active", "bool"),)),
    _command("PlayerNetworking", "CmdSetGestureLeftWave", "CmdSetGestureLeftWave(bool active)", (("active", "bool"),)),
    _command("PlayerNetworking", "CmdSetGestureRightPoint", "CmdSetGestureRightPoint(bool active)", (("active", "bool"),)),
    _command("PlayerNetworking", "CmdSetGestureRightWave", "CmdSetGestureRightWave(bool active)", (("active", "bool"),)),
    _command("PlayerNetworking", "CmdSetGhost", "CmdSetGhost(bool isGhost)", (("isGhost", "bool"),)),
    _command("PlayerNetworking", "CmdSetHeadState", "CmdSetHeadState(Vector2 headState)", (("headState", "v2"),), channel=1),
    _command("PlayerNetworking", "CmdSetIsTextChatting", "CmdSetIsTextChatting(bool value)", (("value", "bool"),)),
    _command("PlayerNetworking", "CmdSetMenuEyes", "CmdSetMenuEyes(bool hasMenuEyes)", (("hasMenuEyes", "bool"),)),
    _command("PlayerNetworking", "CmdSetMute", "CmdSetMute(bool isMute)", (("isMute", "bool"),)),
    _command("PlayerNetworking", "CmdSetOutdoorness", "CmdSetOutdoorness(float outdoornessValue)", (("outdoornessValue", "unit_float"),)),
    _command("PlayerNetworking", "CmdSetPending", "CmdSetPending(bool newValue)", (("newValue", "bool"),)),
    _command("PlayerNetworking", "CmdSetSitting", "CmdSetSitting(bool isSitting)", (("isSitting", "bool"),)),
    _command("PlayerNetworking", "CmdSetSleeping", "CmdSetSleeping(bool value)", (("value", "bool"),)),
    _command("PlayerNetworking", "CmdSetWindUpStartTime", "CmdSetWindUpStartTime(double windUpStartTime)", (("windUpStartTime", "bounded_double"),)),
    _command("PlayerNetworking", "CmdTextChatStroke", "CmdTextChatStroke(bool isDelete)", (("isDelete", "bool"),)),
    _command("PlayerNetworking", "CmdTextInputErase", "CmdTextInputErase()"),
    _command("PlayerNetworking", "CmdTextInputStroke", "CmdTextInputStroke()"),
    _command("PlayerNetworking", "CmdUseHeld", "CmdUseHeld(PeckContext peckContext)", (("peckContext", "PeckContext"),)),
    _command("PlayerNetworking", "CmdUseHeldAsKey", "CmdUseHeldAsKey(PeckContext peckContext)", (("peckContext", "PeckContext"),)),
    _command("PlayerNetworking", "CmdUseHeldUp", "CmdUseHeldUp(PeckContext peckContext)", (("peckContext", "PeckContext"),)),
    _command("PlayerNetworking", "CmdUsePeckSwitch", "CmdUsePeckSwitch(ShellReference switchReference, PeckContext peckContext, int actionNumber)", (("switchReference", "ShellReference"), ("peckContext", "PeckContext"), ("actionNumber", "i32"))),
    _command(
        "PeckEffectTextInput",
        "CmdSendNewText",
        "CmdSendNewText(string text, NetworkConnectionToClient sender = null)",
        (("text", "sign_text"),),
        requires_authority=False,
        instance="peck_text",
        arity=2,
        trailing_null_args=1,
    ),
    _command("PeckEffectTextInput", "CmdStopEditing", "CmdStopEditing()", requires_authority=False, instance="peck_text"),
    _command(
        "MirrorIgnorancePlayer",
        "CmdSetPlayerName",
        "CmdSetPlayerName(string playerName)",
        (("playerName", "short_string"),),
        namespace="Dissonance.Integrations.MirrorIgnorance",
        instance="other",
    ),
    _command(
        "HouseNetworkTransform",
        "CmdMove",
        "CmdMove(Vector3 position, uint packedRotation, ushort platformTicket)",
        (("position", "v3_world"), ("packedRotation", "u32"), ("platformTicket", "u16")),
        namespace="LobbyNetworking",
        channel=1,
        instance="other",
    ),
    _command(
        "HouseNetworkTransform",
        "CmdVelocity",
        "CmdVelocity(Vector3 velocity, Vector3 angularVelocity)",
        (("velocity", "v3"), ("angularVelocity", "v3")),
        namespace="LobbyNetworking",
        instance="other",
    ),
]

COMMANDS_BY_KEY = {item["key"]: item for item in COMMANDS}


def validate_arguments(command: dict, values: list) -> list:
    """Validate UI/CLI arguments and return JSON-safe normalized values."""
    if not command.get("runnable"):
        raise ValueError(command.get("reason") or "This command has no safe typed runner.")
    specs = command["args"]
    if not isinstance(values, list) or len(values) != len(specs):
        raise ValueError(f"Expected {len(specs)} argument value(s).")

    normalized = []
    for spec, value in zip(specs, values):
        kind = spec["kind"]
        name = spec["name"]
        if kind == "bool":
            if not isinstance(value, bool):
                raise ValueError(f"{name} must be true or false.")
            normalized.append(value)
        elif kind in {"i32", "enum_i32", "u16", "u32", "u64"}:
            try:
                number = int(str(value), 10)
            except (TypeError, ValueError):
                raise ValueError(f"{name} must be an integer.") from None
            limits = {
                "i32": (-(2**31), 2**31 - 1),
                "enum_i32": (0, 32),
                "u16": (0, 2**16 - 1),
                "u32": (0, 2**32 - 1),
                "u64": (0, 2**64 - 1),
            }
            low, high = limits[kind]
            if number < low or number > high:
                raise ValueError(f"{name} must be between {low} and {high}.")
            normalized.append(str(number) if kind == "u64" else number)
        elif kind in {"unit_float", "bounded_double"}:
            try:
                number = float(value)
            except (TypeError, ValueError):
                raise ValueError(f"{name} must be a number.") from None
            limit = 1.0 if kind == "unit_float" else 1_000_000_000.0
            if not (-limit <= number <= limit):
                raise ValueError(f"{name} must be finite and in [-{limit:g}, {limit:g}].")
            normalized.append(number)
        elif kind in {"v2", "v3", "v3_world"}:
            count = 2 if kind == "v2" else 3
            if not isinstance(value, (list, tuple)) or len(value) != count:
                raise ValueError(f"{name} must have {count} comma-separated components.")
            try:
                vector = [float(part) for part in value]
            except (TypeError, ValueError):
                raise ValueError(f"{name} components must be numbers.") from None
            # v3 is primarily CmdSetControlsVelocity. A 12 m/s ceiling permits
            # the test-tab's modest 11 m/s validation value while keeping the
            # generic runner far from non-finite or extreme vectors.
            limit = 100_000.0 if kind == "v3_world" else (12.0 if kind == "v3" else 10.0)
            if any(not (-limit <= part <= limit) for part in vector):
                raise ValueError(f"{name} components must be finite and in [-{limit:g}, {limit:g}].")
            normalized.append(vector)
        elif kind in {"string", "sign_text", "short_string"}:
            if not isinstance(value, str):
                raise ValueError(f"{name} must be text.")
            limit = 4096 if kind == "string" else (500 if kind == "sign_text" else 32)
            if len(value.encode("utf-16-le")) // 2 > limit:
                raise ValueError(f"{name} is limited to {limit} UTF-16 characters.")
            if "\x00" in value:
                raise ValueError(f"{name} cannot contain a NUL character.")
            normalized.append(value)
        elif kind == "player":
            if not isinstance(value, str) or len(value) > 256:
                raise ValueError(f"{name} must come from the refreshed party list.")
            normalized.append(value)
        else:
            raise ValueError(f"{name} uses unsupported argument type {kind}.")
    return normalized
