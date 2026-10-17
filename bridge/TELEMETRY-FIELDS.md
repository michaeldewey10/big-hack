# Audited field layout

Offsets below are specific to the GameAssembly/metadata hashes checked by big_walk_paths.py. The saved Cpp2IL type declarations and native getters were reviewed; this is not a claim that every remote state has been demonstrated live.

Sources: the existing 2026-10-11 workspace's `work/cpp2il/auth_cs/DiffableCs/Assembly-CSharp` declarations for PlayerCharacter, PlayerNetworking, PlayerHeldInformation, Prop, PlayerRegistry, PlayerPose, and PlayerPoser. The held-player chains are additionally supported by `out/IsilDump/Assembly-CSharp/PlayerHands.txt` and `PlayerPoser.txt`.

| Structure | Offset | Field |
|---|---|---|
| PlayerCharacter | 0x1A0 | PlayerNetworking pointer |
| PlayerNetworking | 0x70 | PlayerCharacter back-reference |
| PlayerNetworking | 0x40 | NetworkIdentity pointer |
| NetworkIdentity | 0x22, 0x23 | local / owned booleans |
| NetworkIdentity | 0x30 | uint32 netId |
| PlayerNetworking | 0xF0, 0x100 | username / moderationName |
| PlayerNetworking | 0x128 | host boolean |
| PlayerNetworking | 0x88, 0x90 | held prop identity / held enum (0 nothing, 1 prop) |
| PlayerNetworking | 0xD0 | crouchness float |
| PlayerNetworking | 0xD4..0xD7 | arm waving / pointing booleans |
| PlayerNetworking | 0xD8 | control velocity Vector3 |
| PlayerNetworking | 0xEC | ghost boolean |
| PlayerNetworking | 0x148..0x14C | sleeping / menu eyes / muted / sitting / text chatting |
| Prop | 0x2C0 | exclusive holder PlayerCharacter pointer |
| Prop | 0x2D8 | NetworkIdentity pointer |
| Prop | 0x338 | in-inventory boolean |

Held player: `PC+0xF0 -> registry+0x18 -> grabPose+0x150 occupant`.

The UI displays `moderationName` at PN+0x100. A live read showed `username` at PN+0xF0 contains an account identifier, while `moderationName` contains the player's display name. Missing display names fall back to You or Player #netId; the account identifier is not used as a display label.

Player holding this character: `PC+0xA0 -> poser+0x18 -> currentPose+0x158 isCarryPoseOfCharacter`.

Position reads call Unity Component.get_transform and Transform.get_position. Name reads use Unity Object.get_name. These Unity calls and all actions run on the locally owned PlayerCharacter.Update hook. Teleport resolves PlayerGrease.Teleport with three parameters, as in the existing self/player teleport helpers.

The bridge checks the attachment generation, local ownership/back-reference, and selected target identity before scheduling an action, then rechecks the target on the Unity thread. No action is automatically retried.

# Local character tuning

`PlayerCharacter.tunings` at +0x78 references `PlayerTunings`. The bridge checks the class and field offsets through IL2CPP metadata before enabling tuning. Writes run on the local owned character update, verify the current character/tuning identity, and refuse a tuning reference shared with another live character.

| Control | PlayerTunings fields | Offsets |
| --- | --- | --- |
| Walking | forwardSpeed | 0x10 |
| Sprinting | forwardSprintSpeed | 0x14 |
| Crouching | crouchForwardSpeed / crouchForwardSprintSpeed | 0x18 / 0x1C |
| Swimming | swimForwardSpeed / swimForwardSprintSpeed | 0x20 / 0x24 |
| Ghost sprinting | forwardSprintGhostSpeed | 0x28 |
| Approximate jump height | jumpForce / maxUpwardsVelocity | 0x40 / 0x44 |
| Throw strength | throwSettings.maxForce / lowThrowSettings.maxForce | 0x68 / 0x80 |

Multipliers are bounded to 0.25–20, based on captured original values. Jump uses the square root of the height multiplier because the recovered jumper assigns jumpForce to upward velocity; the mover clamps upward velocity using maxUpwardsVelocity. No gravity change is exposed. Readback establishes only that the fields were written, not a measured gameplay height or network result.

The single Movement speed control scales walking, sprinting, both crouch speeds, both swim speeds, and ghost sprinting together, retaining their baseline ratios. Camera/look speeds are separate fields and are not affected.

Throw strength is supported by the native `PlayerHands.Drop` disassembly: normal throws load the inline `LaunchSettings` at tunings+0x68 and low throws at +0x80; `maxForce` is the first float. Torque and angle-curve data follow at +4 and +0x10 within each struct. The bridge verifies the outer fields and the nested maxForce/maxTorque layout through IL2CPP metadata. Both throw forces use the selected multiplier. The later feature expansion also exposes kickSettings.maxForce (+0x50) and maxWindUpDuration (+0x48) independently; torque and launch curves remain unchanged. This recovers the local configuration path, without claiming a particular in-game range or host acceptance.

