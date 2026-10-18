# Changelog

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
