# Big Hack

A native Rust/GPUI companion for private, authorized Big Walk sessions.

**[Download BigHack.exe](https://github.com/michaeldewey10/big-hack/releases/latest/download/BigHack.exe)** · **[All release downloads](https://github.com/michaeldewey10/big-hack/releases/latest)**

## Run on Windows

1. Download **BigHack.exe** from Releases.
2. Start the supported Big Walk build and enter a session.
3. Open BigHack.exe. It finds the running game and attaches automatically.

The standalone Windows x64 EXE bundles the native UI, local bridge, Python runtime, Frida, Visual C++ runtime, and notices. Users do not need Python or Rust installed. The portable ZIP is an alternative: extract it and keep every file in its Big-Hack folder together.

Some controls require hosting, including appearance changes, corpse spawning and clearing. Each button performs one action; successful results are recorded in the log and errors appear in the app.

## Features

| Tab | Controls |
| --- | --- |
| **You** | Movement speed and throw charge speed up to 20x; jump height and combined throw/kick strength up to 99x; landing dizziness toggle; Restore original; presets; held-item press-and-hold Use and Drop; Backpack/Holster equipment and storage; host appearance selectors. |
| **Party** | Live player list, positions, state and carried items; pick up another player or teleport to them. |
| **Items** | Searchable, distance-sorted client-loaded props; pickup and teleport; collect the selected item type within a chosen distance. |
| **Camera** | Zoom slider, detach/return, movement and look controls. |
| **Places** | Save locations, teleport to a saved location, and return to the previous teleport position. |
| **Big Fun** | Spawn ten corpses around you; spawn a ten-pin corpse triangle; clear all active corpses; collect items; bring party members to you; randomize your colors. |

The UI follows Big Walk's simple serif settings style, with colored marker underlines and draggable scrollbars. Ctrl+1 through Ctrl+6 selects You, Party, Items, Camera, Places and Big Fun. Escape cancels a slider drag and releases a held Use action. Release a slider to apply its value.

### Equipment

Only Backpack and Holster are shown. An empty slot offers **Equip closest**, which selects unused, compatible gear from the currently loaded items, picks it up, and wears it. Empty hands are required. Worn gear offers **Store held item** while you hold an item, **Take off**, and **Take out** for occupied storage. Blindfold and empty storage rows are hidden.

### Corpse controls

The bowling button is directly below the ring spawn button. It places ten bodies in a 1-2-3-4 triangle, starting four metres ahead, with one-metre spacing. Positions and viewing direction are captured once per click; normal physics applies. Use flat ground for a recognizable rack.

**Clear all corpses** includes ordinary game corpses and Big Hack spawns active on the host. It uses the game's pocket-release and held-body cleanup before network removal, with progress and Stop controls.

### Compatibility

This release supports one inspected Steam build:

| File | SHA-256 |
| --- | --- |
| GameAssembly.dll | `DF3F2DA21746121CFA3E1936615082492AED0B4DF8D6AF14FB70D960D035C478` |
| Big Walk_Data/il2cpp_data/Metadata/global-metadata.dat | `054EDF954946F09B259DA34F287A1C48048368B2845BA3F383A58148D00FCD44` |

A different build is rejected before attaching. A game update can change fields, native methods or behavior and requires a compatible Big Hack release. Automatic self-updating is not implemented in v0.1.0.

Player/item data describes the attached client's current state. The item list covers loaded props, not unloaded map objects. Observing a local wrapper return or state update does not by itself establish another peer's receipt or rendering. Implementation history and per-feature validation limits are retained in [development notes](docs/DEVELOPMENT-NOTES.md) and the bridge documentation.

## Settings and logs

- Presets and saved places: `%LOCALAPPDATA%\BigHack\library.json`
- Diagnostic logs: `%LOCALAPPDATA%\BigHack\logs`
- Each standalone launch extracts into a unique `%LOCALAPPDATA%\BigHack\runtime` directory and attempts to remove it after closing.

Close the app normally to let its local bridge detach. It attempts to restore character tuning and camera changes when the same owned character remains available. Appearance/equipment changes follow normal game persistence.

`BigHack.exe --preview` opens labelled sample data with game actions disabled. `--preview --items` and `--preview --fun` select other preview pages.

## Build from source

Windows x64 prerequisites:

- Rust MSVC toolchain with Cargo.
- Visual Studio C++ Build Tools, Windows SDK, and its x64 Visual C++ redistributable.
- Python 3.11 x64.

From this repository root in PowerShell:

```powershell
python -m venv .venv-build
.\.venv-build\Scripts\python.exe -m pip install -r requirements-build.txt
.\build.ps1 -PythonExecutable "$PWD\.venv-build\Scripts\python.exe"
.\packaging\build-single.ps1
```

The portable files are written to `dist/Big-Hack`; the one-file launcher is `dist/BigHack.exe`. Build output is ignored by Git. `build.ps1` compiles and packages; it does not run the test suite or send gameplay commands.

`-OutputDirectory` changes the portable output path. `-SkipBridge` reuses an already built bridge. `BIG_HACK_PYTHON` or `-PythonExecutable` selects the build Python. `-FridaPath` / `BIG_HACK_FRIDA_PATH` optionally uses an existing Frida module directory. `RC` selects a Windows resource compiler; `packaging/build-single.ps1 -RuntimeDll <path>` selects the x64 redistributable DLL explicitly.

## License and attribution

Big Hack source is MIT licensed. Third-party dependencies and Big Walk artwork retain their own licenses and ownership; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Dependency notices are bundled with the downloads. The removed map feature's historical image assets remain in source for the development history and are not embedded in the app.