## Landing dizziness

`PlayerCharacter.faller` (+0x110) references a `PlayerFaller` with a character back-reference at +0x38. The bridge checks class, offsets, back-reference, and exclusive ownership. `ignoreFalling` is the boolean at +0x1B. In the recovered native `PlayerFaller.Update`, a true value jumps over the automatic fall-trigger branch to the existing daze-expiry logic. `TriggerFall` otherwise requests sitting, sends the fall wrapper, drops held objects, and calls `ShowFall`, which starts the daze timer at +0x40. Therefore **Landing dizziness Off** suppresses that entire automatic landing reaction. It does not forcibly clear an already running daze timer.

When re-enabling falls, the bridge invokes the recovered zero-argument `ClearNextFall` on the same owned controller before changing the flag. Its native body resets heightLastGrounded (+0x30), avoiding a stale accumulated fall after time spent ignoring falls. The original flag is restored by Restore original and the normal detach path, with identity rechecked. These paths were implemented from recovered declarations/native code; live throw/fall behavior remains for user observation.


## Big Fun

The map UI and its arbitrary X/Z ground-query action have been removed. `fun_actions.js` accepts only spawn_corpses, spawn_corpse_pins, clear_corpses, grab_all_items and gather_party. All actions execute in bounded steps on the owned Unity Update; ownership and target identity are checked again at each step. Only one request may run. Failures include a completed/total count. Ordinary action deadlines remain unchanged. Corpse spawning and party gathering retain 44/47/50-second runtime/bridge/UI deadlines. Item collection uses 4N+5 / 4N+8 / 4N+12 seconds for N captured targets (1-4,096), so a full-map batch is not cut off after 44 seconds.

### Corpses

The host gate calls Mirror.NetworkServer.get_active. Mirror.NetworkClient.prefabs supplies runtime-registered prefab candidates through Dictionary.Values.CopyTo into a GameObject array; NetworkManager.spawnPrefabs (+0x68) is also searched. A normalized prefab name of Corpse, the actual Corpse component, and a child Prop are required. A candidate must have NetworkIdentity.sceneId (+0x38) zero, netId (+0x30) zero, and nonzero _assetId (+0x40), and NetworkClient.GetPrefab must return the same GameObject for that asset ID. The GetPrefab native signature is bool(uint32, GameObject**, MethodInfo*); the live native call succeeded where the runtime-invoke path returned false, so the runner uses the native public getter.

The recovered Corpse.CreateAndSpawn method transfers the source player's held item and pockets. The Big Fun button instead uses the registered prefab and its normal Unity Awake/OnEnable lifecycle. The Corpse component's prop reference is +0x88. Before spawning, it receives a unique identifier (+0x78), set with il2cpp_gc_wbarrier_set_field and checked by string readback. Appearance is copied from PlayerNetworking.lookIdHead/Torso/Legs (+0x7C/+0x80/+0x84) using Corpse.set_Networkhead/torso/legsColorIndex; native bodies show by-value int32 arguments, despite the recovered declaration's `in` spelling. All three values must read back. No live player's state, equipment, or death state is changed.

UnityEngine.Object.Internal_InstantiateSingle creates ten bodies on a radius-three ring, one per 200 ms. Prop.saveablePropName (+0xB8) is set to notSavable=0 and propSaveType (+0xC8) to Never=2. The native public NetworkServer.Spawn(GameObject,uint32,NetworkConnection*,MethodInfo*) wrapper is used with a null owner. A nonzero resulting netId is required; failed clones are destroyed through NetworkServer.Destroy if registered. Created IDs and positions are returned in the result.

On 2026-10-17, the first initialization attempt failed before network spawning (0/10). After correcting the color-setter argument convention, the authorized batch registered ten bodies with netIds 580-589; all ten appeared in subsequent item telemetry. Their identifier references were then corrected with the GC write-barrier API and all ten read back exactly. This reference fix is now part of the pre-spawn path. No second successful batch was run. Receipt: work/corpse-spawn-corpse-ten-a94773dcf02d495ea6a1ff657b8cce3c.json. This establishes host-side creation and item-list presence; a remote client's rendering was not inspected.

### Grab every item

Fireworks/flare controls, RPC action allowlist entries, particle discovery, and particle clone code were removed. The replacement action receives only the current unheld, non-inventory item identities captured by the native UI: prop pointer, NetworkIdentity pointer, netId, and object name. The bridge validates the bounded list and re-resolves those identities from the live Prop.allProps list before every stage. Unloaded, held, inventory, or game-blocked props are skipped.

