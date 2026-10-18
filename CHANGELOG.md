# Changelog

## 0.3.0 — 2026-10-17

- New host-only Big Fun toggle, **Train 20x speed**: on the main train (not the chairlift), multiplies top speed, acceleration and braking by 20, so 3 m/s becomes 60 m/s, and applies it right away if the engine is running. The host's simulation syncs the new speed to every player. **Normal train speed** restores the original values and keeps braking fast until the train is back to its usual speed; closing Big Hack restores them immediately.
- Tested live while hosting: the train sped up, clients received the synced speed, and Normal train speed restored the original tuning.

## 0.2.0 — 2026-10-17

- New Big Fun action, **Flare gun full auto**: picks up the nearest free, loaded flare gun (or uses the one in your hands) and removes its 20-second cooldown block on that gun only. While you hold the left mouse button in Big Walk, with the window focused and in normal gameplay, it re-fires through the game's normal use action every 120 ms. **Stop flare gun full auto**, dropping the gun, or closing Big Hack restores the normal cooldown.
- Tested live as a non-host client: pickup, arming and rapid fire worked. Peer visibility was not separately confirmed, and other mouse bindings for Use are not detected.

## 0.1.1 — 2026-10-17

- Game version detection: Big Hack checks the installed Big Walk files at startup and before attaching, and shows **Unsupported game version** in red when they don't match the supported build (Steam build 25723723). The message names the installed Steam build when Steam reports a different one.
- An unsupported build no longer appears as a generic connection error, and its files are re-hashed only when they change on disk.

## 0.1.0 — 2026-10-17

Initial public Windows release containing the current Big Hack work:

- Native Rust/GPUI UI with the red icon, simple game-style controls, tab colors and visible scrollbars.
- Automatic game discovery and strict supported-build validation.
- Character movement/jump/throw/kick/charge controls, landing reaction toggle and saved presets.
- Live party and item views with pickup and teleport controls.
- Backpack/Holster Equip closest, storage and removal controls; no blindfold row.
- Camera zoom/photo controls, saved locations and teleport back.
- Host appearance controls and Randomize my colors.
- Corpse ring and bowling-triangle spawns, Clear all corpses with cleanup/progress/Stop, item collection and party gathering.
- Windows text-layout crash mitigation and local diagnostic logs.
- Standalone EXE and portable ZIP with runtime dependencies and notices.

The release is build-specific. Newer gameplay paths, including the latest closest-gear sequence, have compilation/syntax coverage but have not all been exercised in live gameplay. Packaging this release did not execute the test suite or send gameplay actions.
