# Appearance control correction

Supported GameAssembly.dll SHA-256: `df3f2da21746121cfa3e1936615082492aed0b4df8d6af14fb70d960d035c478`.

## Evidence

- The user's live clicks reached `appearance_set`, but synchronized look IDs did not change within the three-second deadline.
- A passive metadata/byte read from process 15160 on 2026-10-17 identified `UserCode_CmdChangeLook__Int32__LookPart` at RVA `0x2da6b0`, beginning `c2 00 00` (RET 0). The recovered native dump also contains only an immediate return at the method entry. This is an empty command receiver.
- `PlayerLooks.SetAllLooks` calls `CmdChangeLook` three times; sending that command therefore does not implement appearance editing in this build.
- The recovered `PeckEffectChangeLook.Peck` calls `PlayerNetworking.ServerSetLook` (RVA `0x39a9a0`) with `saveChange=true`. That method checks NetworkServer.active, updates the matching synchronized look field through its hook, and runs the game's puff/save path.
- The same passive read reported the local owned character's real NetworkIdentity.isServer as true and head/torso/legs IDs 13/18/11. It did not execute an appearance command or install a gameplay hook.
- REA identified the current DLL and its digest. Native byte/decompiler operations through REA were unavailable because its Windows Ghidra provider rejects DLL targets; the retained Cpp2IL disassembly was corroborated by the passive method-pointer and byte reads instead.

## Implementation

Use ServerSetLook only on the attached host's own currently owned character, with NetworkIdentity and NetworkServer authority checks. Send only changed parts and validate all requested IDs against the actual palette; new reward-only selections remain unavailable. Keep the ordinary save behavior. Non-host clients display an unavailable reason rather than sending the empty command.

After invocation, observe synchronized head/torso/leg IDs over subsequent owned-character updates. Completion requires a matching state for at least 100 ms, with a three-second deadline. This observes the attached client's state; it does not establish another peer's rendering or receipt.

## Validation limits

Rust release compilation and combined JavaScript syntax parsing succeeded. No automated test suite or appearance gameplay action was run for this correction. The host color change, persistence and any peer-visible result still require user observation.

## Randomize my colors

The Big Fun button sends the named `appearance_randomize` tool action. On the owned character update, the bridge selects an ordinary palette color independently for head, torso and legs, excluding each current ID when alternatives are available. It then reuses the validated host setter and observed-state confirmation above. Cosmetic random selection uses Math.random; it is not used for security decisions. No randomization gameplay action or automated tests were executed during implementation.