PlayerCharacter.hands (+0x68) -> PlayerHands.playerCharacter (+0x28) and heldProp (+0x38); PC.actions (+0x120) -> PlayerActions.playerCharacter (+0x18) and heldActionNumber (+0x20). Prop.exclusiveHolder is +0x2C0, networkIdentity +0x2D8 and _isInInventory +0x338. The recovered native PlayerActions.ActionPickUpProp(Prop,Vector3) increments its action counter, performs the configured local prediction, and calls the ordinary owned PlayerNetworking.CmdPickUp wrapper. IsSafeToPickUp(Prop) is checked before scheduling pickup.

Pickup is acknowledged only when PN.playerHeldInformation.identity (+0x88), PlayerHands.heldProp, and Prop.exclusiveHolder all identify the same target and local owner. After holding 200 ms across separate updates, a release uses the same owned CmdPickUp wrapper with an unboxed 0x38-byte PlayerHeldInformation: identity null (+0), heldType Nothing=0 (+0x8), hasDropData true (+0xC), windUp zero (+0x10), finite nearby dropPosition (+0x14), identity launchRotation (+0x20, w at +0x2C), increasing actionNumber (+0x30), isResultOfSnatch false (+0x34). The owner action counter and synchronized PN counter (+0xB8) supply the next number. The native PlayerHands.Drop multiplies launch force/torque by windUp, so the requested release has no throw force. No prop ownership, transform, or physics-authority field is patched.

The destination uses a bounded spiral ring 2.5-4.9 metres around the owner's current position, with +0.5 vertical clearance. A completed item requires empty hands, released holder state, and a fresh prop position within 12 metres of the owner. Pickup has a two-second observation deadline; release has 1.5 seconds. Refused pickups are counted and skipped; unexpected occupation or unresolved release stops the sequence. Action-progress events carry processed/total, collected, skipped and failed counts. Stop marks cancellation and lets the current pickup/release finish before the next item. Normal detach grants six seconds for this boundary and character restoration. No bulk item action was run during this implementation update; these are recovered-code implementation details, not demonstrated map collection or remote-client results.

### Gather

The existing owner PlayerNetworking.CmdPickUpPlayer(targetPC) and CmdDropHeldPlayer() wrappers provide the normal command path. The exact owned grab pose is PC.registry (+0xF0) -> PlayerRegistry.grabPose (+0x18), with occupant +0x150 and isCarryPoseOfCharacter +0x158. Target PlayerPoser is PC+0xA0, with playerCharacter +0x10 and currentPose +0x18; the native PoseIsSafe(PlayerPose,PlayerCharacter) check is retained.

The bridge observes both occupant and target currentPose before holding 750 ms and requesting drop on a later update. The native drop command calls the target ServerExitPoseAuto, which clears the synchronized pose. PlayerPoser.ExitPose preserves world placement; PlayerPoser.Update updates the root during carrying. The local transform-only Grease.Teleport path is not used on other players. Pickup acknowledgement has a two-second deadline; observed release has a 1.5-second deadline. This observes the attached client's state, without proving remote owner arrival. The native recovered paths establish an implementation hypothesis to test manually in the authorized session.


# Feature expansion: 2026-10-17

The new modules are loaded after the original telemetry definitions and all actions remain on the validated owned PlayerCharacter.Update queue. Allowed tools: appearance_set, held_use, held_release, held_drop; camera: camera_zoom, camera_detach, camera_return, camera_move, camera_turn; location: location_capture, location_teleport, teleport_back. Character settings adds settings_preset. No generic method invoker or raw pointer input was added.

## Kick, charge, and presets

PlayerTunings.kickSettings is the inline LaunchSettings at +0x50, with maxForce first. The native PlayerHands.Drop kick branch loads its force, torque and curve independently of normal/low throws. maxWindUpDuration is a float at +0x48; native PlayerArms.GetWindUp divides elapsed wind-up time by it. Kick scales only force. Charge speed uses originalDuration/multiplier with a finite positive lower bound. Both controls use 0.25-20 multipliers and the existing exclusive owned tuning validation and normal restoration.

Presets carry all five multipliers and the landing bool. All target values are calculated and validated before writing; a failure attempts rollback of both tuning and landing to the pre-request state, retaining restoration responsibility if rollback fails. UI persistence is in LOCALAPPDATA/BigHack/library.json, with named automatic Preset N and Spot N entries and deletion controls.

## Appearance and pockets

PC.looks +0x98 -> PlayerLooks.playerCharacter +0x68 and lookSet +0x30. PlayerLookSet.colors +0x18 is a checked value-type array with 0x18 stride: Color at +0, fontStyle +0x10, rewardOnly +0x14. Valid ordinary colors are exposed; a currently worn reward color may remain unchanged. PlayerLooks.SetAllLooks(head,torso,legs) follows three ordinary CmdChangeLook requests. It follows normal appearance persistence, so Restore original only restores the tuning/landing baseline.

