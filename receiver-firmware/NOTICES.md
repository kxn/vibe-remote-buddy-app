# Receiver firmware notices

These ESP32-S3 firmware binaries are separate from the MIT desktop application.
The application's MIT license does not relicense the complete linked firmware.

- ESP-IDF 5.4.0: Espressif, Apache-2.0 and component-specific licenses.
- NimBLE: Apache Mynewt, Apache-2.0.
- esp_tinyusb 1.7.6: Espressif, Apache-2.0.
- TinyUSB 0.21.0~2: Ha Thach and contributors, MIT.
- OI SBC/mSBC decoder from ESP-IDF: Copyright 2006 Open Interface North America,
  Inc.; Copyright 2014 The Android Open Source Project, Apache-2.0.
- G.722.1 fixed-point reference decoder: ITU-T G.722.1 (2005), Polycom (2004).
  Downloaded from pjsip/pjproject `third_party/g7221`; original Polycom/ITU and
  pjproject declarations apply. See the retained upstream declarations in
  `licenses/`. The firmware links this decoder; it is not an MIT-only binary.

Upstream projects: https://github.com/espressif/esp-idf/tree/v5.4,
https://github.com/apache/mynewt-nimble, https://github.com/hathach/tinyusb,
https://github.com/pjsip/pjproject/tree/master/third_party/g7221.

This repository currently publishes release binaries, not the private firmware
source. Retaining these notices does not replace any applicable source-distribution
or other license obligations. The publisher is reviewing source publication and
decoder replacement separately; no additional redistribution rights are granted
by this notice.
