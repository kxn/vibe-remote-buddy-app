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

PROFILES = {'q2': ('s3-q2-ab1', 'buddy_s3_q2_ab1', 2),
            'o8': ('s3-o8-ab1', 'buddy_s3_o8_ab1', 8),
            'q2-f4': ('s3-q2-f4-ab2', 'buddy_s3_q2_f4_ab2', 2)}

EXPECTED = {0: ('bootloader.bin', 0x8000), 0x8000: ('partition-table.bin', 0x1000),
            0xf000: ('ota_data_initial.bin', 0x2000), 0x20000: ('receiver.bin', 0x200000)}


def event(**value):
    print('\n@buddy:' + json.dumps(value, ensure_ascii=True), flush=True)


def load_package(folder):
    folder = Path(folder)
    manifest = json.loads((folder / 'install.json').read_text(encoding='utf-8'))
    if manifest.get('format') not in (1, 2) or manifest.get('target') not in [v[0] for v in PROFILES.values()]:
        raise ValueError('不支持的安装包目标')
    small = manifest['target'] == 's3-q2-f4-ab2'
    expected = dict(EXPECTED)
    expected[0x20000] = ('receiver.bin', 0x140000 if small else 0x200000)
    if manifest['format'] == 2:
        expected[0x2a0000 if small else 0x420000] = ('factory-nvs.bin', 0x20000)
        expected[0x2e0000 if small else 0x460000] = ('catalog.bin', 0x90000 if small else 0x180000)
    if len(manifest.get('files', [])) != len(expected):
        raise ValueError('安装包缺少镜像')
    images = []
    seen = set()
    for entry in manifest['files']:
        addr = entry['offset']
        name, limit = expected.get(addr, ('', 0))
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
            if data[3] >> 4 != (2 if small else 3):
                raise ValueError('镜像 Flash 布局不匹配: ' + name)
        if name == 'receiver.bin':
            if len(data) < 288 or struct.unpack_from('<I', data, 32)[0] != 0xabcd5432:
                raise ValueError('缺少应用描述符')
            text = lambda off: data[off:off+32].split(b'\0')[0].decode()
            if text(80) != next(v[1] for v in PROFILES.values() if v[0] == manifest['target']) or text(48) != manifest['version']:
                raise ValueError('固件版本或分区 ABI 不匹配')
        if name == 'partition-table.bin' and manifest['format'] == 2:
            table = {}
            for off in range(0, len(data)-31, 32):
                magic, typ, sub, start, size, label, flags = struct.unpack_from('<HBBII16sI', data, off)
                if magic != 0x50aa: break
                table[label.split(b'\0')[0].decode()] = (start,size)
            base = 0x2a0000 if small else 0x420000
            app = 0x140000 if small else 0x200000
            bank = 0x90000 if small else 0x180000
            required = {'nvs':(0x9000,0x6000),'otadata':(0xf000,0x2000), 'ota_0':(0x20000,app), 'ota_1':(0x20000+app,app), 'data0':(base,0x20000), 'data1':(base+0x20000,0x20000), 'catalog0':(base+0x40000,bank), 'catalog1':(base+0x40000+bank,bank)}
            if table != required: raise ValueError('分区表与固件目标不匹配')
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
    if size_id not in (22, 23, 24):
        raise ValueError(f'仅支持 4 / 8 / 16 MB Flash，检测 ID=0x{flash_id:06x}')
    if esp.flash_type() != 0:
        raise ValueError('不支持 Octal Flash')
    cap = esp.get_psram_cap()
    if cap not in (0, 1, 2):
        capacity = {2: '2 MB', 3: '16 MB', 4: '4 MB'}.get(cap, '未知容量')
        raise ValueError(f'仅支持 2 MB Quad / 8 MB Octal PSRAM，检测到内置 {capacity}（efuse capacity={cap}）')
    if size_id == 22 and cap == 1:
        raise ValueError('4 MB Flash 目标仅支持 2 MB Quad PSRAM')
    return dict(chip=esp.CHIP_NAME, mac=bytes(esp.read_mac()).hex().upper(),
                flash_bytes=1 << size_id, psram_known=cap != 0, variant=('q2-f4' if size_id == 22 and cap == 2 else {1: 'o8', 2: 'q2'}.get(cap, '')),
                description=esp.get_chip_description())