PC.registry +0xF0 -> PlayerRegistry.blindfoldPocket +0xB0, backpackPocket +0xB8, holsterPocket +0xC0. Each PropHome.parentCharacter +0x30 must match the owner; pinnedProp is +0xD8. Pocket readings are read-only and errors are isolated per slot. Empty item names are null in bridge JSON and optional in the Rust model.

## Held tools

PlayerActions.ActionUseHeldSwitch / ActionUseHeldUpSwitch / ActionDropPropOrPlayer preserve ordinary prediction and action counters. The same local held prop, network identity, exclusiveHolder, hands and action backreferences are checked. Use refuses blocked, sleeping/ghost, and key-dependent contexts; release preserves the original context and does not reapply press-only blockers. Only the press made by the app is tracked for Release use or normal detach. A changed item or character clears stale tracking without invoking an unrelated switch.

## Camera and places

See camera-tools.md for the recovered camera lifecycle, actual loaded camera references, GC roots/write barriers, FOV conversion, quaternion turns, and restoration rules. The native CameraCheatMover.Attach is never called because it teleports the character. Photo mode detaches the actual camera, with independent directional/rotation buttons. Game simulation continues. Normal detach attempts to restore camera state and the native zoom baseline.

Location capture reads the owned character's current world position and quaternion. Saved JSON carries the full GameAssembly hash; cross-build entries, non-finite coordinates, coordinates beyond +/-10000 and invalid quaternions are rejected. Return state is scoped to the current character and bridge attachment. All app player/item/bookmark teleports pass through locationTools.teleportTo and update the return point only after native return. Native return is not proof of remote acceptance. Camera photo mode must be returned before teleporting or capturing a character spot.

Selective collection filters existing eligible captured item identities by selected type and 20m/100m/all distances, then uses the original bounded state machine. Starting it opens Big Fun so progress and Stop remain visible.

Evidence limit: this feature expansion was compiled and packaged without executing any new live game action or test suite. These are implemented code paths supported by recovered fields/native bodies, not confirmed gameplay or peer-observed results.


## Combined launch strength and 100x jump update

The current You controls are movement, jump, combined throw/kick strength (wire key `throw`), and charge. Jump and combined strength allow 0.25-100; movement and charge retain 0.25-20. `groups.throw` contains normal throw, low throw and kick force, written and rolled back together relative to their independently captured baselines. Torque and curves stay unchanged. The native force value bound is 1,000,000, and jump/upward cap 100,000, permitting the requested multipliers without the old 10,000 force ceiling blocking readback or restoration. Original baseline values retain the 10,000 admission ceiling. Values must stay finite and positive.

Presets apply the four current groups; a legacy separate kick property is ignored and the preset throw value applies to all three forces. A strength_mixed snapshot flag detects differing force multipliers so selecting the displayed value can still synchronize the combined group. Jump still scales launch velocity by sqrt(heightMultiplier), so 100x requests 10x launch velocity. Actual height and force effects still need gameplay observation. No new game action was executed for this range/control update.


# Press-and-hold / gear / 99x update

The current jump and combined launch controls stop at 99x in both Rust and JavaScript; movement/charge remain20x and camera8x. Presets loaded from older versions are clamped to current ranges on load and apply.

Held Use now has one physical down/up control. Its hold_id equals the initial press request ID. A quick release remains queued while the press acknowledgement is pending. Root mouse-up/out, window deactivation, Escape, page changes and physical Windows left-button polling request release. Owner/session changes discard stale UI requests. Heartbeats every200ms are admitted by the Python bridge only for the current generation; the JS lease compares owner and hold ID and modifies only script state off the Unity thread. CharacterTools.tick releases through the existing normal up action on the Unity thread after1500ms without a heartbeat. Release failures remain eligible for bounded-interval retries and normal detach restoration; no unrelated item switch is invoked. The old separate Release use button is removed.

The new pocket_tools module adds equip/store/take/unequip through actual wearable homes and equipped gear storage. See POCKET-TOOLS.md for exact recovered metadata, normal action paths, native checks, synchronized result observations and three-second timeout. No gear is spawned or saved ownership/pin state patched. Its snapshot replaces the original read-only pocket list and isolates failures per slot. The normal action queue now also gates on an equipment operation in progress. A running Use must be released before equipment changes.

Validation remains static recovery, syntax compilation, release compilation and packaging for this update. New equip/storage and held-use interactions have not been exercised in a live game during this work.

Clear corpses enumerates Corpse.allCorpses and uses ServerEmptyAllPockets / PrepareForDestroy before NetworkServer.Destroy. It observes both active-list and NetworkServer.spawned removal, with deadlines based on the captured count. See README.md for scope, lifecycle and validation limits.
