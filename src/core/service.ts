import { applyOverride, applyEditedModel, type ModelOverride } from "./model-overrides";
import { candidateStream } from "./candidates";
import {
  resolveCatalog,
  mergeCatalogCopies,
  matchingArtwork,
  compileCatalog,
  uploadCatalog,
  type CatalogModel,
  type CatalogSnapshot,
} from "./catalog";
import {
  loadModels,
  validateModel,
  syncModels,
  remoteModels,
  type ModelSource,
} from "./models";
import {
  validatePackage,
  transferFirmware,
  isNewer,
  type FirmwarePackage,
} from "./firmware";
import { validateSettings } from "./settings";
import {
  validAction,
  builtinActions,
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
  overrides?(): Promise<ModelOverride[]>;
  catalog?(): Promise<CatalogSnapshot>;
  stageCatalog?(): Promise<CatalogSnapshot>;
  activateCatalog?(commit: string): Promise<void>;
  models?(): Promise<ModelSource[]>;
  ports(): Promise<Port[]>;
  transport(): Transport;
  load(): Promise<Partial<Settings>>;
  save(value: Settings): Promise<void>;
  run(action: Action, inputMethod?: VoiceInputMethod): Promise<void>;
  background(enabled: boolean): Promise<void>;
  updateLock?(enabled: boolean): Promise<void>;
}
export class ProbeSessionLostError extends Error {}

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
  private updating = false;
  private cancelUpdate = false;
  private probeAudio?: (body: Record<string, unknown>) => void;
  private manualSerial?: string;
  private settingsTail: Promise<unknown> = Promise.resolve();
  private catalogModels: CatalogModel[] = [];
  private modelAliases = new Map<string,string>();
  catalogVersion = "";
  readonly overriddenModels = new Set<string>();
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
    try {
      await this.loadModelResources();
    } catch (e) {
      this.report(e);
    }
    this.loop = this.work();
  }
  async stop() {
    if (this.updating) throw Error("接收器正在更新");
    this.stopped = true;
    await this.loop;
    const s = this.session;
    this.session = undefined;
    if (s) await s.close();
    this.update({ status: "disconnected", slots: [], info: undefined });
  }
  private async work() {
    while (!this.stopped) {
      if (this.updating) {
        await sleep(200);
        continue;
      }
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
  async connect(port: Port, forUpdate = false) {
    if (this.connecting || (this.snapshot.busy && !forUpdate)) return;
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
        if (!this.updating) this.report(e);
        void s.close(false).catch((e) => this.report(e));
      };
      s.onEvent = (f) => {
        if (this.session === s && f.opcode === OP.PROBE_AUDIO)
          this.probeAudio?.(f.body);
        if (this.session === s && f.opcode === OP.ACTION)
          void this.action(f.body);
      };
      await s.open(port.path);
      if (this.session !== s) throw Error("握手过程中连接中断");
      await this.refresh();
      if (this.platform.models && remoteModels.size) {
        if (this.snapshot.info?.catalog_api === 2) {
          if (!this.snapshot.info.catalog_generation) {
            try {
              await uploadCatalog(
                (op, body) => s.command(op, body),
                this.catalogModels,
              );
              await this.refresh();
            } catch (e) {
              this.report(e);
            }
          }
        } else if (this.snapshot.info?.model_api === 1) {
          try {
            await syncModels(
              (op, body) => s.command(op, body),
              this.snapshot.info.model_capacity ?? 16,
            );
          } catch (e) {
            this.report(e);
          }
        } else this.log("接收器固件不支持外部型号，请先更新固件");
      }
      this.update({ status: "connected" });
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
    if (info.catalog_api === 2)
      Object.assign(info, await s.command(OP.DB_STATUS));
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
      /* Some remotes advertise their name intermittently and bind during a
       * nameless window; the model title beats a bare model id. */
      remoteModels.get(slot.model)?.title ||
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
  private adoption?: { model: string; operation: number };
  remoteLimit() { return Math.min(2, this.snapshot.info?.max_remotes ?? 2); }
  async beginProbe(onAudio?: (body: Record<string, unknown>) => void) {
    this.ensureMutable();
    if (this.snapshot.slots.filter(s => s.peer_id).length >= this.remoteLimit())
      throw Error(`最多可添加 ${this.remoteLimit()} 个遥控器`);
    if (
      this.snapshot.info?.lifecycle_api !== 2 ||
      this.snapshot.info?.probe_api !== 1 ||
      this.snapshot.info?.probe_voice_api !== 4
    )
      throw Error("接收器固件不支持适配工具，请先更新固件");
    this.update({ busy: true });
    const session = this.require();
    try {
      await session.command(OP.PROBE_BEGIN);
      this.adoption = undefined;
      this.probeAudio = onAudio;
    } catch (e) {
      this.update({ busy: false });
      throw e;
    }
    return async <T = Record<string, unknown>>(
      op: number,
      body: Record<string, unknown> = {},
    ) => {
      if (this.session !== session)
        throw new ProbeSessionLostError("接收器连接已中断，请重新打开适配工具");
      return session.command<T>(op, body);
    };
  }
  releaseProbe() {
    this.probeAudio = undefined;
    this.update({ busy: false });
  }
  async reloadModels(sync = true) {
    if (!this.platform.models) return;
    await this.loadModelResources();
    if (sync && this.snapshot.info?.catalog_api === 2) {
      await this.installCatalog();
    } else if (sync && this.snapshot.info?.model_api === 1) {
      const session = this.require();
      await syncModels(
        (op, body) => session.command(op, body),
        this.snapshot.info.model_capacity ?? 16,
      );
    }
    this.update();
  }
  private async loadModelResources() {
    const sources = this.platform.models ? await this.platform.models() : [];
    const current = this.platform.catalog ? await this.platform.catalog() : undefined;
    const resolved = current ? resolveCatalog(current.resources) : [];
    const defaults = new Map(resolved.map((m) => [m.model.id, m]));
    const local = sources.filter(
      (s) => !defaults.has((s.model as any)?.id) || s.edited,
    );
    const errors = loadModels([
      ...resolved.map((m) => ({
        source: "catalog",
        model: m.model,
        image: matchingArtwork(
          m.model,
          sources.find((s) => (s.model as any)?.id === m.model.id),
        ),
      })),
      ...local.filter((s) => !defaults.has((s.model as any)?.id)),
    ]);
    if (errors.length) throw Error(errors.join("\n"));
    // A locally edited model is a private default definition; the official
    // resource graph remains immutable and does not acquire personal changes.
    for (const s of local.filter((s) => defaults.has((s.model as any)?.id)))
      remoteModels.set((s.model as any).id,
        applyEditedModel({ ...defaults.get((s.model as any).id)!.model, image: s.image }, validateModel(s.model)));
    this.catalogModels = [...remoteModels.values()].map((model) => {
      const official = defaults.get(model.id);
      if (official) return { ...official, model };
      const source = local.find((s) => (s.model as any)?.id === model.id);
      const attrs = source?.evidence?.attributes ?? [];
      const map = attrs.find(
        (a: any) => a.complete && /^(?:0x)?2a4b$/i.test(a.uuid),
      );
      const required: Record<string, any> = map
        ? {
            report_map: {
              hex: map.hex.toLowerCase(),
              length: map.hex.length / 2,
              crc32c: model.map_crc.toString(16).padStart(8, "0"),
            },
          }
        : {};
      if (map) {
        required.services = attrs
          .filter((a: any) => a.kind === 1)
          .map((a: any) => a.uuid.toLowerCase());
        const pnp = attrs.find(
          (a: any) =>
            a.complete && /^(?:0x)?2a50$/i.test(a.uuid) && a.hex.length === 14,
        );
        if (pnp) {
          const b = Uint8Array.from(pnp.hex.match(/../g), (h: any) =>
            parseInt(h, 16),
          );
          required.pnp = {
            source: b[0],
            vendor: b[1] | (b[2] << 8),
            product: b[3] | (b[4] << 8),
          };
        }
        required.reports = attrs
          .filter(
            (a: any) =>
              a.complete && /^(?:0x)?2908$/i.test(a.uuid) && a.hex.length === 4,
          )
          .map((a: any) => ({
            id: parseInt(a.hex.slice(0, 2), 16),
            type: parseInt(a.hex.slice(2), 16),
          }));
      }
      const fingerprints = map
        ? [{ model: model.id, scan_hints: model.matches, required }]
        : [];
      return {
        model,
        fingerprints,
        buttons: model.keys.map((k) => ({
          id: `b${k.id.toString().padStart(2, "0")}`,
          key: k.id,
          semantic: k.id === 2 ? "voice" : "custom",
        })),
      };
    });
    this.modelAliases.clear();
    this.catalogModels = mergeCatalogCopies(
      this.catalogModels, new Set(defaults.keys()),
      new Set(local.filter(s => s.edited).map(s => (s.model as any).id)), this.modelAliases,
    );
    // Keep legacy IDs available to render existing binding snapshots, while
    // publishing only canonical identities to discovery and the board catalog.
    for (const entry of this.catalogModels) remoteModels.set(entry.model.id, entry.model);
    this.overriddenModels.clear();
    for (const override of await this.platform.overrides?.() ?? []) {
      const entry=this.catalogModels.find(e=>e.model.id===override.id);
      if (!entry) continue;
      entry.model=applyOverride(entry.model,override);
      remoteModels.set(entry.model.id,entry.model);
      this.overriddenModels.add(entry.model.id);
    }
    this.catalogVersion = current?.version ?? "";
  }
  get modelCatalog() { return this.catalogModels; }
  get pairingModels() { return this.catalogModels.map(m => m.model); }
  async installCatalog() {
    const session = this.require();
    await uploadCatalog(
      (op, body) => session.command(op, body),
      this.catalogModels,
    );
    await this.refresh();
  }
  async resetDefaults(slot: Slot, adopt = false) {
    this.ensureMutable();
    const session = this.require(),
      id = this.identity(slot);
    const live = await session.command<Slot>(OP.SLOT, { slot: slot.slot });
    if (live.peer_id !== slot.peer_id || live.state !== 5)
      throw Error("请先唤醒遥控器");
    await session.command(adopt ? OP.DB_ADOPT_DEFAULTS : OP.MAP_RESET, {
      ...id,
      revision: live.map_revision,
    });
    if (!adopt) {
      const conf = this.boardConfig();
      for (const key of Object.keys(conf.authorizations))
        if (key.startsWith(`${slot.peer_id}:`)) delete conf.authorizations[key];
      await this.persist();
    }
    await this.refresh();
  }
  async updateCatalog() {
    this.ensureMutable();
    if (!this.platform.stageCatalog || !this.platform.activateCatalog)
      throw Error("无法更新机型库");
    const next = await this.platform.stageCatalog();
    // Validate and compile before publishing the downloaded directory.
    compileCatalog(resolveCatalog(next.resources), 1);
    await this.platform.activateCatalog(next.commit);
    await this.loadModelResources();
    if (this.snapshot.info?.catalog_api === 2) await this.installCatalog();
    this.update();
  }
  async adoptProbe(modelId: string, transferred: () => void) {
    modelId = this.modelAliases.get(modelId) ?? modelId;
    if (!this.adoption) {
      const { operation_id } = await this.require().command<{
        operation_id: number;
      }>(OP.PROBE_ADOPT, { model_id: modelId });
      this.adoption = { model: modelId, operation: operation_id };
    }
    if (this.adoption.model !== modelId) throw Error("绑定型号已变化");
    transferred();
    const state = await this.require().command<Operation>(OP.OPERATION);
    if (
      state.operation_id === this.adoption.operation &&
      !state.pending &&
      state.result
    ) {
      const retry = await this.require().command<{ operation_id: number }>(
        OP.RETRY,
        { operation_id: state.operation_id },
      );
      this.adoption.operation = retry.operation_id;
    }
    const result = await this.waitOperation(this.adoption.operation);
    await this.refresh();
    if (
      !this.snapshot.slots.some(
        (s) => s.peer_id === result.peer_id && s.model === modelId,
      )
    )
      throw Error("尚未确认设备绑定记录");
  }
  async scan(renew = false) {
    this.ensureMutable();
    if (this.snapshot.info?.lifecycle_api !== 2)
      throw Error("请先更新接收器固件");
    if (
      !renew &&
      this.platform.models &&
      this.snapshot.info?.catalog_api !== 2 &&
      this.snapshot.info?.model_api === 1
    ) {
      const session = this.require();
      await syncModels(
        (op, body) => session.command(op, body),
        this.snapshot.info.model_capacity ?? 16,
      );
    }
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
    for await (const c of candidateStream<Candidate>((op, body) =>
      s.command(op, body),
    )) {
      if (c.scan_epoch === epoch && c.age_ms < 15000)
        items.push({ ...c, seen: performance.now() });
    }
    return items;
  }
  async pair(
    c: Candidate,
    onOperation: (id: number) => void,
    expectedPeer?: number,
    modelId?: string,
  ) {
    this.ensureMutable();
    if (c.age_ms + performance.now() - c.seen >= 15000)
      throw Error("搜索结果已过期，请重新搜索");
    this.update({ busy: true });
    try {
      const { operation_id } = await this.require().command<{
        operation_id: number;
      }>(OP.PAIR, {
        candidate_id: c.candidate_id,
        scan_epoch: c.scan_epoch,
        ...(modelId ? { model_id: modelId } : {}),
      });
      onOperation(operation_id);
      const op = await this.waitOperation(operation_id);
      await this.refresh();
      if (expectedPeer && op.peer_id !== expectedPeer)
        throw Error("配对结果属于另一台遥控器，请核对设备列表");
      if (!this.snapshot.slots.some((s) => s.peer_id === op.peer_id))
        throw Error("尚未确认设备绑定记录");
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
      // A failed cleanup may already have removed the durable binding. Refresh
      // even on failure, but never turn an uncertain operation into success.
      try {
        await this.waitOperation(operation_id);
      } catch (error) {
        await this.refresh().catch((refreshError) => this.log(String(refreshError)));
        throw error;
      }
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
        if (op.result && op.model_error) {
          const messages: Record<number, string> = {
            1: "尚未适配此型号，请先适配遥控器",
            2: "有多个匹配型号，请选择型号后重试",
            3: "遥控器与所选型号不符，请重新选择",
          };
          throw Error(messages[op.model_error] || "型号识别失败");
        }
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
    const before = await s.command<Slot>(OP.SLOT, { slot: slot.slot });
    if (before.peer_id !== slot.peer_id || before.state !== 5)
      throw Error("请先唤醒遥控器");
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
    const after = await s.command<Slot>(OP.SLOT, { slot: slot.slot });
    if (
      this.require() !== s ||
      after.peer_id !== before.peer_id ||
      after.generation !== before.generation ||
      after.state !== 5
    )
      throw Error("遥控器连接已变化，请重新打开按键设置");
    return keys;
  }
  async key(slot: Slot, key: number): Promise<Mapping> {
    const id = this.identity(slot),
      s = this.require();
    const before = await s.command<Slot>(OP.SLOT, { slot: slot.slot });
    if (before.peer_id !== slot.peer_id || before.state !== 5)
      throw Error("请先唤醒遥控器");
    const map = await s.command<Mapping>(OP.MAP_GET, { ...id, key });
    const after = await s.command<Slot>(OP.SLOT, { slot: slot.slot });
    this.identity(slot);
    if (
      this.require() !== s ||
      after.peer_id !== before.peer_id ||
      after.generation !== before.generation ||
      after.state !== 5
    )
      throw Error("遥控器连接已变化，请重新打开按键设置");
    return map;
  }
  resolveAction(id: number): Action | undefined {
    return (
      this.settings.boards[this.snapshot.board?.serial ?? ""]?.actions[id] ??
      builtinActions[id]
    );
  }
  async saveMap(
    slot: Slot,
    desired: Mapping,
    action?: Action,
    inherit = false,
  ) {
    if (desired.kind === 6 && this.snapshot.info?.voice_toggle !== 1)
      throw Error("请先更新接收器固件，再使用会议模式切换");
    if (desired.kind === 5 && this.snapshot.info?.voice_presets !== 1)
      throw Error("请先更新接收器固件，再使用自动语音预设");
    this.ensureMutable();
    if (action && !validAction(action)) throw Error("软件动作配置无效");
    const id = this.identity(slot),
      s = this.require(),
      board = this.snapshot.board!.serial;
    this.update({ busy: true });
    try {
      const live = await s.command<Slot>(OP.SLOT, { slot: slot.slot });
      if (live.peer_id !== slot.peer_id || live.state !== 5)
        throw Error("请先唤醒遥控器，再保存设置");
      const before = await s.command<Mapping>(OP.MAP_GET, {
        ...id,
        key: desired.key,
      });
      if (before.revision !== desired.revision)
        throw Error("按键设置已变化，请重新打开后修改");
      const conf = this.boardConfig();
      if (action && !inherit) {
        let actionId = 1;
        while (conf.actions[actionId] && actionId < 65534) actionId++;
        if (actionId >= 65534) throw Error("软件动作已满");
        desired = { ...desired, kind: 4, modifiers: 0, value: actionId };
        conf.actions[actionId] = action;
        await this.persist();
      }
      if (inherit) {
        if (!before.default) throw Error("接收器没有默认配置快照");
        desired = { ...desired, ...before.default };
      }
      let writeError: unknown;
      try {
        await s.command(
          inherit ? OP.MAP_RESET : OP.MAP_SET,
          inherit
            ? { ...id, key: desired.key, revision: desired.revision }
            : { ...id, ...desired },
        );
      } catch (error) {
        writeError = error;
      }
      const actual = await s.command<Mapping>(OP.MAP_GET, {
        ...id,
        key: desired.key,
      });
      const expectedRevision = (desired.revision + 1) >>> 0 || 1;
      if (
        writeError &&
        (actual.revision !== expectedRevision ||
          actual.kind !== desired.kind ||
          actual.modifiers !== desired.modifiers ||
          actual.value !== desired.value ||
          actual.overridden !== !inherit)
      )
        throw writeError;
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
    if (this.updating) return;
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
      const configured = conf.actions[id];
      const action = configured ?? builtinActions[id];
      if (
        !action ||
        (configured &&
          conf.authorizations[`${slot.peer_id}:${event.key}`] !== id)
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
      if (this.updating) return;
      await this.platform.run(action, inputMethod);
    } catch (e) {
      this.report(e);
    }
  }
  cancelFirmwareUpdate() {
    this.cancelUpdate = true;
  }
  async updateFirmware(pkg: FirmwarePackage) {
    this.ensureMutable();
    const old = this.require(),
      board = this.snapshot.board!,
      info = this.snapshot.info!;
    if (info.voice_owner !== 255) throw Error("请先结束录音");
    this.updating = true;
    this.cancelUpdate = false;
    this.update({
      busy: true,
      error: "",
      firmwareProgress: { phase: "正在检查", percent: 0, active: true },
    });
    try {
      await this.platform.updateLock?.(true);
      const image = await validatePackage(pkg, info);
      if (!isNewer(pkg.manifest.version, info.firmware))
        throw Error("接收器已是当前版本或更新版本");
      await transferFirmware(
        old,
        pkg,
        image,
        (p) => this.update({ firmwareProgress: p }),
        () => this.cancelUpdate,
      );
      this.update({
        firmwareProgress: { phase: "正在重启", percent: 98, active: true },
      });
      if (this.session === old) this.session = undefined;
      await old.close(false);
      await sleep(1200);
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (!this.session) {
          const port = (await this.platform.ports()).find(
            (p) => p.serial === board.serial,
          );
          if (port) await this.connect(port, true);
        }
        if (this.session) {
          try {
            await this.refresh();
          } catch {
            // USB can disappear a second time when the bootloader rolls back.
            const lost = this.session;
            this.session = undefined;
            if (lost) await lost.close(false).catch(() => {});
            await sleep(500);
            continue;
          }
          const current = this.snapshot.info;
          if (
            current?.firmware === `buddy-${pkg.manifest.version}` &&
            current.bank !== info.bank &&
            current.confirmed
          ) {
            this.update({
              error: "",
              firmwareProgress: {
                phase: "更新完成",
                percent: 100,
                active: false,
              },
            });
            return;
          }
          if (
            current?.confirmed &&
            current?.firmware === info.firmware &&
            current.bank === info.bank
          )
            throw Error("更新未生效，接收器仍运行原版本");
        }
        await sleep(500);
      }
      throw Error("未能确认更新结果，请重新连接接收器检查版本");
    } catch (e) {
      this.update({
        firmwareProgress: {
          phase: e instanceof Error ? e.message : String(e),
          percent: 0,
          active: false,
        },
      });
      throw e;
    } finally {
      this.updating = false;
      this.update({ busy: false });
      await this.platform.updateLock?.(false);
    }
  }
  async diagnostics() {
    const s = this.require(),
      result: unknown[] = [];
    // Faults, audio/USB counters, negotiated links, probe status and control history.
    // Read only on request; do not poll the high-volume HCI ring during recording.
    const indices = [
      ...Array.from({ length: 11 }, (_, i) => i),
      12,
      ...Array.from({ length: 64 }, (_, i) => i + 16),
    ];
    for (const index of indices) {
      try {
        const data = await s.command(OP.STATS, { index });
        if (this.session !== s) throw Error("接收器已变化");
        result.push({ index, data });
      } catch (e) {
        if (!(e instanceof DeviceError && e.status === 6)) throw e;
        if (index >= 16) break; // Newest-first history is contiguous.
      }
    }
    return result;
  }
  async backup() {
    await this.settingsTail;
    const copy = JSON.parse(JSON.stringify(this.settings)) as Settings;
    if (this.snapshot.info?.catalog_api === 2 && this.snapshot.board) {
      const session = this.require(),
        bindings = [];
      for (const slot of this.snapshot.slots.filter((s) => s.peer_id)) {
        const live = await session.command<Slot>(OP.SLOT, { slot: slot.slot });
        if (live.peer_id !== slot.peer_id) throw Error("遥控器已变化");
        let hex = "",
          length = 1;
        while (hex.length / 2 < length) {
          const part = await session.command<{ hex: string; length: number }>(
            OP.CONFIG_READ,
            {
              ...this.identity(slot),
              revision: live.map_revision,
              offset: hex.length / 2,
            },
          );
          if (!part.hex || part.length > 16384) throw Error("快照读取失败");
          length = part.length;
          hex += part.hex;
        }
        bindings.push({ peer_id: slot.peer_id, model: slot.model, hex });
      }
      copy.boards[this.snapshot.board.serial] = {
        ...this.boardConfig(),
        bindings,
      };
    }
    return copy;
  }
  async importSettings(value: Settings) {
    if (this.snapshot.busy) throw Error("请先等待当前操作结束");
    // Imported actions require a fresh, explicitly saved mapping before execution.
    const copy = JSON.parse(JSON.stringify(value)) as Settings;
    for (const b of Object.values(copy.boards)) b.authorizations = {};
    const saved =
      this.snapshot.board && copy.boards[this.snapshot.board.serial]?.bindings;
    if (saved?.length) {
      this.ensureMutable();
      const session = this.require();
      if (this.snapshot.info?.catalog_api !== 2)
        throw Error("请更新接收器后恢复绑定快照");
      // Check every identity before the first write. Each slot then commits
      // atomically; re-running restoration is safe after an interrupted import.
      const targets = saved.map((b) => {
        const slot = this.snapshot.slots.find(
          (s) => s.peer_id === b.peer_id && s.model === b.model,
        );
        if (!slot) throw Error("备份中的遥控器未绑定到当前接收器");
        return { b, slot };
      });
      // Revoke current permissions before any receiver mutation, including
      // partial/failed imports. A restored numeric action is never consent.
      for (const board of Object.values(this.settings.boards))
        board.authorizations = {};
      await this.persist();
      for (const { b, slot } of targets) {
        const live = await session.command<Slot>(OP.SLOT, { slot: slot.slot });
        const { token } = await session.command<{ token: number }>(
          OP.CONFIG_BEGIN,
          {
            ...this.identity(slot),
            revision: live.map_revision,
            length: b.hex.length / 2,
          },
        );
        try {
          for (let i = 0; i < b.hex.length; i += 320)
            await session.command(OP.CONFIG_DATA, {
              token,
              offset: i / 2,
              hex: b.hex.slice(i, i + 320),
            });
          await session.command(OP.CONFIG_COMMIT, { token });
        } catch (error) {
          await session.command(OP.CONFIG_ABORT, { token }).catch(() => {});
          throw error;
        }
      }
      await this.refresh();
    }
    await this.platform.save(copy);
    this.settings = copy;
    await this.platform.background(copy.background);
    this.update();
  }
}
