# Third-party notices

The Windows packages include Microsoft's x64 Visual C++ redistributable `vcruntime140.dll`, copied from the Visual Studio Build Tools redistributable folder for app-local deployment. This component is copyright Microsoft Corporation and remains subject to Microsoft's applicable license terms.

Big Hack's native UI uses Zed Industries' GPUI 0.2.2 under Apache-2.0. Source: https://github.com/zed-industries/zed/tree/main/crates/gpui .

The bundled local bridge uses Frida 17.23.3 under the wxWindows Library Licence, Version 3.1: https://frida.re . It is packaged with PyInstaller and CPython 3.11. Their license files are included in the portable package's licenses folder. PyInstaller is distributed with its bootloader exception; see PYINSTALLER-COPYING.txt.

Rust dependency versions are recorded in Cargo.lock. The Georgia, Consolas, and Segoe UI fonts are supplied by Windows and are not redistributed. The app icon is a red adaptation of Big Walk's original Steam icon. Historical map source assets are Big Walk's original PaperMapSaved and MapAlbedo textures; the Map page has been removed and those images are not embedded in the application. These assets are included at the user's request for this private testing app; the original artwork belongs to its respective rights holders. Big Walk's game code is not included in the package.

The portable package also includes Rust dependency metadata and locally available license/notice files under licenses/rust and licenses/RUST-DEPENDENCIES.json. Big Hack source is MIT licensed; the MIT license does not relicense third-party dependencies or game artwork.
