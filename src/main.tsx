import { ModelDefaults } from "./ModelDefaults";
import { Feedback } from "./Feedback";
import { artworkModel, renderRemoteArtwork } from "./core/remote-artwork";
import { ReceiverSetup, type SetupCandidate } from "./ReceiverSetup";
import { ProbeWorkbench } from "./ProbeWorkbench";
import { remoteModels, loadModels } from "./core/models";
import { isNewer, type FirmwarePackage } from "./core/firmware";
import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Radio,
  Settings as SettingsIcon,
  MoreHorizontal,
  ArrowUpRight,
  ChevronRight,
  ArrowLeft,
  Mic,
  Power,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Volume2,
  Volume1,
  VolumeX,
  House,
  Undo2,
  Menu,
  Check,
  BatteryFull,
  LoaderCircle,
} from "lucide-react";
import { call, native, SerialTransport } from "./native";
import { BuddyService } from "./core/service";
import { Discovery, isBoundCandidate } from "./core/discovery";
import type {
  Slot,
  KeyEntry,
  Mapping,
  Candidate,
  Action,
  Port,
  Settings,
} from "./core/types";
import { validateSettings } from "./core/settings";
import { labels, modifiers, usages, media, chord } from "./core/layout";
import "./style.css";
import { ActionFields } from "./ActionFields";
import { WindowPicker } from "./WindowPicker";
import { ProjectLinks, ExternalLink, project } from "./ProjectLinks";
import { configurePlatform } from "./platform";
import { runAction } from "./action-runner";
import {
  validAction,
  inputProfiles,
  commands,
  voicePresets,
  voicePreset,
} from "./core/actions";

