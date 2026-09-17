import { validateSettings } from "./settings";
import {
  validAction,
  inputMethodForVoice,
  type VoiceInputMethod,
} from "./actions";
import { Session, OP, DeviceError, sleep } from "./session";
import type { Transport } from "./session";
import type {
  Port,
  Info,
  Slot,
  Candidate,
  Operation,
  Catalog,
  Mapping,
  KeyEntry,
  Settings,
  Snapshot,
  Action,
} from "./types";
export interface Platform {
  ports(): Promise<Port[]>;
  transport(): Transport;
  load(): Promise<Partial<Settings>>;
  save(value: Settings): Promise<void>;
  run(action: Action, inputMethod?: VoiceInputMethod): Promise<void>;
  background(enabled: boolean): Promise<void>;
}
export class BuddyService {
  snapshot: Snapshot = {
    status: "disconnected",
    ports: [],
    slots: [],
    error: "",
    logs: [],
    busy: false,
  };
  settings: Settings = { schema: 1, background: true, boards: {} };
  private listeners = new Set<() => void>();
  private session?: Session;
  private stopped = true;
  private loop?: Promise<void>;
  private connecting = false;
  private manualSerial?: string;
  private settingsTail: Promise<unknown> = Promise.resolve();
  constructor(private platform: Platform) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(p: Partial<Snapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...p };
    this.listeners.forEach((f) => f());
  }
  log(message: string) {
    this.update({
      logs: [
        ...this.snapshot.logs,
        `${new Date().toLocaleTimeString()} ${message}`,
      ].slice(-200),
    });
  }
  report(e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    this.log(
      `${message}${e instanceof DeviceError ? ` [opcode=0x${e.opcode.toString(16)} status=${e.status} ${JSON.stringify(e.detail)}]` : ""}`,
    );
    this.update({ error: message });
    return message;
  }
  clearError() {
    this.update({ error: "" });
  }
  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    try {
      const loaded = await this.platform.load();
      const value: Partial<Settings> =
        loaded.schema === undefined ? {} : validateSettings(loaded);
      this.settings = {
        schema: 1,
        background: value.background ?? true,
        boards: value.boards ?? {},
      };
      await this.platform.background(this.settings.background);
    } catch (e) {
      this.report(e);
    }
    this.loop = this.work();
  }
  async stop() {
    this.stopped = true;
    await this.loop;
    const s = this.session;
    this.session = undefined;
    if (s) await s.close();
    this.update({ status: "disconnected", slots: [], info: undefined });
  }
  private async work() {
    while (!this.stopped) {
      try {
        if (!this.session && !this.connecting) {
          const ports = await this.platform.ports();
          this.update({ ports });
          const p = this.manualSerial
            ? ports.find((p) => p.serial === this.manualSerial)
            : ports.length === 1
              ? ports[0]
              : undefined;
          if (p) await this.connect(p);
        } else if (this.session && this.snapshot.status === "connected") {
          await this.refresh();
        }
      } catch (e) {
        this.report(e);
      }
      await sleep(1000);
    }
  }
  async connect(port: Port) {
    if (this.connecting || this.snapshot.busy) return;
    if (!port.serial) {
      this.report(Error("接收器没有稳定设备标识"));
      return;
    }
    this.connecting = true;
    this.manualSerial = port.serial;
    const old = this.session;
    this.session = undefined;
    try {
      if (old) await old.close();
      this.update({
        status: "connecting",
        board: port,
        slots:
          this.snapshot.board?.serial === port.serial
            ? this.snapshot.slots
            : [],
        info: undefined,
      });
      const s = new Session(this.platform.transport());
      this.session = s;
      s.onLost = (e) => {
        if (this.session !== s) return;
        this.session = undefined;
        this.update({
          status: "disconnected",
          slots: this.snapshot.slots.map((x) => ({ ...x, state: 1 })),
          info: undefined,
        });
        this.report(e);
        void s.close(false).catch((e) => this.report(e));
      };
      s.onEvent = (f) => {
        if (this.session === s && f.opcode === OP.ACTION)
          void this.action(f.body);
      };
      await s.open(port.path);
      if (this.session !== s) throw Error("握手过程中连接中断");
      await this.refresh();
      this.update({ status: "connected", error: "" });
      this.log(`管理连接已建立 ${port.serial}`);
    } catch (e) {
      const s = this.session;
      this.session = undefined;
      if (s) await s.close(false);
      this.update({ status: "disconnected", info: undefined });
      this.report(e);
    } finally {
      this.connecting = false;
    }
  }
  private require() {
    if (!this.session) throw Error("接收器未连接");
    return this.session;
  }
  async refresh() {
    const s = this.require(),
      info = await s.command<Info>(OP.INFO);
    const slots: Slot[] = [];
    if (info.slots < 1 || info.slots > 4) throw Error("不支持的设备容量");
    for (let i = 0; i < info.slots; i++)
      slots.push(await s.command<Slot>(OP.SLOT, { slot: i }));
    if (this.session === s) this.update({ info, slots });
  }
  boardConfig() {
    const serial = this.snapshot.board?.serial;
    if (!serial) throw Error("接收器未连接");
    return (this.settings.boards[serial] ??= {
      aliases: {},
      actions: {},
      authorizations: {},
      shared: {},
      followers: {},
    });
  }
  async persist() {
    const copy = JSON.parse(JSON.stringify(this.settings)) as Settings;
    const job = this.settingsTail.then(() => this.platform.save(copy));
    this.settingsTail = job.catch(() => {});
    await job;
    this.update();
  }
  name(slot: Slot) {
    return (
      this.settings.boards[this.snapshot.board?.serial ?? ""]?.aliases[
        slot.peer_id
      ] ||
      slot.name ||
      slot.model ||
      "遥控器"
    );
  }
  async rename(slot: Slot, name: string) {
    this.boardConfig().aliases[slot.peer_id] = name.trim();
    await this.persist();
  }
  async setBackground(enabled: boolean) {
    await this.platform.background(enabled);
    this.settings.background = enabled;
    await this.persist();
  }
  private ensureMutable() {
    if (this.snapshot.status !== "connected") throw Error("接收器未连接");
    if (this.snapshot.info?.voice_owner !== 255)
      throw Error("录音结束后可操作");
    if (this.snapshot.busy) throw Error("另一项操作正在进行");
  }
  private identity(slot: Slot) {
    const current = this.snapshot.slots.find((x) => x.slot === slot.slot);
    if (!current || current.peer_id !== slot.peer_id || !slot.peer_id)
      throw Error("遥控器已变化，请重新选择");
    return { slot: slot.slot, peer_id: slot.peer_id };
  }
  async scan() {
    this.ensureMutable();
    return this.require().command<{ scan_epoch: number }>(OP.SCAN, {
      duration_ms: 30000,
    });
  }
  async stopScan() {
    await this.require().command(OP.SCAN_STOP);
  }
  async candidates(epoch: number) {
    const s = this.require(),
      items: Candidate[] = [];
    for (let index = 0; index < 24; index++) {
      try {
        const c = await s.command<Candidate>(OP.CANDIDATE, { index });
        if (c.scan_epoch === epoch && c.age_ms < 15000)
          items.push({ ...c, seen: performance.now() });
      } catch (e) {
        if (!(e instanceof DeviceError && e.status === 6)) throw e;
      }
    }
    return items;
  }
  async pair(
    c: Candidate,
    onOperation: (id: number) => void,
    expectedPeer?: number,
  ) {
    this.ensureMutable();
    if (c.age_ms + performance.now() - c.seen >= 15000)
      throw Error("搜索结果已过期，请重新搜索");
    this.update({ busy: true });
    try {
      const { operation_id } = await this.require().command<{
        operation_id: number;
      }>(OP.PAIR, { candidate_id: c.candidate_id, scan_epoch: c.scan_epoch });
      onOperation(operation_id);
      const op = await this.waitOperation(operation_id);
      await this.refresh();
      if (expectedPeer && op.peer_id !== expectedPeer)
        throw Error("配对结果属于另一台遥控器，请核对设备列表");
      if (
        !this.snapshot.slots.some(
          (s) => s.peer_id === op.peer_id && s.state === 5,
        )
      )
        throw Error("配对已完成，遥控器尚未处于可用状态");
    } finally {
      this.update({ busy: false });
    }
  }
  async cancel(id: number) {
    await this.require().command(OP.CANCEL, { operation_id: id });
  }
  async unbind(slot: Slot) {
    this.ensureMutable();
    const id = this.identity(slot);
    this.update({ busy: true });
    try {
      const { operation_id } = await this.require().command<{
        operation_id: number;
      }>(OP.UNBIND, id);
      await this.waitOperation(operation_id);
      await this.refresh();
      if (this.snapshot.slots.some((s) => s.peer_id === slot.peer_id))
        throw Error("尚未确认解绑结果");
      delete this.boardConfig().aliases[slot.peer_id];
      delete this.boardConfig().followers[slot.peer_id];
      for (const key of Object.keys(this.boardConfig().authorizations))
        if (key.startsWith(`${slot.peer_id}:`))
          delete this.boardConfig().authorizations[key];
      await this.persist();
    } finally {
      this.update({ busy: false });
    }
  }
  private async waitOperation(id: number) {
    const end = performance.now() + 45000;
    while (performance.now() < end) {
      const op = await this.require().command<Operation>(OP.OPERATION);
      if (op.operation_id !== id)
        throw Error("操作记录已变化，请核对遥控器状态");
      if (!op.pending) {
        this.log(`操作 ${id}：${JSON.stringify(op)}`);
        if (op.uncertain) throw Error("操作结果不确定，请核对设备状态");
        if (op.result) throw new DeviceError(op.result, OP.OPERATION, op);
        return op;
      }
      await sleep(250);
    }
    throw Error("操作尚未结束，请核对设备状态后再操作");
  }
  async keys(slot: Slot): Promise<KeyEntry[]> {
    const id = this.identity(slot),
      s = this.require();
    const keys: KeyEntry[] = [];
    for (let index = 0; index < 64; index++) {
      let catalog: Catalog;
      try {
        catalog = await s.command<Catalog>(OP.CATALOG, { ...id, index });
      } catch (e) {
        if (e instanceof DeviceError && e.status === 6) break;
        throw e;
      }
      const map = await s.command<Mapping>(OP.MAP_GET, {
        ...id,
        key: catalog.key,
      });
      keys.push({ catalog, map });
      if (index + 1 >= catalog.count) break;
    }
    this.identity(slot);
    return keys;
  }
  async saveMap(slot: Slot, desired: Mapping, action?: Action) {
    this.ensureMutable();
    if (action && !validAction(action)) throw Error("软件动作配置无效");
    const id = this.identity(slot),
      s = this.require(),
      board = this.snapshot.board!.serial;
    this.update({ busy: true });
    try {
      const before = await s.command<Mapping>(OP.MAP_GET, {
        ...id,
        key: desired.key,
      });
      if (before.revision !== desired.revision)
        throw Error("按键设置已变化，请重新打开后修改");
      const conf = this.boardConfig();
      if (action) {
        let actionId = 1;
        while (conf.actions[actionId] && actionId < 65535) actionId++;
        if (actionId === 65535 && conf.actions[actionId])
          throw Error("软件动作已满");
        desired = { ...desired, kind: 4, modifiers: 0, value: actionId };
        conf.actions[actionId] = action;
        await this.persist();
      }
      await s.command(OP.MAP_SET, { ...id, ...desired });
      const actual = await s.command<Mapping>(OP.MAP_GET, {
        ...id,
        key: desired.key,
      });
      if (
        actual.kind !== desired.kind ||
        actual.modifiers !== desired.modifiers ||
        actual.value !== desired.value
      )
        throw Error("保存后读取的值不一致");
      if (this.snapshot.board?.serial !== board) throw Error("接收器已变化");
      if (actual.kind === 4)
        conf.authorizations[`${slot.peer_id}:${desired.key}`] = actual.value;
      else delete conf.authorizations[`${slot.peer_id}:${desired.key}`];
      conf.followers[slot.peer_id] = (
        conf.followers[slot.peer_id] ?? []
      ).filter((k) => k !== desired.key);
      await this.persist();
      await this.refresh();
      return actual;
    } catch (e) {
      this.log("写入未确认时不自动重放，请重新读取实际映射");
      throw e;
    } finally {
      this.update({ busy: false });
    }
  }
  private async action(event: Record<string, unknown>) {
    try {
      const origin = this.require();
      if (
        !Number.isInteger(event.slot) ||
        Number(event.slot) < 0 ||
        Number(event.slot) > 3
      )
        return;
      const slot = await origin.command<Slot>(OP.SLOT, { slot: event.slot });
      if (
        this.session !== origin ||
        slot.peer_id !== event.peer_id ||
        slot.generation !== event.generation ||
        slot.state !== 5
      )
        return;
      const conf = this.boardConfig(),
        id = Number(event.action);
      if (
        conf.authorizations[`${slot.peer_id}:${event.key}`] !== id ||
        !conf.actions[id]
      ) {
        this.log(`未配置的软件动作 #${id}`);
        return;
      }
      const session = this.require();
      const board = this.snapshot.board?.serial;
      const map = await session.command<Mapping>(OP.MAP_GET, {
        slot: slot.slot,
        peer_id: slot.peer_id,
        key: event.key,
      });
      if (
        this.session !== session ||
        this.snapshot.board?.serial !== board ||
        map.kind !== 4 ||
        map.value !== id
      )
        return;
      const action = conf.actions[id];
      let inputMethod: VoiceInputMethod | undefined;
      if (
        action.kind === "input" ||
        (action.kind === "command" && action.target === "focus_input")
      ) {
        const voiceMap = await session.command<Mapping>(OP.MAP_GET, {
          slot: slot.slot,
          peer_id: slot.peer_id,
          key: 2,
        });
        if (this.session !== session || this.snapshot.board?.serial !== board)
          throw Error("接收器已变化，已取消操作");
        inputMethod = inputMethodForVoice(voiceMap);
      }
      await this.platform.run(action, inputMethod);
    } catch (e) {
      this.report(e);
    }
  }
  async diagnostics() {
    const s = this.require(),
      result: unknown[] = [];
    for (let index = 0; index < 5; index++) {
      try {
        result.push(await s.command(OP.STATS, { index }));
      } catch (e) {
        if (!(e instanceof DeviceError && e.status === 6)) throw e;
      }
    }
    return result;
  }
  async saveShared(desired: Mapping, peers: number[]) {
    this.ensureMutable();
    if (desired.kind === 4) throw Error("软件动作请在各遥控器中单独设置");
    const board = this.snapshot.board!.serial,
      conf = this.boardConfig();
    const { revision: _, ...shared } = desired;
    conf.shared[desired.key] = shared;
    await this.persist();
    const failures: string[] = [];
    let applied = 0;
    for (const peer of peers) {
      try {
        if (this.snapshot.board?.serial !== board) throw Error("接收器已变化");
        const slot = this.snapshot.slots.find((s) => s.peer_id === peer);
        if (!slot) throw Error("遥控器已移除");
        const keys = await this.keys(slot);
        const entry = keys.find((e) => e.catalog.key === desired.key);
        if (!entry) throw Error("此遥控器没有这个按键");
        await this.saveMap(slot, { ...desired, revision: entry.map.revision });
        conf.followers[peer] = [
          ...new Set([...(conf.followers[peer] ?? []), desired.key]),
        ];
        await this.persist();
        applied++;
      } catch (e) {
        failures.push(`${peer}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (failures.length)
      throw Error(`已保存 ${applied} 台，其余失败：${failures.join("；")}`);
  }
  async backup() {
    await this.settingsTail;
    return JSON.parse(JSON.stringify(this.settings)) as Settings;
  }
  async importSettings(value: Settings) {
    if (this.snapshot.busy) throw Error("请先等待当前操作结束");
    // Imported actions require a fresh, explicitly saved mapping before execution.
    const copy = JSON.parse(JSON.stringify(value)) as Settings;
    for (const b of Object.values(copy.boards)) b.authorizations = {};
    await this.platform.save(copy);
    this.settings = copy;
    await this.platform.background(copy.background);
    this.update();
  }
}
