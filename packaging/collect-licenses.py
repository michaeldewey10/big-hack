"""Collect local Cargo dependency notices for the portable distribution."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--locked", "--format-version", "1",
        "--filter-platform", "x86_64-pc-windows-msvc",
        "--manifest-path", str(root / "Cargo.toml"),
    ], text=True, encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    packages = []
    for package in sorted(metadata["packages"], key=lambda p: (p["name"], p["version"])):
        if package["name"] == "big-hack" and not package.get("source"):
            continue
        directory = Path(package["manifest_path"]).parent
        notices = sorted({
            file for file in directory.iterdir()
            if file.is_file() and file.name.upper().startswith(("LICENSE", "LICENCE", "COPYING", "NOTICE"))
        })
        if package.get("license_file"):
            license_file = directory / package["license_file"]
            if license_file.is_file():
                notices = sorted(set(notices) | {license_file})
        label = f'{package["name"]}-{package["version"]}'
        destination = args.output / "rust" / label
        if notices:
            destination.mkdir(parents=True, exist_ok=True)
            for file in notices:
                shutil.copyfile(file, destination / file.name)
        packages.append({
            "name": package["name"], "version": package["version"],
            "license": package.get("license"), "repository": package.get("repository"),
            "source": package.get("source"), "notice_files": [file.name for file in notices],
        })
    (args.output / "RUST-DEPENDENCIES.json").write_text(
        json.dumps(packages, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Collected local dependency notices for {len(packages)} Rust packages.")


if __name__ == "__main__":
    main()
