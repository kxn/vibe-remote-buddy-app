import { encode, Parser, type Frame } from "./wire";
export interface Transport {
  open(path: string): Promise<void>;
  close(): Promise<void>;
  read(): Promise<Uint8Array>;
  write(data: Uint8Array): Promise<void>;
}
export const OP = {
  HELLO: 0x400,
  PING: 0x401,
  CLOSE: 0x402,
  INFO: 0x403,
  SLOT: 0x404,
  SCAN: 0x405,
  CANDIDATE: 0x406,
  PAIR: 0x407,
  UNBIND: 0x408,
  OPERATION: 0x409,
  CATALOG: 0x40a,
  MAP_GET: 0x40b,
  MAP_SET: 0x40c,
  MAP_RESET: 0x40d,
  STATS: 0x40e,
  CANCEL: 0x40f,
  SCAN_STOP: 0x410,
  RETRY: 0x411,
  PROBE_ADOPT: 0x450,
  MODEL_GET: 0x430,
  MODEL_BEGIN: 0x431,
  MODEL_DATA: 0x432,
  MODEL_COMMIT: 0x433,
  MODEL_ABORT: 0x434,
  MODEL_DELETE: 0x435,
  PROBE_BEGIN: 0x440,
  PROBE_END: 0x441,
  PROBE_STATUS: 0x442,
  PROBE_CONNECT: 0x443,
  PROBE_SECURITY: 0x444,
  PROBE_DISCOVER: 0x445,
  PROBE_ATTR: 0x446,
  PROBE_READ: 0x447,
  PROBE_SUBSCRIBE: 0x448,
  PROBE_REPORT: 0x449,
  PROBE_VOICE_ARM: 0x44a,
  PROBE_VOICE_STATUS: 0x44b,
  PROBE_VOICE_READ: 0x44c,
  PROBE_VOICE_CANCEL: 0x44d,
  PROBE_AUDIO: 0x483,
  ACTION: 0x480,
  CHANGED: 0x481,
  OP_EVENT: 0x482,
} as const;
const messages = [
  "成功",
  "已受理",
  "参数无效",
  "不支持此功能",
  "状态已变化，请重新读取",
  "接收器正忙，请稍后重试",
  "未找到或已过期",
  "请求超时",
  "配对未成功",
  "连接已断开",
  "保存失败",
  "没有可用位置",
  "已取消",
  "重复操作",
  "管理会话已失效",
  "设备错误",
  "语音暂不可用",
  "版本不匹配",
];
export class DeviceError extends Error {
  constructor(
    public status: number,
    public opcode: number,
    public detail: unknown,
  ) {
    super(messages[status] || `设备错误 ${status}`);
  }
}
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
export class Session {
  session = 0;
  private seq = 0;
  private requestId = 0;
  private rx = 0;
  private parser = new Parser();
  private active = false;
  private tail: Promise<unknown> = Promise.resolve();
  private lastSent = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private beatQueued = false;
  private reader?: Promise<void>;
  private pending?: {
    request: number;
    opcode: number;
    resolve: (f: Frame) => void;
    reject: (e: Error) => void;
  };
  onEvent: (f: Frame) => void = () => {};
  onLost: (e: Error) => void = () => {};
  constructor(private transport: Transport) {}
  async open(path: string) {
    await this.transport.open(path);
    this.active = true;
    this.reader = this.readLoop();
    try {
      const hello = await this.raw(OP.HELLO, { api: 1 });
      if (hello.body.api !== 1 || !this.session)
        throw Error("不支持的管理接口");
      this.heartbeat = setInterval(() => {
        if (
          !this.beatQueued &&
          this.active &&
          performance.now() - this.lastSent > 1500
        ) {
          this.beatQueued = true;
          void this.command(OP.PING)
            .catch(() => {})
            .finally(() => (this.beatQueued = false));
        }
      }, 500);
    } catch (e) {
      await this.close(false);
      throw e;
    }
  }
  command<T = Record<string, unknown>>(
    opcode: number,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const job = this.tail.then(async () => {
      if (!this.active || !this.session) throw Error("接收器未连接");
      if (opcode !== OP.PING && performance.now() - this.lastSent > 1500)
        await this.raw(OP.PING, {});
      return (await this.raw(opcode, body)).body as T;
    });
    this.tail = job.catch(() => {});
    return job;
  }
  private async raw(
    opcode: number,
    body: Record<string, unknown>,
  ): Promise<Frame> {
    if (!this.active) throw Error("串口未连接");
    if (this.pending) throw Error("重复未完成请求");
    if (this.seq === 0xffffffff || this.requestId === 0xffffffff)
      throw Error("会话序号耗尽");
    const request = ++this.requestId;
    const response = new Promise<Frame>(
      (resolve, reject) =>
        (this.pending = { request, opcode, resolve, reject }),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // No blind mutation retry: any ambiguity invalidates the session and callers reconcile.
    const timed = new Promise<Frame>(
      (_, reject) =>
        (timeout = setTimeout(
          () =>
            reject(Error(`响应超时：0x${opcode.toString(16)} / ${request}`)),
          2500,
        )),
    );
    const waiting = Promise.race([response, timed]);
    void waiting.catch(() => {});
    try {
      const frame = encode({
        kind: 1,
        session: this.session,
        seq: ++this.seq,
        request,
        opcode,
        status: 0,
        body,
      });
      this.lastSent = performance.now();
      await this.transport.write(frame);
      const f = await waiting;
      if (f.status > 1) {
        const error = new DeviceError(f.status, opcode, f.body);
        if (f.status === 14 || f.status === 17) this.fail(error);
        throw error;
      }
      return f;
    } catch (e) {
      if (!(e instanceof DeviceError)) this.fail(e);
      throw e;
    } finally {
      clearTimeout(timeout);
      this.pending = undefined;
      void response.catch(() => {});
      void timed.catch(() => {});
    }
  }
  private async readLoop() {
    while (this.active) {
      try {
        const data = await this.transport.read();
        for (const f of this.parser.feed(data)) {
          if (this.session && f.session !== this.session) continue;
          if (!f.session || f.seq !== this.rx + 1)
            throw Error(`接收序号不连续：${this.rx} → ${f.seq}`);
          this.rx = f.seq;
          if (f.kind === 3) {
            if (this.session) this.onEvent(f);
            continue;
          }
          const p = this.pending;
          if (
            f.kind !== 2 ||
            !p ||
            f.request !== p.request ||
            f.opcode !== p.opcode
          )
            throw Error("收到不匹配的响应");
          if (p.opcode === OP.HELLO && f.status === 0) this.session = f.session;
          p.resolve(f);
        }
        if (!data.length) await sleep(this.pending ? 2 : 15);
      } catch (e) {
        if (this.active) this.fail(e);
        break;
      }
    }
  }
  private fail(value: unknown) {
    if (!this.active) return;
    const e = value instanceof Error ? value : Error(String(value));
    this.active = false;
    this.session = 0;
    clearInterval(this.heartbeat);
    this.pending?.reject(e);
    this.onLost(e);
  }
  async close(graceful = true) {
    clearInterval(this.heartbeat);
    if (graceful && this.active && this.session) {
      try {
        await this.command(OP.CLOSE);
      } catch {
        /* original failure delivered through onLost */
      }
    }
    this.active = false;
    this.session = 0;
    this.pending?.reject(Error("会话已关闭"));
    await this.reader;
    await this.transport.close();
  }
}
