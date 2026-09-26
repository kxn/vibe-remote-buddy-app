"""Build the public firmware submodule and make a complete App installer input."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
FIRMWARE = ROOT / "firmware"
PACKAGE_ROOT = ROOT / "build/firmware-from-source"
VARIANTS = ("q2", "o8", "q2-f4")
PROJECTS = {
    "q2": ("buddy_s3_q2_ab1", "s3-q2-ab1"),
    "o8": ("buddy_s3_o8_ab1", "s3-o8-ab1"),
    "q2-f4": ("buddy_s3_q2_f4_ab2", "s3-q2-f4-ab2"),
}


def run(*command: object, cwd: Path = ROOT) -> None:
    print("+", " ".join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, check=True)


def git(*args: str, cwd: Path = ROOT) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def entry(offset: int, name: str, data: bytes) -> dict:
    return {"offset": offset, "name": name, "size": len(data), "sha256": digest(data)}


def image_descriptor(image: bytes, project: str) -> str:
    if len(image) < 288 or image[0] != 0xE9 or struct.unpack_from("<H", image, 12)[0] != 9:
        raise ValueError("Not an ESP32-S3 application image")
    if struct.unpack_from("<I", image, 32)[0] != 0xABCD5432:
        raise ValueError("Missing ESP application descriptor")

    def text(offset: int) -> str:
        return image[offset:offset + 32].split(b"\0", 1)[0].decode("ascii")

    if text(80) != project:
        raise ValueError(f"Image project differs from {project}")
    return text(48)


def idf_python_and_generator(build: Path) -> tuple[Path, Path]:
    cache = (build / "CMakeCache.txt").read_text(encoding="utf-8")
    python = next((line.split("=", 1)[1] for line in cache.splitlines()
                   if line.startswith("PYTHON:")), None)
    idf = os.environ.get("IDF_PATH", str(Path.home() / "esp/esp-idf") if os.name == "nt" else "")
    if not python or not idf:
        raise ValueError("ESP-IDF build cache or IDF_PATH is missing")
    generator = Path(idf) / "components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py"
    if not generator.is_file():
        raise ValueError(f"NVS generator not found: {generator}")
    return Path(python), generator


def package_variant(variant: str, stage: Path, catalog: bytes) -> None:
    project, target = PROJECTS[variant]
    build = FIRMWARE / "build" / f"esp32s3-{variant}"
    layout = json.loads((build / "flasher_args.json").read_text(encoding="utf-8"))
    expected = {
        "0x0": "bootloader/bootloader.bin",
        "0x8000": "partition_table/partition-table.bin",
        "0xf000": "ota_data_initial.bin",
        "0x20000": project + ".bin",
    }
    if layout.get("flash_files") != expected:
        raise ValueError(f"Unexpected flash layout for {variant}")
    image = (build / (project + ".bin")).read_bytes()
    version = image_descriptor(image, project)
    if len(image) > (0x140000 if variant == "q2-f4" else 0x200000):
        raise ValueError(f"Application exceeds {variant} partition")
    if len(catalog) > (0x90000 if variant == "q2-f4" else 0x180000):
        raise ValueError(f"Catalog exceeds {variant} partition")
    folder = stage / variant
    folder.mkdir()
    files = []
    for offset, source in expected.items():
        name = "receiver.bin" if offset == "0x20000" else Path(source).name
        data = (build / source).read_bytes()
        if name == "receiver.bin" and data != image:
            raise ValueError("Factory image differs from update image")
        (folder / name).write_bytes(data)
        files.append(entry(int(offset, 16), name, data))
    csv = PACKAGE_ROOT / "factory-nvs.csv"
    csv.write_text("key,type,encoding,value\ncatalog,namespace,,\nactive,data,u32,0\n",
                   encoding="utf-8")
    python, generator = idf_python_and_generator(build)
    nvs = PACKAGE_ROOT / "factory-nvs.bin"
    run(python, generator, "generate", csv, nvs, "0x20000")
    for offset, name, data in (
        (0x2A0000 if variant == "q2-f4" else 0x420000, "factory-nvs.bin", nvs.read_bytes()),
        (0x2E0000 if variant == "q2-f4" else 0x460000, "catalog.bin", catalog),
    ):
        (folder / name).write_bytes(data)
        files.append(entry(offset, name, data))
    manifest = {
        "format": 1, "target": target, "version": version, "size": len(image),
        "sha256": digest(image), "data_min": 1, "data_max": 3, "notes": "",
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                          encoding="utf-8")
    (folder / "install.json").write_text(
        json.dumps({"format": 2, "target": target, "version": version, "files": files}, indent=2) + "\n",
        encoding="utf-8")


def verify_submodule(latest: bool) -> str:
    if latest:
        if FIRMWARE.is_dir() and (FIRMWARE / ".git").exists() and git("status", "--porcelain", cwd=FIRMWARE):
            raise ValueError("Commit or discard firmware submodule edits before --latest")
        run("git", "submodule", "update", "--init", "--remote", "--", "firmware")
    elif not (FIRMWARE / "tools/build_firmware.py").is_file():
        run("git", "submodule", "update", "--init", "--", "firmware")
    if not (FIRMWARE / "tools/build_firmware.py").is_file():
        raise ValueError("Public firmware submodule is incomplete")
    return git("rev-parse", "HEAD", cwd=FIRMWARE)


def package() -> None:
    PACKAGE_ROOT.mkdir(parents=True, exist_ok=True)
    latest, stage, previous = (PACKAGE_ROOT / name for name in ("latest", ".staging", ".previous"))
    for path in (latest, stage, previous):
        if path.resolve().parent != PACKAGE_ROOT.resolve():
            raise ValueError("Package path escaped build/firmware-from-source")
    if stage.exists() or previous.exists():
        raise ValueError("Resolve interrupted firmware package transaction first")
    stage.mkdir()
    try:
        catalog = PACKAGE_ROOT / "catalog.bin"
        run("node", ROOT / "scripts/compile-catalog.mjs", ROOT / "resources/catalog", catalog, "1")
        data = catalog.read_bytes()
        for variant in VARIANTS:
            package_variant(variant, stage, data)
        (stage / "catalog.json").write_text(
            json.dumps({"format": 1, "variants": list(VARIANTS)}) + "\n", encoding="utf-8")
        run("node", "--input-type=module", "-e",
            "import {validateFirmware} from './scripts/release-inputs.mjs'; "
            "console.log(validateFirmware(process.argv[1]));", stage)
        if latest.exists():
            latest.rename(previous)
        try:
            stage.rename(latest)
        except Exception:
            if previous.exists():
                previous.rename(latest)
            raise
    except Exception:
        shutil.rmtree(stage)
        raise
    if previous.exists():
        shutil.rmtree(previous)
    print(f"Complete firmware package: {latest}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latest", action="store_true",
                        help="advance firmware submodule to its latest main commit")
    parser.add_argument("--package-only", action="store_true",
                        help="package existing firmware/build outputs without recompiling")
    args = parser.parse_args()
    revision = verify_submodule(args.latest)
    print(f"Firmware source: {revision}", flush=True)
    if not args.package_only:
        run(sys.executable, FIRMWARE / "tools/build_firmware.py")
    package()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        sys.exit(f"Firmware source build failed: {exc}")
