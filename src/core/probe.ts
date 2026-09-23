import {familyEvidence} from "./voice-protocols";
export {familyEvidence} from "./voice-protocols";
import { candidateStream } from "./candidates";
import { NearbyCandidates, PAIR_MIN_RSSI } from "./discovery";
import { OP, DeviceError, sleep } from "./session";
import { crc32c } from "./wire";
import { validateModel, type RemoteModel } from "./models";
export type ProbeCommand = <T = Record<string, unknown>>(
  op: number,
  body?: Record<string, unknown>,
) => Promise<T>;
export interface ProbeStatus {
  active: boolean;
  phase: string;
  connected: boolean;
  pending: boolean;
  encrypted: boolean;
  sdk_error: number;
  error_phase?: string;
  error_handle?: number;
  disconnect_reason?: number;
  cleanup_error: number;
  attributes: number;
  sequence: number;
}
export interface ProbeCandidate {
  candidate_id: number;
  scan_epoch: number;
  name: string;
  rssi: number;
  company: number;
  address: string;
  address_type: number;
  adv: string;
  response: string;
  connectable: boolean;
  bound_slot: number;
  age_ms: number;
}
export interface ProbeAttribute {
  index: number;
  kind: number;
  handle: number;
  parent: number;
  end: number;
  properties: number;
  uuid: string;
  length: number;
  complete: boolean;
  hex: string;
  read_error?: string;
}
export interface ProbeReport {
  sequence: number;
  lost: number;
  time_ms: number;
  handle: number;
  length: number;
  hex: string;
}
export function bytes(hex: string) {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw Error("无效的十六进制数据");
  return Uint8Array.from(hex.match(/../g) ?? [], (x) => parseInt(x, 16));
}
export function isUuid(a: ProbeAttribute, id: number) {
  return (
    a.uuid.toLowerCase().replace(/^0x/, "") === id.toString(16).padStart(4, "0")
  );
}
export function reportId(attrs: ProbeAttribute[], handle: number) {
  const a = attrs.find(
    (a) =>
      a.parent === handle &&
      isUuid(a, 0x2908) &&
      a.complete &&
      a.hex.length === 4,
  );
  return a && bytes(a.hex)[1] === 1 ? bytes(a.hex)[0] : undefined;
}
export function decodeKey(
  report: ProbeReport,
  attrs: ProbeAttribute[],
): { report: number; usages: number[] } | undefined {
  const id = reportId(attrs, report.handle),
    v = bytes(report.hex);
  if (v.length !== report.length) return;
  if (
    id === 248 &&
    v.length === 20 &&
    v[0] === 0x82 &&
    v[1] === 3 &&
    v[2] <= 1 &&
    v.slice(3).every((x) => x === 0)
  )
    return { report: 248, usages: v[2] ? [1] : [] };
  if (id === 1 && v.length === 8 && v[0] === 0 && v[1] === 0) {
    const usages = [...new Set([...v.slice(2)].filter(Boolean))];
    if (usages.some((x) => x <= 3)) return;
    return { report: id, usages };
  }
  if (id === 3 && v.length === 2) {
    const usage = v[0] | (v[1] << 8);
    return { report: id, usages: usage ? [usage] : [] };
  }
}
// HID/ICO exposes a dedicated voice edge channel alongside keyboard reports.
// Match both edges on that channel; the keyboard echo is not another button.
export function decodeProbeKey(
  report: ProbeReport,
  attrs: ProbeAttribute[],
  key: number,
  family: number,
) {
  const decoded = decodeKey(report, attrs);
  if (!decoded) return;
  const dedicatedVoice =
    family === 2 &&
    attrs.some(
      (a) =>
        a.kind === 3 &&
        isUuid(a, 0x2908) &&
        a.complete &&
        a.hex.toLowerCase() === "f801",
    );
  if (key === 2 && dedicatedVoice)
    return decoded.report === 248 ? decoded : undefined;
  if (decoded.report === 248) return;
  return decoded;
}
export const probeStages: Record<string, string> = {
  scanning: "搜索",
  connecting: "建立 BLE 连接",
  pairing: "配对加密",
  discovering: "发现服务",
  services: "发现服务",
  characteristics: "发现特征",
  descriptors: "发现描述符",
  reading: "读取属性",
  subscribing: "订阅按键",
  connected: "连接",
  disconnected: "断开",
  closing: "清理连接",
  idle: "空闲",
};
export function sdkError(code: number): string {
  const host: Record<number, string> = {
    2: "操作已在进行",
    3: "参数无效",
    5: "未找到",
    6: "内存不足",
    7: "连接已不存在（BLE_HS_ENOTCONN）",
    8: "不支持此操作",
    13: "操作超时",
    15: "设备忙",
    23: "需要认证",
    24: "需要授权",
    25: "需要加密",
    27: "绑定存储已满",
  };
  const att: Record<number, string> = {
    5: "需要认证",
    8: "需要授权",
    15: "需要加密",
  };
  const hci: Record<number, string> = {
    8: "连接监督超时",
    19: "对端主动断开",
    22: "本端主动断开",
    62: "未能建立连接",
  };
  const label =
    code >= 0x200 && code < 0x300
      ? `HCI：${hci[code - 0x200] ?? "控制器错误"}`
      : code >= 0x100 && code < 0x200
        ? `ATT：${att[code - 0x100] ?? "属性操作失败"}`
        : (host[code] ?? "蓝牙操作失败");
  return `${label} [SDK ${code} / 0x${code.toString(16)}]`;
}
export class ProbeCandidates extends NearbyCandidates<ProbeCandidate> {
  constructor() {
    super(
      c => `${c.address_type}:${c.address || c.candidate_id}`,
      () => true,
      PAIR_MIN_RSSI,
    );
  }
}
export class ProbeClient {
  private audio = new Map<
    number,
    { chunks: Uint8Array[]; size: number; error: string }
  >();
  private ico = new Map<number,{chunks:Uint8Array[];size:number;total:number;frames:number;error:string}>();
  clearAudio() {
    this.audio.clear();
    this.ico.clear();
  }
  receiveAudio(body: Record<string, unknown>) {
    if(body.ico===true){this.receiveIco(body);return;}
    const capture = body.capture,
      offset = body.offset;
    if (!Number.isInteger(capture) || (capture as number) < 1) return;
    let stream = this.audio.get(capture as number);
    if (!stream) {
      if (this.audio.size >= 2)
        this.audio.delete(this.audio.keys().next().value!);
      stream = { chunks: [], size: 0, error: "" };
      this.audio.set(capture as number, stream);
    }
    if (stream.error) return;
    try {
      if (
        !Number.isInteger(offset) ||
        offset !== stream.size ||
        typeof body.hex !== "string"
      )
        throw Error("录音数据序号不连续");
      const data = bytes(body.hex);
      if (!data.length || data.length > 192 || data.length % 2)
        throw Error("录音数据格式错误");
      if (stream.size + data.length > 16000 * 2 * 600)
        throw Error("测试录音已达 10 分钟");
      stream.chunks.push(data);
      stream.size += data.length;
    } catch (e) {
      stream.error = String(e);
    }
  }
  audioError(capture: number) {
    return this.audio.get(capture)?.error ?? "";
  }
  audioSize(capture: number) {
    return this.audio.get(capture)?.size ?? 0;
  }
  audioWav(capture: number, expected: number, rate: number) {
    const stream = this.audio.get(capture);
    if (!stream || stream.error || stream.size !== expected)
      throw Error(stream?.error || "录音数据不完整");
    const pcm = new Uint8Array(expected);
    let offset = 0;
    for (const chunk of stream.chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }
    return pcmWav(pcm, rate);
  }
  private receiveIco(body:Record<string,unknown>) {
    const capture=body.capture,offset=body.offset,total=body.total,frames=body.frames;
    if(!Number.isInteger(capture)||(capture as number)<1)return;
    let stream=this.ico.get(capture as number);
    if(!stream){stream={chunks:[],size:0,total:Number(total),frames:Number(frames),error:""};this.ico.set(capture as number,stream);}
    if(stream.error)return;
    const frameCount=frames as number,totalBytes=total as number;
    try {
      if(!Number.isInteger(offset)||offset!==stream.size||!Number.isInteger(total)||
         !Number.isInteger(frames)||typeof body.hex!=="string"||
         totalBytes!==frameCount*682||frameCount<1||frameCount>500||totalBytes!==stream.total||frameCount!==stream.frames)
        throw Error("ICO 采集数据序号或长度不连续");
      const data=bytes(body.hex);
      if(!data.length||data.length>192||stream.size+data.length>stream.total)
        throw Error("ICO 采集数据块长度无效");
      stream.chunks.push(data);stream.size+=data.length;
    } catch(e) {stream.error=String(e);}
  }
  icoReady(capture:number) {
    const s=this.ico.get(capture);return !!s&&!s.error&&s.size===s.total;
  }
  icoArtifacts(capture:number) {
    const s=this.ico.get(capture);
    if(!s||s.error||s.size!==s.total)throw Error(s?.error||"ICO 采集数据尚未完整传输");
    const records=new Uint8Array(s.total);let at=0;
    for(const part of s.chunks){records.set(part,at);at+=part.length;}
    const raw=new Uint8Array(s.frames*40),pcm=new Uint8Array(s.frames*640),sequences:number[]=[];
    for(let i=0;i<s.frames;i++){
      const base=i*682;sequences.push(records[base]|(records[base+1]<<8));
      if(i && (sequences[i]-sequences[i-1]+65536)%65536!==1)throw Error("ICO 帧序号不连续，拒绝导出");
      raw.set(records.subarray(base+2,base+42),i*40);
      pcm.set(records.subarray(base+42,base+682),i*640);
    }
    return {
      frames:s.frames,
      raw:new Blob([raw],{type:"application/octet-stream"}),
      pcm:new Blob([pcm],{type:"application/octet-stream"}),
      wav:pcmWav(pcm,16000),
      metadata:new Blob([JSON.stringify({format:"vibe-remote-buddy-unicom-ico-pair-v1",codec:"iFLYTEK ICO with original byte obfuscation preserved",raw_frame_bytes:40,sample_rate_hz:16000,samples_per_frame:320,pcm_format:"signed 16-bit little-endian",frame_count:s.frames,sequence_contiguous:true,sequences},null,2)+"\n"],{type:"application/json"})
    };
  }
  private scanItems = new ProbeCandidates();
  readonly trace: {
    time: string;
    opcode: number;
    ms: number;
    result: unknown;
  }[] = [];
  readonly command: ProbeCommand;
  constructor(command: ProbeCommand) {
    this.command = async <T = Record<string, unknown>>(
      op: number,
      body?: Record<string, unknown>,
    ) => {
      const start = performance.now();
      const record = (result: unknown) => {
        this.trace.push({
          time: new Date().toISOString(),
          opcode: op,
          ms: Math.round(performance.now() - start),
          result,
        });
        if (this.trace.length > 2048) this.trace.shift();
      };
      try {
        const result = await command<T>(op, body);
        // Audio content does not belong in diagnostic logs.
        record(
          op === OP.PROBE_VOICE_READ &&
            body?.diagnostic === undefined &&
            !body?.transport
            ? { offset: body?.offset }
            : result,
        );
        return result;
      } catch (e) {
        record({
          error: String(e),
          ...(e instanceof DeviceError
            ? { status: e.status, detail: e.detail }
            : {}),
        });
        throw e;
      }
    };
  }
  async cancelVoice() {
    await this.command(OP.PROBE_VOICE_CANCEL);
    for (let i = 0; i < 40; i++) {
      const v = await this.command<ProbeVoiceStatus>(OP.PROBE_VOICE_STATUS);
      if (v.adapter_error)
        throw Error(
          `语音协议初始化失败：${v.adapter_error}${v.sdk_error ? " · " + sdkError(v.sdk_error) : ""}`,
        );
      if (v.idle) return;
      await sleep(100);
    }
    throw Error("上一段录音尚未结束，请松开语音键后重试");
  }
  async voiceDiagnostics(cancelled: () => boolean = () => false) {
    if (!cancelled()) {
      try {
        await this.command(OP.PROBE_VOICE_READ, { transport: true });
      } catch {
        /* Optional counters must not replace the original failure. */
      }
    }
    for (let diagnostic = 0; diagnostic < 64 && !cancelled(); diagnostic++) {
      try {
        await this.command(OP.PROBE_VOICE_READ, { diagnostic });
      } catch (e) {
        // Older receivers do not expose this optional metadata operation.
        // The original voice failure must remain the primary error.
        break;
      }
    }
  }
  resetCandidates() {
    this.scanItems.clear();
  }
  private async send<T = Record<string, unknown>>(
    op: number,
    body?: Record<string, unknown>,
    stage = "探测",
  ) {
    try {
      return await this.command<T>(op, body);
    } catch (e) {
      if (e instanceof DeviceError) {
        const detail = e.detail as { sdk_error?: number };
        e.message = `${stage}：${detail?.sdk_error ? sdkError(detail.sdk_error) : e.message}`;
      }
      throw e;
    }
  }
  status() {
    return this.command<ProbeStatus>(OP.PROBE_STATUS);
  }
  async wait(stage = "探测") {
    for (let i = 0; i < 180; i++) {
      let s = await this.status();
      // NimBLE reports SMP ENOTCONN before delivering GAP DISCONNECT.
      // Collect the terminal reason instead of stopping at the intermediate callback.
      if (!s.pending && s.sdk_error === 7 && s.connected) {
        for (let n = 0; n < 10 && s.connected && s.sdk_error === 7; n++) {
          await sleep(50);
          s = await this.status();
        }
      }
      if (!s.active) throw Error("探测已结束");
      if (!s.pending) {
        if (s.sdk_error)
          throw Error(
            `${stage}：${sdkError(s.sdk_error)}${s.error_phase ? `；固件步骤：${probeStages[s.error_phase] ?? s.error_phase}` : ""}${s.error_handle ? `，句柄 0x${s.error_handle.toString(16)}` : ""}${s.disconnect_reason ? `；断开原因：${sdkError(s.disconnect_reason)}` : ""}`,
          );
        return s;
      }
      await sleep(100);
    }
    throw Error("探测操作超时");
  }
  async end() {
    await this.command(OP.PROBE_END);
    for (let i = 0; i < 70; i++) {
      const s = await this.status();
      if (!s.active) return;
      if (s.cleanup_error) throw Error(`临时配对清理失败：${s.cleanup_error}`);
      await sleep(100);
    }
    throw Error("接收器仍在清理临时连接");
  }
  async candidates(cancelled: () => boolean = () => false) {
    const list: ProbeCandidate[] = [];
    for await (const c of candidateStream<ProbeCandidate>((op, body) => this.command(op, body), cancelled)) list.push(c);
    return this.scanItems.update(list);
  }
  async connect(c: ProbeCandidate) {
    await this.send(
      OP.PROBE_CONNECT,
      {
        candidate_id: c.candidate_id,
        scan_epoch: c.scan_epoch,
      },
      "建立 BLE 连接",
    );
    const s = await this.wait("建立 BLE 连接");
    if (!s.connected) throw Error("未能连接设备");
  }
  async connectSelected(
    selected: ProbeCandidate,
    progress: (message: string) => void,
    cancelled: () => boolean = () => false,
  ) {
    const s = await this.status();
    // A failed SMP/GATT transaction can leave a live link and a temporary bond.
    // End the old probe before BEGIN snapshots the bonds for the new attempt.
    if (s.sdk_error || s.pending || s.cleanup_error) {
      progress("正在清理异常连接");
      await this.end();
      await this.command(OP.PROBE_BEGIN);
      this.resetCandidates();
    } else if (!s.active) {
      await this.command(OP.PROBE_BEGIN);
      this.resetCandidates();
    } else if (s.connected) return selected;

    progress("等待遥控器，请进入配对模式");
    const deadline = performance.now() + 30000;
    while (performance.now() < deadline && !cancelled()) {
      for await (const c of candidateStream<ProbeCandidate>((op, body) => this.command(op, body), cancelled)) {
        const started = performance.now();
        // Match identity, never a name or an old candidate ID. Connect immediately
        // instead of finishing a full UI list poll while its advertisement ages.
        if (
          !cancelled() &&
          c.address === selected.address &&
          c.address_type === selected.address_type &&
          c.connectable &&
          c.age_ms + performance.now() - started < 1000
        ) {
          progress("建立蓝牙连接");
          await this.connect(c);
          return { ...c, name: c.name || selected.name };
        }
      }
      await sleep(150);
    }
    throw Error(
      cancelled()
        ? "连接已取消"
        : "未收到遥控器的新广播，请重新进入配对模式后重试",
    );
  }
  async security() {
    await this.send(OP.PROBE_SECURITY, {}, "配对加密");
    await this.wait("配对加密");
  }
  async attribute(index: number) {
    let a = await this.command<ProbeAttribute>(OP.PROBE_ATTR, {
      index,
      offset: 0,
    });
    for (let offset = a.hex.length / 2; offset < a.length;) {
      const chunk = await this.command<ProbeAttribute>(OP.PROBE_ATTR, {
        index,
        offset,
      });
      if (!chunk.hex) throw Error("属性读取没有进展");
      a.hex += chunk.hex;
      offset += chunk.hex.length / 2;
    }
    return a;
  }
  async discover() {
    await this.send(OP.PROBE_DISCOVER, {}, "发现服务与特征");
    const s = await this.wait("发现服务与特征");
    const attrs: ProbeAttribute[] = [];
    for (let i = 0; i < s.attributes; i++) attrs.push(await this.attribute(i));
    return attrs;
  }
  async read(a: ProbeAttribute) {
    await this.send(
      OP.PROBE_READ,
      { index: a.index },
      `读取 ${a.uuid} / 0x${a.handle.toString(16)}`,
    );
    await this.wait(`读取 ${a.uuid} / 0x${a.handle.toString(16)}`);
    return this.attribute(a.index);
  }
  async identity(attrs: ProbeAttribute[]) {
    const out = [...attrs];
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      if (
        [0x2a00, 0x2a29, 0x2a24, 0x2a26, 0x2a50, 0x2a4b, 0x2908].some((id) =>
          isUuid(a, id),
        )
      )
        try {
          out[i] = await this.read(a);
        } catch (e) {
          out[i] = { ...a, read_error: String(e) };
        }
    }
    return out;
  }
  async subscribe(attrs: ProbeAttribute[]) {
    let count = 0;
    for (const a of attrs)
      if (
        a.kind === 2 &&
        isUuid(a, 0x2a4d) &&
        a.properties & 16 &&
        [1, 3, 248].includes(reportId(attrs, a.handle) ?? -1)
      ) {
        await this.send(OP.PROBE_SUBSCRIBE, { index: a.index }, "订阅按键");
        await this.wait("订阅按键");
        count++;
      }
    if (!count)
      throw Error("没有可订阅的 HID 输入报告；可能需要先配对并重新读取");
  }
  async reconnect(
    candidate: ProbeCandidate,
    expected: RemoteModel,
    progress: (s: string) => void,
  ) {
    progress("正在清理异常连接");
    await this.end();
    await this.command(OP.PROBE_BEGIN);
    this.resetCandidates();
    const found = await this.connectSelected(candidate, progress);
    await this.security();
    const attrs = await this.identity(await this.discover());
    const detected = makeVariant(
      expected,
      { ...found, name: found.name || candidate.name },
      attrs,
      expected.id,
      expected.title,
    );
    if (
      familyEvidence(attrs) !== expected.family ||
      detected.map_crc !== expected.map_crc
    )
      throw Error("重新连接的设备特征已变化，请重新适配");
    await this.subscribe(attrs);
    return { candidate: found, attrs };
  }
  async reports(after: number) {
    const out: ProbeReport[] = [];
    for (let i = 0; i < 32; i++)
      try {
        const r = await this.command<ProbeReport>(OP.PROBE_REPORT, { after });
        out.push(r);
        after = r.sequence;
      } catch (e) {
        if (e instanceof DeviceError && e.status === 6) break;
        throw e;
      }
    return out;
  }
}
export function makeVariant(
  base: RemoteModel,
  c: ProbeCandidate,
  attrs: ProbeAttribute[],
  id: string,
  title: string,
): RemoteModel {
  if (!c.name) throw Error("广播中没有名称；目前不能用地址作为型号指纹");
  const maps = attrs.filter((a) => isUuid(a, 0x2a4b));
  if (
    maps.length !== 1 ||
    !maps[0].complete ||
    maps[0].hex.length !== maps[0].length * 2 ||
    !maps[0].length
  )
    throw Error("需要完整且唯一的 HID Report Map，不能根据部分数据生成型号");
  const detected = familyEvidence(attrs);
  if (detected && detected !== base.family)
    throw Error("设备协议特征与所选基础型号不一致");
  const model: RemoteModel = structuredClone(base);
  model.id = id;
  model.title = title;
  model.revision = 1;
  model.onboarding = { keyConfirmation: "required" };
  model.matches = [
    { name: c.name, ...(c.company >= 0 ? { company: c.company } : {}) },
  ];
  model.map_crc = crc32c(bytes(maps[0].hex));
  return validateModel(model);
}
export function captureMapping(
  model: RemoteModel,
  report: number,
  usage: number,
  key: number,
) {
  if (
    !model.keys.some((k) => k.id === key) ||
    ![1, 3].includes(report) ||
    usage <= 0
  )
    throw Error("按键映射无效");
  const result = structuredClone(model);
  const old = result.raw.find((x) => x.report === report && x.usage === usage);
  if (old && old.key !== key) throw Error("这个原始键码已经分配给其他按钮");
  if (!old) result.raw.push({ report, usage, key });
  return validateModel(result);
}