if (!native) {
  const packages = import.meta.glob("../resources/remotes/*/model.json", {
    eager: true,
    import: "default",
  });
  const artwork = import.meta.glob<string>("../resources/remotes/*/*.svg", {
    eager: true,
    query: "?raw",
    import: "default",
  });
  loadModels(
    Object.entries(packages).map(([source, model]) => ({
      source,
      model,
      image:
        artwork[
          source.replace(
            "model.json",
            (model as { layout?: { artwork?: string } }).layout?.artwork ?? "",
          )
        ],
    })),
  );
}
const service = new BuddyService({
  models: () => call("remote_model_resources"),
  ports: () => call<Port[]>("ports"),
  transport: () => new SerialTransport(),
  load: () => call("load_settings"),
  save: (value) => call("save_settings", { value }),
  run: runAction,
  background: (enabled) => call("set_background", { enabled }),
  updateLock: (enabled) => call("firmware_lock", { enabled }),
});
const icons: Record<number, React.ComponentType<{ size?: number }>> = {
  1: Power,
  2: Mic,
  3: ArrowUp,
  4: ArrowDown,
  5: ArrowLeft,
  6: ArrowRight,
  7: Check,
  8: Undo2,
  9: House,
  10: Menu,
  12: Volume2,
  13: Volume1,
  14: VolumeX,
  19: SettingsIcon,
};
function KeyIcon({ id }: { id: number }) {
  const Icon = icons[id];
  return Icon ? <Icon size={17} /> : <span>{labels[id] ?? id}</span>;
}
function Spinner() {
  return <LoaderCircle className="spin" size={16} />;
}
function App() {
  const [firmware, setFirmware] = useState<FirmwarePackage | null>(null);
  const snap = useSyncExternalStore(service.subscribe, service.getSnapshot),
    [page, setPage] = useState<"home" | "keys" | "settings">("home"),
    [peer, setPeer] = useState(0),
    [repairPeer, setRepairPeer] = useState<number>(),
    [entries, setEntries] = useState<KeyEntry[]>([]),
    [loading, setLoading] = useState(false),
    [wake, setWake] = useState<Slot>(),
    [modal, setModal] = useState<
      | "add"
      | "model-defaults"
      | "more"
      | "rename"
      | "remove"
      | "edit"
      | "probe"
      | "setup"
      | "diagnostics"
      | "shared"
      | "backup"
      | "about"
      | null
    >(null),
    [edit, setEdit] = useState<KeyEntry>(),
    [localBusy, setLocalBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [diag, setDiag] = useState<unknown[]>([]),
    [alias, setAlias] = useState(""),
    [autostart, setAutostart] = useState(false);
  const selected = snap.slots.find((s) => s.peer_id === peer && peer !== 0),
    bound = snap.slots.filter((s) => s.peer_id),
    busy = snap.busy || localBusy,
    connected = snap.status === "connected",
    recording = connected && snap.info?.voice_owner !== 255;
  useEffect(() => {
    let cancelled = false;
    setFirmware(null);
    if (native && connected && snap.info?.target)
      void call<FirmwarePackage | null>("firmware_package", {
        target: snap.info.target,
      })
        .then((p) => {
          if (!cancelled) setFirmware(p);
        })
        .catch((e) => service.report(e));
    return () => {
      cancelled = true;
    };
  }, [connected, snap.info?.target]);
  useEffect(() => {
    if (native) {
      void call<string>("desktop_platform")
        .then((platform) => {
          configurePlatform(platform);
          return service.start();
        })
        .catch((e) => service.report(e));
      void call<boolean>("plugin:autostart|is_enabled")
        .then(setAutostart)
        .catch((e) => service.report(e));
    }
    return () => {
      void service.stop();
    };
  }, []);
  const [setupCandidates, setSetupCandidates] = useState<SetupCandidate[]>([]);
  useEffect(() => {
    if (!native || connected || modal === "setup") return;
    let cancelled = false,
      polling = false;
    const tick = async () => {
      if (polling) return;
      polling = true;
      try {
        const found = await call<SetupCandidate[]>("setup_candidates");
        if (!cancelled) setSetupCandidates(found);
      } catch {
        if (!cancelled) setSetupCandidates([]);
      } finally {
        polling = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connected, modal]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(t);
  }, [notice]);
  const safely = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      service.report(e);
    }
  };
  const wakeKey = useRef<number | undefined>(undefined);
  const wakeBoard = useRef<string | undefined>(undefined);
  const loadKeys = async (s: Slot, key?: number) => {
    if (loading || busy) return;
    if (s.state !== 5) {
      wakeKey.current = key;
      wakeBoard.current = snap.board?.serial;
      setWake(s);
      return;
    }
    setPeer(s.peer_id);
    if (key === undefined) setEntries([]);
    setLoading(true);
    try {
      const fresh =
        key === undefined ? await service.keys(s) : entries.map((e) => e);
      if (key !== undefined) {
        const index = fresh.findIndex((e) => e.catalog.key === key);
        if (index < 0) throw Error("按键已变化，请重新打开设置");
        fresh[index] = { ...fresh[index], map: await service.key(s, key) };
      }
      setEntries(fresh);
      setPage("keys");
      if (key !== undefined) {
        setEdit(fresh.find((e) => e.catalog.key === key));
        setModal("edit");
      }
    } catch (e) {
      service.report(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!wake) return;
    if (!connected || wakeBoard.current !== snap.board?.serial) {
      setWake(undefined);
      return;
    }
    const current = snap.slots.find(
      (s) => s.peer_id === wake.peer_id && s.slot === wake.slot,
    );
    if (!current) {
      setWake(undefined);
      return;
    }
    if (current.state === 5 && !snap.busy && !loading) {
      setWake(undefined);
      void loadKeys(current, wakeKey.current);
    }
  }, [wake, connected, snap.slots, snap.busy, loading, snap.board?.serial]);
  const status = (s: Slot) =>
    !connected
      ? "未连接"
      : snap.info?.voice_owner === s.slot
        ? "正在录音"
        : ({
            1: "离线",
            2: "正在连接",
            3: "正在配对",
            4: "正在连接",
            5: "可用",
            6: "不支持",
            7: "连接异常",
          }[s.state] ?? "未连接");
  const describe = (m: Mapping) =>
    m.kind === 5
      ? m.value === 1
        ? "豆包输入法 · 默认"
        : "微信输入法 · 默认"
      : m.kind === 0
        ? "不使用"
        : m.kind === 2
          ? (media[m.value] ?? `媒体键 ${m.value}`)
          : m.kind === 3
            ? m.modifiers === 0 && m.value === 44
              ? "视频会议"
              : m.modifiers === 64 && !m.value
                ? "豆包输入法"
                : m.modifiers === 9 && !m.value
                  ? "微信输入法"
                  : chord(m.modifiers, m.value)
            : m.kind === 4
              ? (service.settings.boards[snap.board?.serial ?? ""]?.actions[
                  m.value
                ]?.label ?? `未配置的功能 #${m.value}`)
              : chord(m.modifiers, m.value);
  const openMore = (s: Slot) => {
    setPeer(s.peer_id);
    setModal("more");
  };
  return (
    <div className="app">
      <header>
        <button
          className="brand quiet"
          aria-label="Vibe Remote Buddy 首页"
          onClick={() => {
            setModal(null);
            setPage("home");
          }}
        >
          <img className="logo" src="/icon.svg" alt="" width="32" height="32" />
          Vibe Remote Buddy
        </button>
        <div className="header-right">
          <span className="connection">
            {snap.status === "connecting" ? (
              <Spinner />
            ) : (
              <span className={connected ? "dot" : "dot offline"} />
            )}{" "}
            {connected
              ? "接收器已连接"
              : snap.status === "connecting"
                ? "正在连接…"
                : "未找到接收器"}
          </span>
          {!connected && setupCandidates.length > 0 && (
            <button
              disabled={busy || !!modal}
              onClick={() => setModal("setup")}
            >
              初始化接收器
            </button>
          )}
          <ProjectLinks onError={(e) => service.report(e)} />
          <button
            className="icon quiet"
            aria-label="设置"
            onClick={() => setPage("settings")}
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>
      <main>
        {!native && (
          <div className="note">浏览器预览 · 设备管理需要桌面应用</div>
        )}
        {snap.error && (
          <Feedback error>
            <span>{snap.error}</span>
            <button className="quiet" onClick={() => service.clearError()}>
              关闭
            </button>
          </Feedback>
        )}
        {snap.ports.length > 1 && !connected && (
          <Feedback>
            <label className="field">
              接收器
              <select
                disabled={snap.status === "connecting"}
                value=""
                onChange={(e) => {
                  const p = snap.ports.find((p) => p.path === e.target.value);
                  if (p) void service.connect(p);
                }}
              >
                <option value="">选择接收器</option>
                {snap.ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name} · {p.serial}
                  </option>
                ))}
              </select>
            </label>
          </Feedback>
        )}
        {page === "home" && (
          <>
            <div className="title">
              <h1>我的遥控器</h1>
              <button
                className="primary"
                disabled={
                  !connected || busy || !!recording || bound.length >= 4
                }
                onClick={() => setModal("add")}
              >
                ＋ 添加遥控器
              </button>
            </div>
            <div className="devices">
              {bound.map((s) => (
                <section
                  className="device"
                  key={`${snap.board?.serial}:${s.peer_id}`}
                >
                  <div className="device-art">
                    <MiniRemote model={s.model} />
                    <button
                      className="icon quiet more"
                      aria-label={`${service.name(s)} 更多`}
                      onClick={() => openMore(s)}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  <div className="device-copy">
                    <h2>{service.name(s)}</h2>
                    <p className="model">{modelName(s.model)}</p>
                    <div className="device-status">
                      <span
                        className={`remote-state ${s.state === 5 ? "available" : ""}`}
                        role="status"
                      >
                        <span
                          className={`recording-mark ${connected && snap.info?.voice_owner === s.slot ? "active" : ""}`}
                          aria-hidden="true"
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                        {status(s)}
                      </span>
                      {s.battery !== 255 && (
                        <span>
                          <BatteryFull size={16} />
                          {s.battery}%
                        </span>
                      )}
                    </div>
                    <button
                      className="configure"
                      disabled={!connected || loading}
                      onClick={() => void loadKeys(s)}
                    >
                      设置按键
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                </section>
              ))}
            </div>
            {!bound.length && (
              <div className="empty">
                {connected ? "还没有遥控器" : "连接 Vibe Remote Buddy 接收器"}
              </div>
            )}
            {bound.length >= 4 && (
              <p className="muted capacity">最多可添加 4 个遥控器</p>
            )}
          </>
        )}
        {page === "keys" && (
          <>
            <button className="back quiet" onClick={() => setPage("home")}>
              ‹ 我的遥控器
            </button>
            <div className="title">
              <div>
                <h1>{selected ? service.name(selected) : "遥控器未连接"}</h1>
                {selected && (
                  <p className="muted">{modelName(selected.model)}</p>
                )}
              </div>
              <button
                className="icon quiet"
                disabled={!selected}
                aria-label="遥控器更多设置"
                onClick={() => selected && openMore(selected)}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
            {loading ? (
              <div className="empty">
                <Spinner /> 正在读取按键…
              </div>
            ) : selected ? (
              <div className="layout-panel">
                <div className="layout-stage">
                  <ModelRemote
                    model={selected.model}
                    keys={entries.map((e) => e.catalog.key)}
                    onKey={(id) => {
                      void loadKeys(selected, id);
                    }}
                  />
                  <p className="caption muted">按键示意</p>
                </div>
                <div>
                  <div className="keylist">
                    {entries
                      .filter((e) => [2, 9, 8, 12, 13].includes(e.catalog.key))
                      .sort(
                        (a, b) =>
                          [2, 9, 8, 12, 13].indexOf(a.catalog.key) -
                          [2, 9, 8, 12, 13].indexOf(b.catalog.key),
                      )
                      .map((e) => (
                        <KeyRow
                          key={e.catalog.key}
                          entry={e}
                          description={describe(e.map)}
                          onClick={() => {
                            void loadKeys(selected, e.catalog.key);
                          }}
                        />
                      ))}
                  </div>
                  <details open={!remoteModels.has(selected.model)}>
                    <summary>其他按键</summary>
                    <div className="keylist">
                      {entries
                        .filter(
                          (e) => ![2, 9, 8, 12, 13].includes(e.catalog.key),
                        )
                        .map((e) => (
                          <KeyRow
                            key={e.catalog.key}
                            entry={e}
                            description={describe(e.map)}
                            onClick={() => {
                              void loadKeys(selected, e.catalog.key);
                            }}
                          />
                        ))}
                    </div>
                  </details>
                </div>
              </div>
            ) : (
              <button onClick={() => setPage("home")}>返回遥控器</button>
            )}
          </>
        )}
        {page === "settings" && (
          <>
            <button className="back quiet" onClick={() => setPage("home")}>
              ‹ 我的遥控器
            </button>
            <div className="title">
              <h1>设置</h1>
            </div>
            <label className="setting">
              <span>登录时启动</span>
              <input
                type="checkbox"
                checked={autostart}
                disabled={!native}
                onChange={(e) => {
                  const value = e.target.checked;
                  void safely(async () => {
                    await call(
                      `plugin:autostart|${value ? "enable" : "disable"}`,
                    );
                    setAutostart(value);
                  });
                }}
              />
            </label>
            <label className="setting">
              <span>关闭窗口后继续运行</span>
              <input
                type="checkbox"
                checked={service.settings.background}
                disabled={!native}
                onChange={(e) =>
                  void safely(() => service.setBackground(e.target.checked))
                }
              />
            </label>
            <div className="setting">
              <span>
                接收器固件
                <br />
                <small className="muted">
                  {snap.info?.firmware ?? "未连接"}
                  {firmware ? ` · 可用 ${firmware.manifest.version}` : ""}
                </small>
              </span>
              <button
                disabled={
                  !connected ||
                  busy ||
                  !firmware ||
                  snap.info?.update_api !== 1 ||
                  !isNewer(firmware.manifest.version, snap.info?.firmware ?? "")
                }
                onClick={() =>
                  void safely(() => service.updateFirmware(firmware!))
                }
              >
                更新
              </button>
            </div>
            {firmware && <p className="muted">{firmware.manifest.notes}</p>}
            {connected && snap.info?.update_api !== 1 && (
              <p className="muted">此接收器需要首次安装新版固件</p>
            )}
            {snap.firmwareProgress && (
              <Feedback>
                <div role="status" aria-live="polite">
                  <span>{snap.firmwareProgress.phase}</span>
                  {snap.firmwareProgress.active && (
                    <progress
                      style={{ width: "100%" }}
                      max={100}
                      value={snap.firmwareProgress.percent}
                    />
                  )}
                  {snap.firmwareProgress.active &&
                    snap.firmwareProgress.percent < 96 && (
                      <button onClick={() => service.cancelFirmwareUpdate()}>
                        取消更新
                      </button>
                    )}
                </div>
              </Feedback>
            )}
            <details>
              <summary>高级</summary>
              <div className="setting">
                <span>初始化接收器</span>
                <button
                  disabled={!native || busy || recording}
                  onClick={() => setModal("setup")}
                >
                  打开
                </button>
              </div>
              <div className="setting">
                <span>遥控器适配工具</span>
                <button
                  disabled={!connected || busy}
                  onClick={() => setModal("probe")}
                >
                  打开
                </button>
              </div>

              <div className="setting">
                <span>备份与恢复</span>
                <button
                  disabled={!native || busy}
                  onClick={() => setModal("backup")}
                >
                  打开
                </button>
              </div>
              <div className="setting">
                <span>接收器与故障日志</span>
                <button
                  disabled={!connected}
                  onClick={() =>
                    void safely(async () => {
                      setDiag(await service.diagnostics());
                      setModal("diagnostics");
                    })
                  }
                >
                  查看
                </button>
              </div>
              <button
                disabled={!native}
                onClick={() =>
                  void safely(async () => {
                    await service.stop();
                    await call("quit");
                  })
                }
              >
                退出 Vibe Remote Buddy
              </button>
            </details>
            <button
              className="setting about-entry quiet"
              onClick={() => setModal("about")}
            >
              <span>关于 Vibe Remote Buddy</span>
              <ChevronRight size={17} />
            </button>
          </>
        )}
      </main>
      {modal === "setup" && (
        <ReceiverSetup
          service={service}
          done={(add) => {
            setRepairPeer(undefined);
            setPage("home");
            setModal(add ? "add" : null);
          }}
        />
      )}
      {modal === "probe" && (
        <ProbeWorkbench
          service={service}
          close={() => setModal(null)}
          addRemote={() => {
            setRepairPeer(undefined);
            setPage("home");
            setModal("add");
          }}
        />
      )}
      {modal === "about" && (
        <Dialog title="关于" close={() => setModal(null)}>
          <div className="about-product">
            <img className="logo" src="/icon.svg" alt="" />
            <div>
              <h2>Vibe Remote Buddy</h2>
              <p className="muted">版本 0.1.0 · 作者 kxn</p>
            </div>
          </div>
          <ProjectLinks onError={(e) => service.report(e)} />
          <ExternalLink
            href={project.notices}
            onError={(e) => service.report(e)}
          >
            第三方代码与版权声明 <ArrowUpRight size={15} />
          </ExternalLink>
          <p className="muted">© 2026 kxn · MIT License</p>
          <footer>
            <button onClick={() => setModal(null)}>关闭</button>
          </footer>
        </Dialog>
      )}
      {modal === "add" && (
        <PairDialog
          service={service}
          expectedPeer={repairPeer}
          close={() => {
            setRepairPeer(undefined);
            setModal(null);
          }}
          done={() => {
            setModal(null);
            setNotice(repairPeer ? "已重新配对" : "已添加遥控器");
            setRepairPeer(undefined);
          }}
        />
      )}
      {modal === "model-defaults" &&
        selected &&
        remoteModels.has(selected.model) && (
          <ModelDefaults
            model={remoteModels.get(selected.model)!}
            service={service}
            close={() => setModal(null)}
          />
        )}
      {modal === "more" && selected && (
        <Dialog title={service.name(selected)} close={() => setModal(null)}>
          <div className="setting">
            <span>名称</span>
            <button
              onClick={() => {
                setAlias(service.name(selected));
                setModal("rename");
              }}
            >
              修改
            </button>
          </div>
          <div className="setting">
            <span>型号默认配置</span>
            <button
              disabled={
                busy || !!recording || !remoteModels.has(selected.model)
              }
              onClick={() => setModal("model-defaults")}
            >
              编辑
            </button>
          </div>
          <div className="setting">
            <span>重新配对</span>
            <button
              disabled={busy || !!recording}
              onClick={() => {
                setRepairPeer(selected.peer_id);
                setModal("add");
              }}
            >
              开始
            </button>
          </div>
          <footer>
            <button onClick={() => setModal(null)}>完成</button>
            <button
              className="danger"
              disabled={busy || !!recording}
              onClick={() => setModal("remove")}
            >
              移除遥控器
            </button>
          </footer>
        </Dialog>
      )}
      {modal === "rename" && selected && (
        <Dialog title="修改名称" close={() => !busy && setModal(null)}>
          <label className="field">
            名称
            <input
              value={alias}
              maxLength={64}
              onChange={(e) => setAlias(e.target.value)}
            />
          </label>
          <footer>
            <button disabled={busy} onClick={() => setModal(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy || !alias.trim()}
              onClick={() =>
                void safely(async () => {
                  setLocalBusy(true);
                  try {
                    await service.rename(selected, alias);
                    setModal(null);
                  } finally {
                    setLocalBusy(false);
                  }
                })
              }
            >
              {busy ? <Spinner /> : "保存"}
            </button>
          </footer>
        </Dialog>
      )}
      {modal === "remove" && selected && (
        <Dialog title="移除遥控器" close={() => !busy && setModal(null)}>
          <p>移除「{service.name(selected)}」？</p>
          <p className="muted">它的自定义按键会恢复默认。</p>
          <footer>
            <button disabled={busy} onClick={() => setModal(null)}>
              取消
            </button>
            <button
              className="danger"
              disabled={busy || !!recording}
              onClick={() =>
                void safely(async () => {
                  await service.unbind(selected);
                  setModal(null);
                  setPage("home");
                  setNotice("已移除");
                })
              }
            >
              {busy ? (
                <>
                  <Spinner />
                  正在移除…
                </>
              ) : (
                "移除"
              )}
            </button>
          </footer>
        </Dialog>
      )}
      {wake && (
        <Dialog title="唤醒遥控器" close={() => setWake(undefined)}>
          <p>请按一下「{service.name(wake)}」的方向键。</p>
          <p role="status">
            <Spinner /> 等待连接…
          </p>
          <footer>
            <button onClick={() => setWake(undefined)}>取消</button>
          </footer>
        </Dialog>
      )}
      {modal === "edit" && edit && selected && (
        <Editor
          entry={edit}
          initialAction={
            edit.map.kind === 4
              ? service.boardConfig().actions[edit.map.value]
              : undefined
          }
          disabled={busy || !!recording || !connected}
          close={() => setModal(null)}
          save={async (m, a) => {
            const actual = await service.saveMap(selected, m, a);
            setEntries((old) =>
              old.map((e) =>
                e.catalog.key === m.key ? { ...e, map: actual } : e,
              ),
            );
            setModal(null);
            setNotice("已保存");
          }}
        />
      )}
      {modal === "shared" && (
        <SharedDialog service={service} close={() => setModal(null)} />
      )}
      {modal === "backup" && (
        <BackupDialog service={service} close={() => setModal(null)} />
      )}
      {modal === "diagnostics" && (
        <Dialog title="接收器与故障日志" close={() => setModal(null)}>
          <pre>
            {JSON.stringify(
              { receiver: snap.board, info: snap.info, faults: diag },
              null,
              2,
            )}
          </pre>
          <pre>{snap.logs.join("\n") || "暂无日志"}</pre>
          <footer>
            <button onClick={() => setModal(null)}>完成</button>
          </footer>
        </Dialog>
      )}
      {notice && <Feedback>{notice}</Feedback>}
    </div>
  );
}
function modelName(id: string) {
  return remoteModels.get(id)?.title ?? id;
}
function ModelRemote({
  model,
  mini = false,
  onKey,
  keys,
}: {
  model: string;
  mini?: boolean;
  onKey?: (id: number) => void;
  keys?: number[];
}) {
  const resource = remoteModels.get(model);
  if (!resource)
    return (
      <div className="muted">
        {mini ? <Radio size={32} /> : "此型号使用按键列表"}
      </div>
    );
  const layout = artworkModel(resource).layout;
  const drawnKeys = resource.keys.filter((k) => !keys || keys.includes(k.id));
  const buttons = layout.buttons.filter((b) =>
    drawnKeys.some((k) => k.id === b.key),
  );
  // Built-in artwork contains structural pieces (direction ring / volume rocker).
  // Its transparent hit areas must remain transparent, including thumbnails.
  const generated = !resource.image || layout.artworkButtons;
  const artwork =
    mini && generated
      ? renderRemoteArtwork({
          ...resource,
          keys: drawnKeys,
          layout: { ...layout, buttons },
        })
      : !generated
        ? resource.image
        : undefined;
  const image = artwork
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork)}`
    : undefined;
  return (
    <div
      className={`model-remote ${mini ? "model-mini" : "model-full"} ${image ? "has-artwork" : ""}`}
      aria-hidden={mini || undefined}
      style={{
        aspectRatio: `${layout.width}/${layout.height}`,
        width: mini
          ? Math.min(66, (170 * layout.width) / layout.height)
          : undefined,
        transform: mini ? `rotate(${layout.angle ?? -9}deg)` : undefined,
      }}
    >
      {image && (
        <img className="model-artwork" src={image} alt="" draggable={false} />
      )}
      {(!mini || !generated) &&
        buttons.map((b) => {
          const definition = resource.keys.find((k) => k.id === b.key)!;
          const props = {
            className: `model-button ${b.key === 2 ? "voice" : ""}`,
            style: {
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: `${b.width}%`,
              height: `${b.height}%`,
              borderRadius: `${b.radius}%`,
              background: b.fill,
              color: b.color,
              borderColor: b.border,
              fontSize: mini
                ? Math.min(
                    6,
                    (Math.min(66, (170 * layout.width) / layout.height) *
                      b.width) /
                      100 /
                      (Math.max(
                        1,
                        [...(b.symbol || labels[b.key] || definition.label)]
                          .length,
                      ) *
                        1.2),
                  )
                : undefined,
            },
          };
          const renamed = definition.label !== labels[b.key];
          const symbol = renamed ? (
            <span>{definition.label}</span>
          ) : b.symbol ? (
            <span>{b.symbol}</span>
          ) : b.key === 11 ? (
            <span>TV</span>
          ) : b.key === 12 ? (
            <span>+</span>
          ) : b.key === 13 ? (
            <span>−</span>
          ) : (
            <KeyIcon id={b.key} />
          );
          return mini ? (
            <span key={b.key} {...props}>
              {symbol}
            </span>
          ) : (
            <button
              key={b.key}
              {...props}
              aria-label={definition.label}
              disabled={keys && !keys.includes(b.key)}
              onClick={() => onKey?.(b.key)}
            >
              {symbol}
            </button>
          );
        })}
    </div>
  );
}
function MiniRemote({ model, keys }: { model: string; keys?: number[] }) {
  return <ModelRemote model={model} keys={keys} mini />;
}
function KeyRow({
  entry,
  description,
  onClick,
}: {
  entry: KeyEntry;
  description: string;
  onClick: () => void;
}) {
  return (
    <button className="key" onClick={onClick}>
      <span className="key-symbol">
        <KeyIcon id={entry.catalog.key} />
      </span>
      <span>
        {remoteModels
          .get(entry.catalog.model)
          ?.keys.find((k) => k.id === entry.catalog.key)?.label ??
          labels[entry.catalog.key] ??
          entry.catalog.name}
      </span>
      <span className="function">{description}</span>
      <ChevronRight size={14} />
    </button>
  );
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLElement>("button:not(:disabled),input,select")
      ?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="shade"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
        if (e.key === "Tab") {
          const els = Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]",
            ) ?? [],
          );
          if (e.shiftKey && document.activeElement === els[0]) {
            e.preventDefault();
            els.at(-1)?.focus();
          } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
            e.preventDefault();
            els[0]?.focus();
          }
        }
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function PairDialog({
  service,
  close,
  done,
  expectedPeer,
}: {
  service: BuddyService;
  close: () => void;
  done: () => void;
  expectedPeer?: number;
}) {
  const [items, setItems] = useState<Candidate[]>([]),
    [choice, setChoice] = useState<number>(),
    [modelId, setModelId] = useState(""),
    [scanning, setScanning] = useState(true),
    [pairing, setPairing] = useState(false),
    [error, setError] = useState(""),
    [round, setRound] = useState(0),
    op = useRef(0),
    cancelled = useRef(false),
    discovery = useRef<Discovery | null>(null);
  useEffect(() => {
    let active = true;
    const previous = discovery.current;
    const current = new Discovery(service);
    discovery.current = current;
    cancelled.current = false;
    void (async () => {
      try {
        await previous?.stop().catch(() => {});
        if (!active) return;
        setScanning(true);
        await current.start((found) => {
          if (!active) return;
          setItems(found);
          setChoice((id) =>
            found.some((c) => c.candidate_id === id) ? id : undefined,
          );
        });
      } catch (e) {
        if (active) setError(service.report(e));
      } finally {
        if (active) setScanning(false);
      }
    })();
    return () => {
      active = false;
      void current.stop().catch((e) => service.report(e));
    };
  }, [round]);
  const cancel = async () => {
    try {
      if (pairing) {
        if (!op.current) {
          cancelled.current = true;
          return;
        }
        cancelled.current = true;
        await service.cancel(op.current);
      } else {
        await discovery.current?.stop();
        close();
      }
    } catch (e) {
      setError(service.report(e));
    }
  };
  return (
    <Dialog
      title={expectedPeer ? "重新配对" : "添加遥控器"}
      close={() => void cancel()}
    >
      <p className="muted">请将遥控器靠近接收器，并设为配对模式。</p>
      <div className="scan-status" role="status">
        {scanning || pairing ? <Spinner /> : null}
        {pairing
          ? "正在配对…"
          : scanning
            ? "搜索中…"
            : items.length
              ? "搜索完成"
              : "未发现遥控器"}
      </div>
      <label className="field">型号
        <select value={modelId} disabled={pairing} onChange={e=>setModelId(e.target.value)}>
          <option value="">自动识别</option>
          {[...remoteModels.values()].map(m=><option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </label>
      {items.map((c) => (
        <button
          className={`candidate ${choice === c.candidate_id ? "selected" : ""}`}
          key={`${c.scan_epoch}:${c.candidate_id}`}
          disabled={pairing}
          onClick={() => setChoice(c.candidate_id)}
          aria-pressed={choice === c.candidate_id}
        >
          <span>
            {c.name || "已配对的遥控器"}
            {isBoundCandidate(c) ? " · 已添加" : ""}
          </span>
          <span className="muted">
            {c.rssi > -65 ? "信号良好" : "信号较弱"}
          </span>
        </button>
      ))}
      {error && <Feedback error>{error}</Feedback>}
      <footer>
        <button onClick={() => void cancel()}>取消</button>
        {
          <button
            disabled={scanning || pairing}
            onClick={() => {
              setError("");
              setRound((n) => n + 1);
            }}
          >
            重新搜索
          </button>
        }
        <button
          className="primary"
          disabled={pairing || !items.some((c) => c.candidate_id === choice)}
          onClick={() => {
            const c = items.find((c) => c.candidate_id === choice);
            if (!c) return;
            setPairing(true);
            setError("");
            void (async () => {
              await discovery.current?.stop();
              if (cancelled.current) {
                close();
                return;
              }
              await service.pair(
                c,
                (id) => {
                  op.current = id;
                  if (cancelled.current)
                    void service
                      .cancel(id)
                      .catch((e) => setError(service.report(e)));
                },
                expectedPeer,
                modelId || undefined,
              );
              done();
            })()
              .catch((e) => {
                if (cancelled.current) close();
                else {
                  setError(service.report(e));
                  setRound((n) => n + 1);
                }
              })
              .finally(() => {
                op.current = 0;
                setPairing(false);
              });
          }}
        >
          {expectedPeer ? "配对" : "添加"}
        </button>
      </footer>
    </Dialog>
  );
}
function Editor({
  entry,
  disabled,
  close,
  save,
  forceDirty = false,
  allowActions = true,
  initialAction,
}: {
  initialAction?: Action;
  forceDirty?: boolean;
  allowActions?: boolean;
  entry: KeyEntry;
  disabled: boolean;
  close: () => void;
  save: (m: Mapping, a?: Action) => Promise<void>;
}) {
  const [map, setMap] = useState({ ...entry.map }),
    [type, setType] = useState(
      entry.map.kind === 4
        ? initialAction?.kind === "input"
          ? `input:${initialAction.profile}`
          : initialAction?.kind === "command"
            ? `command:${initialAction.target}`
            : (initialAction?.kind ?? "input:chatgpt")
        : String(entry.map.kind),
    ),
    [action, setAction] = useState<Action>(
      initialAction ?? {
        kind: "input",
        target: "",
        profile: "chatgpt",
        label: "",
      },
    ),
    [desktop, setDesktop] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [profile, setProfile] = useState(
      entry.map.kind === 5
        ? entry.map.value === 1
          ? "doubao"
          : "wechat"
        : entry.map.kind === 3 &&
            entry.map.modifiers === 0 &&
            entry.map.value === 44
          ? "meeting"
          : "custom",
    );
  const voice = entry.catalog.key === 2,
    dirty =
      forceDirty ||
      JSON.stringify(map) !== JSON.stringify(entry.map) ||
      (map.kind === 4 &&
        JSON.stringify(action) !== JSON.stringify(initialAction));
  useEffect(() => {
    void call<boolean>("desktop_available")
      .then(setDesktop)
      .catch(() => setDesktop(false));
  }, []);
  useEffect(() => {
    setMap({ ...entry.map });
  }, [
    entry.map.revision,
    entry.map.value,
    entry.map.kind,
    entry.map.modifiers,
  ]);
  const requestClose = () => {
    if (saving) return;
    close();
  };
  const keyboard = (
    <>
      <label className="field">
        按键
        <select
          value={map.value}
          onChange={(e) => setMap({ ...map, value: Number(e.target.value) })}
        >
          {!usages.some(([n]) => n === map.value) && (
            <option value={map.value}>键码 {map.value}</option>
          )}
          {usages.map(([n, l]) => (
            <option key={n} value={n}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <div className="modifiers">
        {modifiers.map((l, i) => (
          <label key={i}>
            <input
              type="checkbox"
              checked={!!(map.modifiers & (1 << i))}
              onChange={(e) =>
                setMap({
                  ...map,
                  modifiers: e.target.checked
                    ? map.modifiers | (1 << i)
                    : map.modifiers & ~(1 << i),
                })
              }
            />
            {l}
          </label>
        ))}
      </div>
    </>
  );
  return (
    <Dialog
      title={
        voice
          ? "语音输入"
          : (remoteModels
              .get(entry.catalog.model)
              ?.keys.find((k) => k.id === entry.catalog.key)?.label ??
            labels[entry.catalog.key] ??
            entry.catalog.name)
      }
      close={requestClose}
    >
      <fieldset
        disabled={saving}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {voice ? (
          <>
            <label className="field">
              语音输入
              <select
                value={profile}
                onChange={(e) => {
                  setProfile(e.target.value);
                  const preset =
                    voicePresets[e.target.value as keyof typeof voicePresets];
                  if (e.target.value === "meeting")
                    setMap({ ...map, kind: 3, ...voicePresets.meeting });
                  else if (preset)
                    setMap({
                      ...map,
                      kind: 5,
                      modifiers: 0,
                      value: e.target.value === "doubao" ? 1 : 2,
                    });
                  else if (map.kind === 5)
                    setMap({
                      ...map,
                      kind: 3,
                      ...(map.value === 2
                        ? voicePresets.wechat
                        : voicePresets.doubao),
                    });
                }}
              >
                <option value="doubao">豆包输入法</option>
                <option value="custom">自定义</option>
                <option value="wechat">微信输入法</option>
                <option value="meeting">视频会议</option>
              </select>
            </label>
            <p className="muted">按住说话，松开结束。</p>
            {profile === "custom" ? (
              keyboard
            ) : profile === "meeting" ? (
              <p className="muted">长按空格开麦</p>
            ) : (
              <p className="muted">默认快捷键 · 随系统调整</p>
            )}
          </>
        ) : (
          <>
            <label className="field">
              功能
              <select
                aria-label="功能"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  if (e.target.value === "default")
                    setMap({
                      ...entry.map,
                      kind: entry.catalog.kind,
                      modifiers: entry.catalog.modifiers,
                      value: entry.catalog.value,
                    });
                  else if (e.target.value.startsWith("input:")) {
                    const p = inputProfiles.find(
                      (p) => p.id === e.target.value.slice(6),
                    )!;
                    setMap({ ...map, kind: 4, modifiers: 0, value: 0 });
                    setAction({
                      kind: "input",
                      profile: p.id,
                      target: "",
                      label: `切换到 ${p.label}`,
                    });
                  } else if (e.target.value.startsWith("command:")) {
                    const c = commands.find(
                      (c) => c.id === e.target.value.slice(8),
                    )!;
                    setMap({ ...map, kind: 4, modifiers: 0, value: 0 });
                    setAction({
                      kind: "command",
                      target: c.id,
                      label: c.label,
                    });
                  } else if (["app", "web"].includes(e.target.value)) {
                    setMap({ ...map, kind: 4, modifiers: 0, value: 0 });
                    setAction({
                      kind: e.target.value as Action["kind"],
                      target: "",
                      label: "",
                    });
                  } else
                    setMap({
                      ...map,
                      kind: Number(e.target.value),
                      modifiers: 0,
                      value: Number(e.target.value) === 1 ? 40 : 0,
                    });
                }}
              >
                <option value="default">原来的功能</option>
                {allowActions && (
                  <>
                    <optgroup label="应用">
                      {inputProfiles.map((p) => (
                        <option
                          key={p.id}
                          value={`input:${p.id}`}
                          disabled={!desktop}
                        >
                          切换到 {p.label}
                        </option>
                      ))}
                      <option value="app">其他应用…</option>
                      <option value="web">打开网页</option>
                    </optgroup>
                    <optgroup label="窗口与桌面">
                      {commands.map((c) => (
                        <option
                          key={c.id}
                          value={`command:${c.id}`}
                          disabled={!desktop}
                        >
                          {c.label}
                        </option>
                      ))}
                    </optgroup>
                  </>
                )}
                <optgroup label="按键">
                  <option value="1">快捷键</option>
                  <option value="2">音量与媒体</option>
                </optgroup>
                <option value="0">不使用</option>
              </select>
            </label>
            {map.kind === 1 && keyboard}
            {map.kind === 2 && (
              <label className="field">
                媒体功能
                <select
                  value={map.value}
                  onChange={(e) =>
                    setMap({ ...map, value: Number(e.target.value) })
                  }
                >
                  {media.map((n, i) => (
                    <option key={i} value={i}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {map.kind === 4 && (
              <ActionFields
                action={action}
                change={setAction}
                disabled={saving}
              />
            )}
          </>
        )}
      </fieldset>
      <footer className="editor-footer">
        <div className="editor-status">
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : disabled ? (
            <p className="muted" role="status">
              连接可用且录音结束后可保存
            </p>
          ) : saving ? (
            <span role="status">保存中…</span>
          ) : null}
        </div>
        <button
          className="primary editor-save"
          disabled={
            disabled ||
            saving ||
            !dirty ||
            (map.kind === 4 && !validAction(action)) ||
            (map.kind === 1 && !map.value && !map.modifiers)
          }
          onClick={() => {
            setSaving(true);
            setError("");
            void save(map, map.kind === 4 ? action : undefined)
              .catch((e) => setError(service.report(e)))
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "保存中…" : "确认保存"}
        </button>
        <button disabled={saving} onClick={requestClose}>
          取消
        </button>
      </footer>
    </Dialog>
  );
}
function SharedDialog({
  service,
  close,
}: {
  service: BuddyService;
  close: () => void;
}) {
  const [key, setKey] = useState(9),
    [targets, setTargets] = useState<number[]>([]),
    [entry, setEntry] = useState<KeyEntry>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const slots = service.snapshot.slots.filter((s) => s.peer_id);
  const changeKey = (key: number) => {
    setKey(key);
    setTargets(
      slots
        .filter((s) =>
          service.boardConfig().followers[s.peer_id]?.includes(key),
        )
        .map((s) => s.peer_id),
    );
  };
  if (entry)
    return (
      <Editor
        entry={entry}
        forceDirty
        allowActions={false}
        disabled={busy || service.snapshot.info?.voice_owner !== 255}
        close={() => setEntry(undefined)}
        save={async (m) => {
          setBusy(true);
          try {
            await service.saveShared(m, targets);
            close();
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  return (
    <Dialog title="统一按键设置" close={() => !busy && close()}>
      <label className="field">
        按键
        <select value={key} onChange={(e) => changeKey(Number(e.target.value))}>
          {Object.entries(labels).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">只更新勾选的遥控器，其余设置保持不变。</p>
      {slots.map((s) => (
        <label className="setting" key={s.peer_id}>
          <span>{service.name(s)}</span>
          <input
            type="checkbox"
            checked={targets.includes(s.peer_id)}
            onChange={(e) =>
              setTargets(
                e.target.checked
                  ? [...targets, s.peer_id]
                  : targets.filter((id) => id !== s.peer_id),
              )
            }
          />
        </label>
      ))}
      {error && <Feedback error>{error}</Feedback>}
      <footer>
        <button disabled={busy} onClick={close}>
          取消
        </button>
        <button
          className="primary"
          disabled={busy || !targets.length}
          onClick={() => {
            setBusy(true);
            void (async () => {
              try {
                const s = slots.find((s) => s.peer_id === targets[0])!;
                const keys = await service.keys(s);
                const e = keys.find((e) => e.catalog.key === key);
                if (!e) throw Error("所选遥控器不支持这个按键");
                const shared = service.boardConfig().shared[key];
                setEntry({
                  ...e,
                  map: shared
                    ? { ...shared, revision: e.map.revision }
                    : e.map.kind === 4
                      ? {
                          key: e.catalog.key,
                          kind: e.catalog.kind,
                          modifiers: e.catalog.modifiers,
                          value: e.catalog.value,
                          revision: e.map.revision,
                        }
                      : e.map,
                });
              } catch (e) {
                setError(service.report(e));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy ? <Spinner /> : "设置功能"}
        </button>
      </footer>
    </Dialog>
  );
}
function BackupDialog({
  service,
  close,
}: {
  service: BuddyService;
  close: () => void;
}) {
  const [value, setValue] = useState<Settings>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(service.report(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="备份与恢复" close={() => !busy && close()}>
      {value ? (
        <>
          <p>
            替换本机配置？包含 {Object.keys(value.boards).length}{" "}
            个接收器的名称与功能设置。
          </p>
          <p className="muted">
            不会更改板子上的配对或按键。导入的软件动作需重新保存对应按键后启用。
          </p>
          <footer>
            <button disabled={busy} onClick={() => setValue(undefined)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await service.importSettings(value);
                  setValue(undefined);
                  setMessage("已恢复本机配置");
                })
              }
            >
              恢复
            </button>
          </footer>
        </>
      ) : (
        <>
          <div className="setting">
            <span>导出本机配置</span>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const ok = await call<boolean>("export_config", {
                    text: JSON.stringify(await service.backup(), null, 2),
                  });
                  if (ok) setMessage("已导出");
                })
              }
            >
              导出
            </button>
          </div>
          <div className="setting">
            <span>导入配置</span>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const text = await call<string | null>("import_config");
                  if (text) setValue(validateSettings(JSON.parse(text)));
                })
              }
            >
              选择文件
            </button>
          </div>
          <footer>
            <button disabled={busy} onClick={close}>
              完成
            </button>
          </footer>
        </>
      )}
      {error && <Feedback error>{error}</Feedback>}
      {message && <Feedback>{message}</Feedback>}
    </Dialog>
  );
}
createRoot(document.getElementById("root")!).render(
  location.search === "?picker" ? <WindowPicker /> : <App />,
);
