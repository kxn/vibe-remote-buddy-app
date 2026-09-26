import fs from "node:fs";
import path from "node:path";

export function copyFirmwareNotices(destination, fromSource) {
  fs.mkdirSync(destination, { recursive: true });
  if (!fromSource) {
    fs.copyFileSync("receiver-firmware/NOTICES.md", path.join(destination, "FIRMWARE-NOTICES.md"));
    fs.cpSync("receiver-firmware/licenses", path.join(destination, "firmware-licenses"),
      { recursive: true });
    return;
  }
  fs.copyFileSync("firmware/THIRD_PARTY_NOTICES.md", path.join(destination, "FIRMWARE-NOTICES.md"));
  const licenses = path.join(destination, "firmware-licenses");
  fs.mkdirSync(licenses, { recursive: true });
  fs.copyFileSync("firmware/LICENSE", path.join(licenses, "firmware-MIT.txt"));
  for (const name of ["ESP-IDF.txt", "NimBLE.txt", "esp_tinyusb.txt",
    "TinyUSB.txt", "G7221-reference.txt"])
    fs.copyFileSync(path.join("receiver-firmware/licenses", name), path.join(licenses, name));
}
