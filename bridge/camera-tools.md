# Camera controls

`camera_tools.js` adds local camera controls. It is loaded after `telemetry.js`; its public methods run on the owned character's Unity `Update` callback. It never calls `CameraCheatMover.Attach` or a teleport method.

## Contract

- `snapshot()` always returns an object: `available`, `reason`, `zoom`, `detached`, `free_available`, `free_reason`, `speed` (default directional step, 1 metre). When resolved it also includes `field_of_view` and `position`. It catches capability failures so an absent camera does not suppress the rest of telemetry.
- `apply(req)` expects the existing `owner_pc` and `owner_pn` identity gate and `target_kind: "camera"`.
- `camera_zoom` accepts `zoom` in 0.25–8. Zoom is relative to the camera FOV captured on the first camera modification. Resulting FOV is clamped to 5–170 degrees. Exactly 1 restores the captured native zoom setting.
- `camera_detach` freezes camera rotation at the current view and removes its player-relative parent while preserving world pose.
- `camera_move` accepts `direction`: `forward`, `back`, `left`, `right`, `up`, `down`, plus optional `step` in 0.25–20 metres (default 1). Forward/side movement follows the current frozen view; up/down follow world Y. These controls move the camera, not the character. They do not synthesize keyboard controls or pause the game.
- `camera_turn` accepts `direction`: `left`, `right`, `up`, `down`, plus optional `degrees` in 0.25–45 (default 15). Yaw is around world Y; pitch is around the camera's local X, clamped to +/-85 degrees. Quaternion composition is normalized before applying it to the detached camera. Turning updates the axes used by subsequent directional moves.
- `camera_return` restores camera parent, original local position/rotation/scale, guide reference, and any existing camera debug component's enabled state. It leaves a chosen zoom active.
- `hasChanges()` and `restoreAll()` support normal app detach, including restoration of the captured native zoom via the game's own `SetZoom` method.

## Recovered implementation evidence

The audited Cpp2IL native dump is under `2026-10-11/c-program-files-x86-steam-steamapps/work/cpp2il/out/IsilDump/Assembly-CSharp`.

- `PlayerCharacter`: `cameraMinder` at 0xd0; `cheater` at 0xd8.
- `PlayerCameraMinder`: owned character backreference at 0x28; `zoomLevel` at 0x34; `_cameraGuide` at 0x40; `playerCameraReferences` at 0x68. `Update` only owns camera rotation while the guide is non-null. Camera position follows the Transform parent set by `TakeCamera`/`set_cameraGuide`.
- `PlayerCameraReferences.playerCamera` is at 0x20. The actual loaded object and its Transform are resolved, rather than assuming a debug component exists.
- Native `SetZoom` is RVA 0x4f5220; `Update` is RVA 0x4f53b0. Native Update uses `60 * zoomLevel`, except exactly 1 uses `fovFromSettings`. The 60.0f constant at GameAssembly RVA 0x39c1240 was read from the installed PE. A tiny epsilon avoids the special case when a requested relative zoom happens to produce exactly 60 degrees.
- `CameraCheatMover` Awake only initializes GUI text state; OnEnable/OnDisable register/deregister with AudioManager. Its LateUpdate can write the camera while detached. If an existing valid local component exists, it is temporarily disabled and its enabled state is restored. A pre-existing native detached camera is refused. No debug component is created.
- Native `CameraCheatMover.Attach` RVA 0x34b760 calls `PlayerGrease.Teleport`; this is why return is implemented directly instead.

All expected field offsets are checked against loaded metadata. Ownership, component classes, backreferences, native Unity object liveness, camera instance ID, and held GC handles are rechecked before mutations/restoration. Managed guide references use `il2cpp_gc_wbarrier_set_field`. Reparenting preserves world pose on detach, and restoration uses the saved local pose. If the game has assigned a different parent/guide or changed the active camera, restoration refuses to overwrite it and reports the precise reason.

This implementation was reviewed statically. No camera action or game attachment was run for this change. Camera appearance, scene transitions, and camera-only positioning still require user live validation. Normal shutdown attempts restoration; a hard process termination cannot guarantee it.
