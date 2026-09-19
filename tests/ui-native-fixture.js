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
    if(cmd === "remote_model_resources") return f.models=await Promise.all(["xiaomi.rc003","unicom.hid_ico.v1"].map(async id=>({source:id, model:await (await fetch(`/resources/remotes/${id}/model.json`)).json(), image:await (await fetch(`/resources/remotes/${id}/artwork.svg`)).text()})));
    if (cmd === "save_remote_model") { f.exported=args; return "test/exported-model"; }
    if (cmd === "desktop_platform") return "windows";
    if (cmd === "firmware_package") return null;
    if (cmd === "firmware_lock") return;
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
      const { labels } = await import("/src/core/layout.ts");
      const q = decode(Uint8Array.from(args.data).subarray(0, -1));
      f.writes.push(q.opcode);
      let body = {},
        status = 0;
      const slot = q.body.slot ?? 0,
        model = slot % 2 ? "unicom.hid_ico.v1" : "xiaomi.rc003";
      if(q.opcode===f.failProbeOpcode) status=7;
      else if(q.opcode===0x440) f.probe={active:true,connected:false,pending:false,phase:"scanning",encrypted:false,sdk_error:0,cleanup_error:0,attributes:f.probeFamily===2?10:6,sequence:0};
      else if(q.opcode===0x441) f.probe={...f.probe,active:false,connected:false,phase:"idle"};
      else if(q.opcode===0x442) body=f.probe;
      else if(q.opcode===0x443) f.probe={...f.probe,connected:true,phase:"connected"};
      else if(q.opcode===0x44a) {f.voice={idle:false,active:true,ready:true,armed:true,recording:false,released:false,capture:(f.voice?.capture??0)+1,samples:0,rate:16000,codec:1,peak:0,decode_error:0,sdk_error:0,end_reason:0,error:""};}
      else if(q.opcode===0x44b) body=f.voice;
      else if(q.opcode===0x44c) body={capture:f.voice.capture,offset:q.body.offset,hex:'00'.repeat(Math.min(192,f.voice.samples*2-q.body.offset))};
      else if(q.opcode===0x44d) {if(f.voice){f.voice.armed=f.voice.recording=false;f.voice.idle=true;}}
      else if(q.opcode===0x444) f.probe.encrypted=true;
      else if(q.opcode===0x445 || q.opcode===0x447 || q.opcode===0x448) {}
      else if(q.opcode===0x446) {
        const attrs=[
         {kind:1,handle:1,uuid:"0x1812"},
         {kind:1,handle:20,uuid:"ab5e0001-5a21-4f05-bc7d-af01f617b664"},
         {kind:2,handle:3,uuid:"0x2a4b",length:4,hex:"05010906"},
         {kind:2,handle:5,uuid:"0x2a4d",properties:16},
         {kind:3,handle:6,uuid:"0x2908",parent:5,length:2,hex:"0101"},
         {kind:3,handle:7,uuid:"0x2902",parent:5,length:2,hex:"0000"},
        ];
        if(f.probeFamily===2) {
          attrs.splice(1,1);
          attrs.push({kind:2,handle:10,uuid:"0x2a4d",properties:16},
            {kind:3,handle:11,uuid:"0x2908",parent:10,length:2,hex:"f801"},
            {kind:3,handle:12,uuid:"0x2908",parent:13,length:2,hex:"fc01"},
            {kind:3,handle:14,uuid:"0x2908",parent:15,length:2,hex:"fb02"},
            {kind:3,handle:16,uuid:"0x2908",parent:17,length:2,hex:"fa02"});
        }
        body={index:q.body.index,parent:0,end:19,properties:2,length:0,complete:true,hex:"",...attrs[q.body.index]};
      } else if(q.opcode===0x449) {const r=(f.probeReports??[]).find(r=>r.sequence>q.body.after);if(r)body=r;else status=6;}
      else if (q.opcode === 0x400) {
        f.seq = 0;
        body = { api: 1, lease_ms: 10000, slots: 4 };
      } else if (q.opcode === 0x403)
        body = {
          firmware: "ui-fixture",
          voice_presets: 1,
          host_os: 1,
          slots: 4,
          probe_api:1, probe_voice_api:1, model_api:1, model_capacity:16,
          voice_owner: f.voiceOwner,
          manual_pairing: true,
          scanning: false,
          scan_epoch: 1,
          free_slot: f.count < 4 ? f.count : -1,
        };
      else if(q.opcode === 0x430) {
        const resource=f.models[q.body.index];
        if(!resource)status=6;
        else {const {modelBytes}=await import("/src/core/models.ts");const {crc32c}=await import("/src/core/wire.ts");body={id:resource.model.id,revision:1,crc:crc32c(modelBytes(resource.model))};}
      }
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
        const list = f.models.find(m=>m.model.id===model).model.keys.map(k=>k.id);
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
            rssi: -45, address:"A1:B2:C3:D4:E5:F6",address_type:1,company:123,adv:"020106",response:"",connectable:true,
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
