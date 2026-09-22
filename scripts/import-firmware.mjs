import fs from "node:fs";
import path from "node:path";
import { root, variants, validateFirmware } from "./release-inputs.mjs";
const source = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw Error("Usage: npm run firmware:import -- <complete release directory>");
validateFirmware(source);
const destination = path.join(root, "receiver-firmware");
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(
  path.join(source, "catalog.json"),
  path.join(destination, "catalog.json"),
);
// Explicit allowlist: never copy ELF/map files, private source trees or local data.
for (const variant of variants) {
  fs.mkdirSync(path.join(destination, variant), { recursive: true });
  for (const name of [
    "manifest.json",
    "install.json",
    "receiver.bin",
    "bootloader.bin",
    "partition-table.bin",
    "ota_data_initial.bin",
    "factory-nvs.bin",
    "catalog.bin",
  ])
    fs.copyFileSync(
      path.join(source, variant, name),
      path.join(destination, variant, name),
    );
}
console.log(validateFirmware(destination));
