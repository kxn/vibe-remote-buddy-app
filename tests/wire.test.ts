import { describe, it, expect } from "vitest";
import golden from './hello-vector.json';
import {
  crc32c,
  cobsEncode,
  cobsDecode,
  encode,
  decode,
  Parser,
} from "../src/core/wire";
import {
  Session,
  OP,
  DeviceError,
  type Transport,
  sleep,
} from "../src/core/session";
describe("RBP/3 wire", () => {
  it('matches independently generated Python HELLO bytes',()=>{
    const bytes=encode({kind:1,session:0,seq:1,request:1,opcode:0x400,status:0,body:{api:1}});
    expect(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')).toBe(golden.hex);
  });
  it("matches standard Castagnoli check", () =>
    expect(crc32c(new TextEncoder().encode("123456789"))).toBe(0xe3069283));
  it("COBS preserves zeroes and 254-byte runs", () => {
    for (const size of [0, 1, 254, 255, 548]) {
      const a = Uint8Array.from({ length: size }, (_, i) => i % 256);
      expect(cobsDecode(cobsEncode(a).subarray(0, -1))).toEqual(a);
    }
  });
  it("accepts fragmented and joined records, rejects corruption", () => {
    const f = {
      kind: 2,
      session: 8,
      seq: 1,
      request: 1,
      opcode: OP.HELLO,
      status: 0,
      body: { api: 1, name: "遥控器" },
    };
    const bytes = encode(f),
      p = new Parser();
    expect(p.feed(bytes.subarray(0, 7), 0)).toEqual([]);
    expect(p.feed(bytes.subarray(7), 10)).toEqual([f]);
    const broken = bytes.slice();
    broken[9] ^= 1;
    expect(() => decode(broken.subarray(0, -1))).toThrow();
    expect(
      new Parser().feed(Uint8Array.from([...bytes, ...bytes])),
    ).toHaveLength(2);
  });
  it("rejects payload overflow and stalled partial frames", () => {
    expect(() =>
      encode({
        kind: 1,
        session: 0,
        seq: 1,
        request: 1,
        opcode: OP.HELLO,
        status: 0,
        body: { x: "x".repeat(512) },
      }),
    ).toThrow();
    const p = new Parser();
    p.feed(new Uint8Array([4, 1]), 0);
    expect(() => p.feed(new Uint8Array(), 1001)).toThrow();
  });
});
class Memory implements Transport {
  data: number[] = [];
  ops: number[] = [];
  seq = 0;
  status = 0;
  event = false;
  drop = false;
  closed = false;
  async open() {}
  async close() {
    this.closed = true;
  }
  async read() {
    const b = Uint8Array.from(this.data);
    this.data = [];
    return b;
  }
  async write(bytes: Uint8Array) {
    const f = decode(bytes.subarray(0, -1));
    this.ops.push(f.opcode);
    if (this.drop) return;
    if (this.event) {
      this.data.push(
        ...encode({
          kind: 3,
          session: 42,
          seq: ++this.seq,
          request: 0,
          opcode: OP.OP_EVENT,
          status: 0,
          body: { operation_id: 17, pending: false },
        }),
      );
      this.event = false;
    }
    this.data.push(
      ...encode({
        kind: 2,
        session: 42,
        seq: ++this.seq,
        request: f.request,
        opcode: f.opcode,
        status: f.opcode === OP.HELLO ? 0 : this.status,
        body:
          f.opcode === OP.HELLO ? { api: 1, lease_ms: 10000, slots: 4 } : {},
      }),
    );
  }
}
describe("management session", () => {
  it("serializes parallel UI requests and accepts operation events before reply", async () => {
    const t = new Memory(),
      s = new Session(t),
      events: number[] = [];
    s.onEvent = (f) => events.push(f.opcode);
    await s.open("test");
    t.event = true;
    await Promise.all([
      s.command(OP.INFO),
      s.command(OP.SLOT, { slot: 0 }),
      s.command(OP.PING),
    ]);
    expect(t.ops).toEqual([OP.HELLO, OP.INFO, OP.SLOT, OP.PING]);
    expect(events).toEqual([OP.OP_EVENT]);
    await s.close();
    expect(t.closed).toBe(true);
  });
  it("survives BUSY and preserves original status", async () => {
    const t = new Memory(),
      s = new Session(t);
    await s.open("test");
    t.status = 5;
    await expect(s.command(OP.SCAN)).rejects.toMatchObject({
      status: 5,
      opcode: OP.SCAN,
    });
    t.status = 0;
    await s.command(OP.INFO);
    await s.close();
  });
  it("does not replay an ambiguous mutation", async () => {
    const t = new Memory(),
      s = new Session(t);
    let lost = false;
    s.onLost = () => (lost = true);
    await s.open("test");
    t.drop = true;
    await expect(s.command(OP.MAP_SET, { key: 9 })).rejects.toThrow("超时");
    expect(t.ops.filter((x) => x === OP.MAP_SET)).toHaveLength(1);
    expect(lost).toBe(true);
    await expect(s.command(OP.INFO)).rejects.toThrow("未连接");
    await s.close(false);
  }, 5000);
  it("sends heartbeat without UI activity", async () => {
    const t = new Memory(),
      s = new Session(t);
    await s.open("test");
    await sleep(2150);
    expect(t.ops).toContain(OP.PING);
    await s.close();
  }, 5000);
});