def restart(esp):
    # USB Serial/JTAG's RTS reset can retain the ROM download strap. Use the
    # SDK tool's full watchdog reset for this transport, after clearing FORCE_DL.
    if esp.CHIP_NAME == 'ESP32-S3' and esp.uses_usb_jtag_serial():
        esp.write_reg(esp.RTC_CNTL_OPTION1_REG, 0, esp.RTC_CNTL_FORCE_DOWNLOAD_BOOT_MASK)
        esp.watchdog_reset()
    else:
        esp.hard_reset()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('operation', choices=['check', 'install', 'reset', 'validate'])
    p.add_argument('--port')
    p.add_argument('--package', required=True)
    p.add_argument('--expected-mac')
    p.add_argument('--confirm-board', action='store_true')
    p.add_argument('--variant', choices=list(PROFILES))
    a = p.parse_args()
    folder = Path(a.package)
    catalog = json.loads((folder / 'catalog.json').read_text(encoding='utf-8'))
    variants = catalog.get('variants', [])
    if catalog.get('format') != 1 or variants not in (['q2','o8'], ['q2','o8','q2-f4']):
        raise ValueError('不支持的安装包目录')
    packages = {v: load_package(folder / v) for v in variants}
    for v, (m, _) in packages.items():
        if m['target'] != PROFILES[v][0]: raise ValueError('安装包类型不匹配')
    versions = {m['version'] for m, _ in packages.values()}
    if len(versions) != 1: raise ValueError('安装包版本不一致')
    version = versions.pop()
    if a.operation == 'validate':
        event(phase='validated', version=version)
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
            restart(esp)
            event(phase='reset')
            return
        if a.operation == 'check':
            event(phase='checked', info={**info, 'version': version, 'target': PROFILES[info['variant']][0] if info['variant'] else ''})
            return
        if not a.expected_mac or (not info['psram_known'] and not a.confirm_board):
            raise ValueError('缺少设备身份或板型确认')
        if not a.variant or (info['variant'] and info['variant'] != a.variant):
            raise ValueError('固件类型与设备不匹配')
        if a.variant not in packages or (info['flash_bytes'] == 4194304) != (a.variant == 'q2-f4'):
            raise ValueError('安装包与 Flash 容量不匹配')
        manifest, images = packages[a.variant]
        info.update(target=manifest['target'], variant=a.variant)
        # Same live connection from identity/security inspection through erase/write.
        esp = esp.run_stub()
        esp.WRITE_FLASH_ATTEMPTS = 1
        esp.flash_set_parameters(info['flash_bytes'])
        with ExitStack() as stack:
            args = SimpleNamespace(
                compress=True, no_compress=False, no_stub=False, force=False,
                encrypt=False, encrypt_files=None, ignore_flash_encryption_efuse_setting=False,
                flash_size='keep', flash_mode='keep', flash_freq='keep', erase_all=True,
                chip='esp32s3', addr_filename=[(off, stack.enter_context(path.open('rb'))) for off, path in images],
            )
            event(phase='writing')
            cmds.write_flash(esp, args)
            event(phase='verifying')
            for _, f in args.addr_filename:
                f.seek(0)
            cmds.verify_flash(esp, args)
        event(phase='restarting')
        restart(esp)
        event(phase='written', info={**info, 'version': manifest['version']})
    except Exception:
        # A rejected check must return the untouched board to its original program.
        # Do not reboot an interrupted install or a device with a mismatched identity.
        if esp and a.operation == 'check':
            try:
                restart(esp)
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