export function identityText(a: ProbeAttribute): string {
  if (!a.complete) return a.read_error ?? "未读取";
  const v = bytes(a.hex);
  if ([0x2a00, 0x2a29, 0x2a24, 0x2a26].some((id) => isUuid(a, id)))
    return new TextDecoder().decode(v);
  if (isUuid(a, 0x2a50) && v.length === 7)
    return `PnP 来源 ${v[0]} · VID 0x${(v[1] | (v[2] << 8)).toString(16)} · PID 0x${(v[3] | (v[4] << 8)).toString(16)} · 版本 ${v[5] | (v[6] << 8)}`;
  if (isUuid(a, 0x2908) && v.length === 2)
    return `报告 ${v[0]} · ${["未知", "输入", "输出", "特征"][v[1]] ?? v[1]}`;
  if (isUuid(a, 0x2a4b))
    return `HID 描述 ${v.length} 字节 · CRC32C ${crc32c(v).toString(16)}`;
  return a.hex;
}
export interface ProbeVoiceStatus {
  trigger_report?: number;
  trigger_usage?: number;
  pending_samples?: number;
  idle: boolean;
  active: boolean;
  ready: boolean;
  armed: boolean;
  recording: boolean;
  released: boolean;
  capture: number;
  samples: number;
  rate: number;
  codec: number;
  peak: number;
  decode_error: number;
  sdk_error: number;
  end_reason: number;
  error: string;
  adapter_error?: string;
  adapter_state?: number;
  prepare_ms?: number;
  raw_ico_requested?: boolean;
  raw_ico_frames?: number;
  raw_ico_exported?: number;
  raw_ico_complete?: boolean;
  raw_ico_error?: string;
}
export function pcmWav(pcm: Uint8Array, rate: number) {
  if (rate !== 16000 || pcm.length % 2) throw Error("音频格式无效");
  const out = new Uint8Array(44 + pcm.length),
    v = new DataView(out.buffer),
    text = (offset: number, s: string) =>
      [...s].forEach((c, i) => (out[offset + i] = c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return new Blob([out], { type: "audio/wav" });
}
export async function readProbeAudio(
  client: ProbeClient,
  s: ProbeVoiceStatus,
  progress: (n: number) => void,
  cancelled: () => boolean,
) {
  if (
    s.armed ||
    s.recording ||
    !s.released ||
    s.error ||
    s.decode_error ||
    !s.samples ||
    s.samples > 16000 * 600 ||
    s.rate !== 16000
  )
    throw Error("语音测试未完成");
  const expected = s.samples * 2;
  const deadline = performance.now() + 2000;
  while (client.audioSize(s.capture) < expected) {
    if (cancelled()) throw Error("读取已取消");
    if (client.audioError(s.capture)) throw Error(client.audioError(s.capture));
    if (performance.now() > deadline) throw Error("录音数据不完整");
    progress(client.audioSize(s.capture) / expected);
    await sleep(20);
  }
  if (cancelled()) throw Error("读取已取消");
  return client.audioWav(s.capture, expected, s.rate);
}
