"""Build the standalone Windows installer helper; no firmware is included."""
from pathlib import Path
import hashlib
import os
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[1]
if sys.platform != 'win32':
    print('Receiver initialization helper: Windows only')
    sys.exit(0)
source = root / 'tools/receiver_setup'
work = root / 'build/setup-helper'
stamp = hashlib.sha256(b''.join((source / f).read_bytes() for f in ['helper.py', 'requirements.txt']) + Path(__file__).read_bytes()).hexdigest()
exe = work / 'dist/receiver-setup/receiver-setup.exe'
if exe.exists() and (work / 'stamp').exists() and (work / 'stamp').read_text() == stamp:
    print('Receiver setup helper is current')
    sys.exit(0)
py = work / 'venv/Scripts/python.exe'
if not py.exists():
    venv.EnvBuilder(with_pip=True).create(work / 'venv')
env = dict(os.environ, PYTHONUTF8='1')
def run(args): subprocess.run([str(x) for x in args], cwd=root, env=env, check=True)
run([py, '-m', 'pip', 'install', '-r', source / 'requirements.txt'])
run([py, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'receiver-setup',
     '--collect-all', 'esptool', '--collect-all', 'esptool.targets',
     '--distpath', work / 'dist', '--workpath', work / 'pyinstaller', '--specpath', work,
     source / 'helper.py'])
# Supply the exact esptool source alongside its independently executed binary.
run([py, '-m', 'pip', 'download', '--no-deps', '--no-binary', ':all:', '--dest', work / 'sources', 'esptool==4.12.0'])
import importlib.metadata, shutil
license_dir=work/'dist/receiver-setup/licenses'
license_dir.mkdir(exist_ok=True)
for distribution in (work/'venv/Lib/site-packages').glob('*.dist-info'):
    dest=license_dir/distribution.name
    dest.mkdir(exist_ok=True)
    for item in distribution.iterdir():
        if item.name.lower().startswith(('license','copying','notice','metadata')):
            if item.is_dir(): shutil.copytree(item,dest/item.name,dirs_exist_ok=True)
            else: shutil.copy2(item,dest/item.name)
(work / 'stamp').write_text(stamp)
