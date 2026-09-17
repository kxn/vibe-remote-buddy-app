export interface Frame {
  kind: number;
  session: number;
  seq: number;
  request: number;
  opcode: number;
  status: number;
  body: Record<string, unknown>;
}
export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0x82f63b78 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function cobsEncode(bytes: Uint8Array): Uint8Array {
  const out = [0];
  let pos = 0,
    code = 1;
  for (const b of bytes) {
    if (!b) {
      out[pos] = code;
      pos = out.length;
      out.push(0);
      code = 1;
    } else {
      out.push(b);
      if (++code === 255) {
        out[pos] = code;
        pos = out.length;
        out.push(0);
        code = 1;
      }
    }
  }
  out[pos] = code;
  out.push(0);
  return Uint8Array.from(out);
}
export function cobsDecode(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i++];
    if (!code || i + code - 1 > bytes.length) throw Error("COBS 数据损坏");
    for (let j = 1; j < code; j++) out.push(bytes[i++]);
    if (code < 255 && i < bytes.length) out.push(0);
  }
  return Uint8Array.from(out);
}
export function encode(f: Frame): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(f.body));
  if (payload.length > 512) throw Error("请求超过 512 字节");
  const raw = new Uint8Array(36 + payload.length),
    v = new DataView(raw.buffer);
  raw.set([82, 66, 3, 0, f.kind, 0, 32, 0]);
  v.setUint32(8, f.session, true);
  v.setUint32(12, f.seq, true);
  v.setUint32(16, f.request, true);
  v.setUint16(20, f.opcode, true);
  v.setUint16(22, f.status, true);
  v.setUint16(24, payload.length, true);
  raw.set(payload, 32);
  v.setUint32(raw.length - 4, crc32c(raw.subarray(0, -4)), true);
  return cobsEncode(raw);
}
export function decode(data: Uint8Array): Frame {
  const raw = cobsDecode(data);
  if (raw.length < 36 || raw.length > 548) throw Error("帧长度错误");
  const v = new DataView(raw.buffer);
  if (
    raw[0] !== 82 ||
    raw[1] !== 66 ||
    raw[2] !== 3 ||
    raw[3] !== 0 ||
    raw[5] ||
    v.getUint16(6, true) !== 32 ||
    v.getUint16(26, true) ||
    v.getUint32(28, true) ||
    v.getUint16(24, true) !== raw.length - 36
  )
    throw Error("RBP/3 帧头错误");
  if (v.getUint32(raw.length - 4, true) !== crc32c(raw.subarray(0, -4)))
    throw Error("CRC32C 校验失败");
  const body = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(32, -4)),
  );
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw Error("响应不是 JSON 对象");
  return {
    kind: raw[4],
    session: v.getUint32(8, true),
    seq: v.getUint32(12, true),
    request: v.getUint32(16, true),
    opcode: v.getUint16(20, true),
    status: v.getUint16(22, true),
    body,
  };
}
export class Parser {
  private bytes: number[] = [];
  private started = 0;
  feed(data: Uint8Array, now = performance.now()): Frame[] {
    if (this.bytes.length && now - this.started > 1000)
      throw Error("不完整帧超时");
    const frames: Frame[] = [];
    for (const b of data) {
      if (b === 0) {
        if (this.bytes.length) {
          const raw = Uint8Array.from(this.bytes);
          this.bytes = [];
          frames.push(decode(raw));
        }
      } else {
        if (!this.bytes.length) this.started = now;
        this.bytes.push(b);
        if (this.bytes.length > 551) throw Error("接收帧过长");
      }
    }
    return frames;
  }
}
