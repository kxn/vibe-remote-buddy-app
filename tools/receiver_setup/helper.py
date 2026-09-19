"""Separate esptool-based installer process; GPL-2.0-or-later distribution.

Never retries writes after disconnect. Never accepts arbitrary offsets from UI.
"""
import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import struct
import sys
from types import SimpleNamespace

EXPECTED = {0: ('bootloader.bin', 0x8000), 0x8000: ('partition-table.bin', 0x1000),
            0xf000: ('ota_data_initial.bin', 0x2000), 0x20000: ('receiver.bin', 0x200000)}


def event(**value):
    print('\n@buddy:' + json.dumps(value, ensure_ascii=True), flush=True)


def load_package(folder):
    folder = Path(folder)
    manifest = json.loads((folder / 'install.json').read_text(encoding='utf-8'))
    if manifest.get('format') != 1 or manifest.get('target') != 's3-16m-8m-ab1':
        raise ValueError('不支持的安装包目标')
    if len(manifest.get('files', [])) != len(EXPECTED):
        raise ValueError('安装包缺少镜像')
    images = []
    seen = set()
    for entry in manifest['files']:
        addr = entry['offset']
        name, limit = EXPECTED.get(addr, ('', 0))
        if addr in seen or entry['name'] != name:
            raise ValueError('安装包地址或文件名不正确')
        seen.add(addr)
        data = (folder / name).read_bytes()
        if not 0 < len(data) <= limit or len(data) != entry['size']:
            raise ValueError('镜像长度不正确: ' + name)
        if hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('镜像校验失败: ' + name)
        if name in ('receiver.bin', 'bootloader.bin'):
            if len(data) < 24 or data[0] != 0xe9 or struct.unpack_from('<H', data, 12)[0] != 9:
                raise ValueError('不是 ESP32-S3 镜像: ' + name)
        if name == 'receiver.bin':
            if len(data) < 288 or struct.unpack_from('<I', data, 32)[0] != 0xabcd5432:
                raise ValueError('缺少应用描述符')
            text = lambda off: data[off:off+32].split(b'\0')[0].decode()
            if text(80) != 'buddy_s3_ab1' or text(48) != manifest['version']:
                raise ValueError('固件版本或分区 ABI 不匹配')
        images.append((addr, folder / name))
    return manifest, sorted(images)


def inspect(esp):
    if esp.CHIP_NAME != 'ESP32-S3':
        raise ValueError('不支持的芯片: ' + esp.CHIP_NAME)
    if esp.secure_download_mode or esp.get_secure_boot_enabled() or esp.get_flash_encryption_enabled():
        raise ValueError('设备启用了安全保护，禁止初始化')
    esp.flash_spi_attach(0)
    flash_id = esp.flash_id()
    size_id = (flash_id >> 16) & 0xff
    if size_id != 24:
        raise ValueError(f'此安装包要求 16 MB Flash，检测 ID=0x{flash_id:06x}')
    cap = esp.get_psram_cap()
    if cap not in (0, 1):
        capacity = {2: '2 MB', 3: '16 MB', 4: '4 MB'}.get(cap, '未知容量')
        raise ValueError(f'此安装包要求 8 MB Octal PSRAM，检测到内置 {capacity}（efuse capacity={cap}）')
    return dict(chip=esp.CHIP_NAME, mac=bytes(esp.read_mac()).hex().upper(),
                flash_bytes=1 << size_id, psram_known=cap == 1,
                description=esp.get_chip_description())


def main():
    p = argparse.ArgumentParser()
    p.add_argument('operation', choices=['check', 'install', 'reset', 'validate'])
    p.add_argument('--port')
    p.add_argument('--package', required=True)
    p.add_argument('--expected-mac')
    p.add_argument('--confirm-board', action='store_true')
    a = p.parse_args()
    manifest, images = load_package(a.package)  # Validate before touching any device.
    if a.operation == 'validate':
        event(phase='validated', version=manifest['version'])
        return
    import esptool
    from esptool import cmds
    esp = None
    try:
        event(phase='connecting')
        esp = cmds.detect_chip(port=a.port, connect_attempts=2)
        info = inspect(esp)
        if a.expected_mac and info['mac'] != a.expected_mac:
            raise ValueError('设备身份已改变，请重新选择设备')
        if a.operation == 'reset':
            esp.hard_reset()
            event(phase='reset')
            return
        if a.operation == 'check':
            event(phase='checked', info={**info, 'version': manifest['version']})
            return
        if not a.expected_mac or (not info['psram_known'] and not a.confirm_board):
            raise ValueError('缺少设备身份或板型确认')
        # Same live connection from identity/security inspection through erase/write.
        esp = esp.run_stub()
        esp.WRITE_FLASH_ATTEMPTS = 1
        esp.flash_set_parameters(16 * 1024 * 1024)
        with ExitStack() as stack:
            args = SimpleNamespace(
                compress=True, no_compress=False, no_stub=False, force=False,
                encrypt=False, encrypt_files=None, ignore_flash_encryption_efuse_setting=False,
                flash_size='16MB', flash_mode='keep', flash_freq='keep', erase_all=True,
                chip='esp32s3', addr_filename=[(off, stack.enter_context(path.open('rb'))) for off, path in images],
            )
            event(phase='writing')
            cmds.write_flash(esp, args)
            event(phase='verifying')
            for _, f in args.addr_filename:
                f.seek(0)
            cmds.verify_flash(esp, args)
        event(phase='restarting')
        esp.hard_reset()
        event(phase='written', info={**info, 'version': manifest['version']})
    except Exception:
        # A rejected check must return the untouched board to its original program.
        # Do not reboot an interrupted install or a device with a mismatched identity.
        if esp and a.operation == 'check':
            try:
                esp.hard_reset()
            except Exception as reset_error:
                print(f'恢复原程序失败，请按 RESET：{reset_error}', flush=True)
        raise
    finally:
        if esp:
            esp._port.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        event(phase='error', error=f'{type(exc).__name__}: {exc}')
        sys.exit(1)
