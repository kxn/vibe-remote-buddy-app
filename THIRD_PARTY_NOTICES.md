# Sources and third-party licenses

Original application code and icons: Copyright (c) 2026 kxn, MIT (see LICENSE).

The RBP/3 framing and management client draw on https://github.com/kxn/mi-remote-usb-bridge (MIT, Copyright 2026 kxn). This application implements Buddy v1 JSON management; it does not include that project's firmware, WCH SDK, Bluetooth stack, or audio decoders.

Application/window actions reference https://github.com/kxn/remote-voice-input at commit 8a13ae0c436583534eeb74e1a912a1cf1ad73458 (MIT, Copyright 2026 kxn). See docs/actions.md. No ASR implementation, credentials, or third-party service key acquisition code is included.

Dependencies are downloaded by their package managers, with exact versions in package-lock.json and src-tauri/Cargo.lock. They retain their own licenses, including:

- Tauri and its plugins: MIT or Apache-2.0.
- React / React DOM: MIT.
- Lucide: ISC.
- Vite and Vitest: MIT.
- TypeScript: Apache-2.0.
- Microsoft windows / windows-sys crates: MIT or Apache-2.0.
- serialport: MPL-2.0.
- rfd: MIT.
- open: MIT.
- Python Playwright (optional UI tests): Apache-2.0.

This is a summary, not a replacement for dependency license texts. Binary distributors must retain applicable notices and comply with all dependency terms, including MPL-covered source requirements. Receiver firmware is a separate project and is not licensed or distributed by this repository.


## Receiver initialization helper

The desktop application remains MIT licensed. `tools/receiver_setup/helper.py` is a separately executed GPL-2.0-or-later helper using [Espressif esptool 4.12.0](https://github.com/espressif/esptool/tree/v4.12.0). Its license is in `tools/receiver_setup/LICENSE`. Windows portable packages include the helper source, exact esptool source archive, and dependency notices under `resources/installer/source` and `resources/installer/licenses`. The helper is packaged using PyInstaller (GPL with its bootloader exception); it does not include receiver firmware in this public repository.
