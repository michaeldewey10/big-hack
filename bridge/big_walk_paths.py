"""Locate the active Big Walk install and verify the audited client build."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import hashlib
import os
from pathlib import Path
import re


GAME_APP_ID = "1478500"
GAME_EXE = "Big Walk.exe"
EXPECTED_HASHES = {
    Path("GameAssembly.dll"): "DF3F2DA21746121CFA3E1936615082492AED0B4DF8D6AF14FB70D960D035C478",
    Path("Big Walk_Data") / "il2cpp_data" / "Metadata" / "global-metadata.dat":
        "054EDF954946F09B259DA34F287A1C48048368B2845BA3F383A58148D00FCD44",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def running_process_path(pid: int) -> Path | None:
    if os.name != "nt":
        return None
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = (
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    )
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL

    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(buffer))
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)):
            return None
        return Path(buffer.value)
    finally:
        kernel32.CloseHandle(handle)


def _unique(paths: list[Path]) -> list[Path]:
    result = []
    seen = set()
    for path in paths:
        normalized = os.path.normcase(os.path.abspath(str(path)))
        if normalized not in seen:
            seen.add(normalized)
            result.append(path)
    return result


def steam_roots() -> list[Path]:
    roots: list[Path] = []
    for variable in ("ProgramFiles(x86)", "ProgramFiles"):
        value = os.environ.get(variable)
        if value:
            roots.append(Path(value) / "Steam")

    try:
        import winreg

        registry_keys = (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam"),
        )
        for hive, key_name in registry_keys:
            try:
                with winreg.OpenKey(hive, key_name) as key:
                    for value_name in ("SteamPath", "InstallPath"):
                        try:
                            roots.append(Path(winreg.QueryValueEx(key, value_name)[0]))
                        except OSError:
                            pass
            except OSError:
                pass
    except ImportError:
        pass

    roots = _unique(roots)
    libraries = list(roots)
    for root in roots:
        config = root / "steamapps" / "libraryfolders.vdf"
        if not config.is_file():
            continue
        try:
            text = config.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for encoded_path in re.findall(r'"path"\s*"((?:[^"\\]|\\.)*)"', text):
            decoded_path = encoded_path.replace("\\\\", "\\")
            libraries.append(Path(decoded_path))
    return _unique(libraries)


def steam_game_directories() -> list[Path]:
    directories: list[Path] = []
    libraries = steam_roots()
    for library in libraries:
        steamapps = library / "steamapps"
        common = steamapps / "common"
        manifest = steamapps / f"appmanifest_{GAME_APP_ID}.acf"
        install_dir = "Big Walk"
        if manifest.is_file():
            try:
                text = manifest.read_text(encoding="utf-8", errors="replace")
                match = re.search(r'"installdir"\s*"([^"]+)"', text)
                if match:
                    install_dir = match.group(1)
            except OSError:
                pass
        directories.extend((common / install_dir, common / "Big Walk"))
        try:
            directories.extend(
                child for child in common.iterdir()
                if child.is_dir() and (child / GAME_EXE).is_file()
            )
        except OSError:
            pass
    return _unique(directories)


def _matches_audited_build(directory: Path) -> bool:
    for relative, expected in EXPECTED_HASHES.items():
        path = directory / relative
        try:
            if not path.is_file() or sha256_file(path) != expected:
                return False
        except OSError:
            return False
    return True


def find_game_directory(pid: int | None = None) -> Path:
    if pid is not None:
        image_path = running_process_path(pid)
        if image_path and image_path.name.casefold() == GAME_EXE.casefold():
            return image_path.parent

    candidates = steam_game_directories()
    installed = [
        path for path in candidates
        if (path / GAME_EXE).is_file()
        or (path / "GameAssembly.dll").is_file()
    ]
    matching = [path for path in installed if _matches_audited_build(path)]
    if len(matching) == 1:
        return matching[0]
    if len(matching) > 1:
        raise RuntimeError(
            "Found multiple copies of the audited Big Walk build; use the running game's process path to disambiguate: "
            + ", ".join(str(path) for path in matching)
        )
    if len(installed) == 1:
        return installed[0]
    if len(installed) > 1:
        raise RuntimeError(
            "Found multiple Big Walk installs but could not identify the active one: "
            + ", ".join(str(path) for path in installed)
        )
    raise FileNotFoundError(
        "Could not find Big Walk in the registered Steam libraries. Searched: "
        + ", ".join(str(root / "steamapps" / "common") for root in steam_roots())
    )


def verify_game_build(directory: Path) -> None:
    for relative, expected in EXPECTED_HASHES.items():
        path = directory / relative
        if not path.is_file():
            raise RuntimeError(f"Discovered Big Walk install is missing {relative}: {path}")
        actual = sha256_file(path)
        if actual != expected:
            raise RuntimeError(
                f"Big Walk build differs from the audited version: {path} "
                f"(expected {expected}, found {actual})"
            )
