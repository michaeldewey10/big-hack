from pathlib import Path
import sys
import os
ROOT = Path(SPECPATH)
WORKSPACE = ROOT.parent
FRIDA = Path(os.environ.get("BIG_HACK_FRIDA_PATH", str(ROOT / "vendor")))
sys.path.insert(0, str(FRIDA))
from PyInstaller.utils.hooks import collect_all
datas, binaries, hidden = collect_all('frida')
for name in ('Big-Walk-Pickup.py', 'telemetry.js', 'you_settings.js', 'fun_actions.js', 'character_tools.js', 'camera_tools.js', 'location_tools.js', 'pocket_tools.js', 'flare_tools.js', 'big_walk_commands.py', 'big_walk_paths.py'):
    datas.append((str(ROOT / name), '.'))
a = Analysis([str(ROOT / 'bridge.py')], pathex=[str(ROOT), str(FRIDA)],
    binaries=binaries, datas=datas, hiddenimports=hidden+['frida','big_walk_paths','big_walk_commands'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='BigHackBridge',
    console=True, debug=False, strip=False, upx=False)
