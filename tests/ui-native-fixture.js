// Browser-only test fixture. Injected by Playwright; never imported by the app.
window.isTauri = true;
window.fixture = {
  count: 4,
  voiceOwner: 255,
  rx: [],
  seq: 0,
  session: 44,
  writes: [],
  settings: { schema: 1, background: true, boards: {} },
  maps: {},
};
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args = {}) => {
    const f = window.fixture;
    if (cmd === "desktop_available") return true;
    if (cmd === "desktop_windows") return [{ token: "123:10", title: "ChatGPT", process: "ChatGPT.exe", path: "C:\\Apps\\ChatGPT.exe" }];
    if (cmd === "ports")
      return [
        { path: "TEST", serial: "UI-FIXTURE", name: "Vibe Remote Buddy" },
      ];
    if (cmd === "load_settings") return f.settings;
    if (cmd === "save_settings") {
      f.settings = args.value;
      return;
    }
    if (
      cmd === "set_background" ||
      cmd === "serial_open" ||
      cmd === "serial_close"
    )
      return;
    if (cmd === "plugin:autostart|is_enabled") return false;
    if (cmd === "serial_read") {
      const data = f.rx;
      f.rx = [];
      return data;
    }
    if (cmd === "serial_write") {
      const { decode, encode } = await import("/src/core/wire.ts");
      const { layouts, labels } = await import("/src/core/layout.ts");
      const q = decode(Uint8Array.from(args.data).subarray(0, -1));
      f.writes.push(q.opcode);
      let body = {},
        status = 0;
      const slot = q.body.slot ?? 0,
        model = slot % 2 ? "unicom.hid_ico.v1" : "xiaomi.rc003";
      if (q.opcode === 0x400) {
        f.seq = 0;
        body = { api: 1, lease_ms: 10000, slots: 4 };
      } else if (q.opcode === 0x403)
        body = {
          firmware: "ui-fixture",
          slots: 4,
          voice_owner: f.voiceOwner,
          manual_pairing: true,
          scanning: false,
          scan_epoch: 1,
          free_slot: f.count < 4 ? f.count : -1,
        };
      else if (q.opcode === 0x404)
        body = {
          slot,
          peer_id: slot < f.count ? slot + 1 : 0,
          generation: 1,
          state: slot < f.count ? 5 : 0,
          name: slot % 2 ? `书房联通 ${slot + 1}` : `客厅小米 ${slot + 1}`,
          model,
          battery: slot % 2 ? 255 : 97,
          map_revision: 1,
        };
      else if (q.opcode === 0x40a) {
        const list = layouts[model].flat().filter(Boolean);
        const key = list[q.body.index];
        if (key)
          body = {
            key,
            name: labels[key],
            model,
            count: list.length,
            kind: key === 2 ? 3 : 1,
            modifiers: key === 2 ? 64 : 0,
            value: key === 2 ? 0 : 40,
            layout: null,
          };
        else status = 6;
      } else if (q.opcode === 0x40b)
        body = f.maps[`${slot}:${q.body.key}`] ?? {
          key: q.body.key,
          kind: q.body.key === 2 ? 3 : 1,
          modifiers: q.body.key === 2 ? 64 : 0,
          value: q.body.key === 2 ? 0 : 40,
          revision: 1,
        };
      else if (q.opcode === 0x40c) {
        body = { revision: 2 };
        f.maps[`${slot}:${q.body.key}`] = { ...q.body, revision: 2 };
      } else if (q.opcode === 0x405) body = { scan_epoch: 1 };
      else if (q.opcode === 0x406) {
        if (q.body.index === 0)
          body = {
            candidate_id: 1,
            scan_epoch: 1,
            name: "小米 Remote 2 Pro",
            rssi: -45,
            known: true,
            bound_slot: -1,
            age_ms: 1,
          };
        else status = 6;
      } else if (q.opcode === 0x40e) body = { sequence: 0, code: 0 };
      else if (![0x401, 0x402, 0x410].includes(q.opcode))
        throw Error("Unexpected mutation in UI fixture " + q.opcode);
      f.rx.push(
        ...encode({
          kind: 2,
          session: f.session,
          seq: ++f.seq,
          request: q.request,
          opcode: q.opcode,
          status,
          body,
        }),
      );
      return;
    }
    throw Error("Unhandled native command: " + cmd);
  },
};
