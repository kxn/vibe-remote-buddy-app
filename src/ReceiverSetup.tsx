import { Feedback } from "./Feedback";
import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { call } from "./native";
import type { BuddyService } from "./core/service";
import type { Port } from "./core/types";

export interface SetupCandidate {
  path: string;
  name: string;
  serial: string;
  vid: number;
  pid: number;
}
interface Device {
  chip: string;
  variant: string;
  target: string;
  flash_bytes: number;
  mac: string;
  version: string;
  psram_known: boolean;
  description: string;
}
interface Status {
  phase: string;
  info?: Device;
  error: string;
  logs: string[];
}
type Step =
  | "loading"
  | "find"
  | "boot"
  | "checking"
  | "confirm"
  | "writing"
  | "waiting"
  | "done"
  | "error"
  | "blocked";
const normalize = (s: string) => s.replace(/[^a-f0-9]/gi, "").toUpperCase();
export function sameReceiver(serial: string, mac: string) {
  return normalize(serial) === normalize(mac) && normalize(mac).length === 12;
}

export function ReceiverSetup({
  service,
  done,
}: {
  service: BuddyService;
  done: (add: boolean) => void;
}) {
  const [step, setStep] = useState<Step>("loading"),
    [candidates, setCandidates] = useState<SetupCandidate[]>([]);
  const [selected, setSelected] = useState<SetupCandidate>(),
    [device, setDevice] = useState<Device>();
  const [consent, setConsent] = useState(false),
    [boardConfirmed, setBoardConfirmed] = useState(false);
  const [error, setError] = useState(""),
    [logs, setLogs] = useState<string[]>([]),
    [phase, setPhase] = useState("");
  const [variant, setVariant] = useState("");
  const [closing, setClosing] = useState(false);
  const busy = ["loading", "checking", "writing"].includes(step) || closing;
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true),
    polling = useRef(false);
  const disconnected = useRef(false),
    waitingSince = useRef(0),
    attempted = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void (async () => {
      try {
        await service.stop();
        const pkg = await call<{ version: string } | null>("setup_package");
        if (!alive.current) return;
        if (!pkg) {
          setError("当前应用没有完整安装包。请使用附带固件的版本。");
          setStep("blocked");
          return;
        }
        setStep("find");
      } catch (e) {
        if (alive.current) {
          setError(String(e));
          setStep("blocked");
        }
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [service]);
  async function check(candidate: SetupCandidate) {
    if (polling.current) return;
    polling.current = true;
    setSelected(candidate);
    setConsent(false);
    setBoardConfirmed(false);
    setVariant("");
    setError("");
    setLogs([]);
    setStep("checking");
    try {
      await call("setup_check", { candidate });
    } catch (e) {
      setError(String(e));
      setStep("boot");
    } finally {
      polling.current = false;
    }
  }
  useEffect(() => {
    let cancel = false,
      running = false;
    async function tick() {
      if (running || polling.current) return;
      running = true;
      try {
        if (step === "find" || step === "boot") {
          const found = await call<SetupCandidate[]>("setup_candidates");
          if (cancel) return;
          setCandidates(found);
          if (step === "boot" && selected) {
            const matching = found.filter(
              (p) => p.serial && p.serial === selected.serial,
            );
            if (!found.some((p) => p.path === selected.path))
              disconnected.current = true;
            if (disconnected.current && matching.length === 1) {
              const key = JSON.stringify(matching[0]);
              if (!attempted.current.has(key)) {
                attempted.current.add(key);
                await check(matching[0]);
              }
            }
          }
          if (
            selected &&
            !found.some(
              (p) => JSON.stringify(p) === JSON.stringify(selected),
            ) &&
            step === "find"
          )
            setSelected(undefined);
        } else if (step === "checking" || step === "writing") {
          const status = await call<Status>("setup_status");
          if (cancel) return;
          setPhase(status.phase);
          setLogs(status.logs);
          if (status.info) {
            setDevice(status.info);
            if (status.info.variant) setVariant(status.info.variant);
          }
          if (status.phase === "checked") {
            setStep("confirm");
          } else if (status.phase === "written") {
            waitingSince.current = Date.now();
            setStep("waiting");
          } else if (status.phase === "error") {
            setError(status.error);
            disconnected.current = false;
            attempted.current.clear();
            setStep(
              step === "writing"
                ? "error"
                : /不支持|要求|安全保护|安装包|镜像|版本|分区/.test(
                      status.error,
                    )
                  ? "blocked"
                  : "boot",
            );
          }
        } else if (step === "waiting" && device) {
          const ports = await call<Port[]>("ports");
          if (cancel) return;
          const port = ports.find((p) => sameReceiver(p.serial, device.mac));
          if (port) {
            const before = service.getSnapshot();
            if (before.status !== "connected") await service.connect(port);
            else await service.refresh();
            const snap = service.getSnapshot();
            if (
              snap.status === "connected" &&
              snap.board &&
              sameReceiver(snap.board.serial, device.mac)
            ) {
              const info = snap.info;
              if (
                info?.confirmed &&
                info.firmware === `buddy-${device.version}` &&
                info.target === device.target &&
                [8388608, 16777216].includes(info.flash_bytes ?? 0) &&
                (info.psram_bytes ?? 0) >=
                  (device.variant === "q2" ? 2097152 : 8388608)
              ) {
                if (!cancel) setStep("done");
              } else if (Date.now() - waitingSince.current > 45000) {
                setError("设备已连接，但版本或硬件状态未通过检查。");
              }
            }
          }
        }
      } catch (e) {
        if (!cancel) setError(String(e));
      } finally {
        running = false;
      }
    }
    void tick();
    const timer = setInterval(() => void tick(), 800);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [step, selected, device, service]);
  async function close(add = false) {
    if (busy) return;
    setClosing(true);
    try {
      await call("setup_release");
      await service.start();
      done(add);
    } catch (e) {
      setError(`${String(e)}。可按 RESET 恢复设备。`);
    } finally {
      setClosing(false);
    }
  }
  async function back() {
    setClosing(true);
    try {
      await call("setup_release");
      setConsent(false);
      setDevice(undefined);
      setSelected(undefined);
      setStep("find");
    } catch (e) {
      setError(String(e));
    } finally {
      setClosing(false);
    }
  }
  async function install() {
    if (
      !variant ||
      !consent ||
      !device ||
      (!device.psram_known && !boardConfirmed)
    )
      return;
    polling.current = true;
    setError("");
    setStep("writing");
    try {
      await call("setup_install", {
        confirmed: consent,
        boardConfirmed,
        variant,
      });
    } catch (e) {
      setError(String(e));
      setConsent(false);
      setStep("error");
    } finally {
      polling.current = false;
    }
  }
  const shown =
    selected ?? (candidates.length === 1 ? candidates[0] : undefined);
  const stepNo = ["done", "waiting"].includes(step)
    ? 2
    : ["confirm", "writing", "error"].includes(step)
      ? 1
      : 0;
  function card() {
    return (
      <div className="setup-device">
        <strong>
          {device?.chip ?? shown?.name ?? "USB 开发板"} · {shown?.path}
        </strong>
        <small>标识 {device?.mac ?? shown?.serial ?? "未知"}</small>
      </div>
    );
  }
  return (
    <dialog
      ref={dialog}
      className="receiver-setup"
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
    >
      <header>
        <strong>初始化接收器</strong>
        <button
          className="icon quiet"
          aria-label="关闭"
          disabled={busy}
          onClick={() => void close()}
        >
          <X size={18} />
        </button>
      </header>
      <div className="setup-body">
        <nav className="setup-steps">
          {["连接开发板", "安装", "完成"].map((s, i) => (
            <span key={s} className={stepNo === i ? "active" : ""}>
              {i + 1} {s}
            </span>
          ))}
        </nav>
        {step === "loading" && (
          <p>
            <LoaderCircle className="spin" size={16} /> 正在准备…
          </p>
        )}
        {step === "find" && (
          <>
            <h2>
              {candidates.length === 0
                ? "连接开发板"
                : candidates.length === 1
                  ? "发现一块开发板"
                  : "选择你的开发板"}
            </h2>
            {candidates.length === 0 ? (
              <>
                <p>用 USB 数据线连接电脑。</p>
                <p className="muted">
                  <LoaderCircle className="spin" size={16} /> 等待设备连接
                </p>
              </>
            ) : candidates.length === 1 ? (
              card()
            ) : (
              <>
                <p className="muted">不确定时，拔下再插回你的开发板。</p>
                {candidates.map((c) => (
                  <label className="setup-device" key={c.path}>
                    <input
                      type="radio"
                      name="setup-device"
                      checked={selected?.path === c.path}
                      onChange={() => setSelected(c)}
                    />
                    <span>
                      {c.name} · {c.path}
                      <small>标识 {c.serial || "未知"}</small>
                    </span>
                  </label>
                ))}
              </>
            )}
            {!!candidates.length && (
              <p className="muted">连接会重启这块开发板，不清除数据。</p>
            )}
            <button
              className="quiet"
              onClick={() => {
                disconnected.current = false;
                setSelected(undefined);
                setStep("boot");
              }}
            >
              {candidates.length ? "没有我的设备" : "仍未找到？"}
            </button>
          </>
        )}
        {step === "boot" && (
          <>
            <h2>按住 BOOT，重新插入</h2>
            <ol>
              <li>拔下开发板的 USB。</li>
              <li>按住 BOOT，重新插入 USB。</li>
              <li>松开 BOOT。</li>
            </ol>
            <p className="muted">
              <LoaderCircle className="spin" size={16} /> 等待开发板
            </p>
            <details>
              <summary>仍未找到？</summary>
              <p>
                换一根 USB 数据线，直接连接电脑；有两个 USB
                接口时尝试另一个。没有 BOOT 按钮时请查阅开发板说明。
              </p>
            </details>
            {!!candidates.length && (
              <button
                onClick={() => {
                  setSelected(undefined);
                  setError("");
                  setStep("find");
                }}
              >
                选择已连接的设备
              </button>
            )}
          </>
        )}
        {step === "checking" && (
          <>
            <h2>正在连接开发板</h2>
            {card()}
            <p>
              <LoaderCircle className="spin" size={16} /> 检查安装条件
            </p>
          </>
        )}
        {step === "confirm" && device && (
          <>
            <h2>安装接收器</h2>
            {card()}
            <details>
              <summary>设备与版本</summary>
              <p>
                {device.description}
                <br />
                {device.flash_bytes / 1048576} MB Flash · 固件 {device.version}
              </p>
            </details>
            {!device.psram_known && (
              <>
                <label>
                  板子内存规格
                  <select
                    aria-label="板子内存规格"
                    value={variant}
                    onChange={(e) => {
                      setVariant(e.target.value);
                      setBoardConfirmed(false);
                    }}
                  >
                    <option value="">请选择</option>
                    <option value="q2">2 MB Quad PSRAM</option>
                    <option value="o8">8 MB Octal PSRAM</option>
                  </select>
                </label>
                <label className="setup-consent">
                  <input
                    type="checkbox"
                    checked={boardConfirmed}
                    onChange={(e) => setBoardConfirmed(e.target.checked)}
                  />
                  <span>
                    已核对板子标注与所选内存规格一致
                    <small>无法自动识别外置内存，请核对型号或商品规格。</small>
                  </span>
                </label>
              </>
            )}
            <div className="setup-warning">
              <strong>将清除这块开发板的全部内容。</strong>
              <p>原程序、设置及配对信息会丢失。不备份，无法撤销。</p>
            </div>
            <label className="setup-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              确认清除以上设备并安装
            </label>
          </>
        )}
        {step === "writing" && (
          <>
            <h2>正在安装</h2>
            {card()}
            <p role="status">
              <LoaderCircle className="spin" size={16} />{" "}
              {{
                connecting: "核对设备",
                writing: "清除并写入",
                verifying: "校验安装",
                restarting: "重启开发板",
              }[phase] ?? "准备安装"}
            </p>
            <p className="muted">请勿拔出设备或退出应用。</p>
          </>
        )}
        {step === "waiting" && (
          <>
            <h2>安装已写入，尚未连接</h2>
            <p>松开 BOOT，重新插入 USB。</p>
            <p className="muted">
              <LoaderCircle className="spin" size={16} /> 等待接收器
            </p>
            <details>
              <summary>仍未连接？</summary>
              <p>双 USB 接口的开发板，请连接原生 USB 接口。</p>
            </details>
          </>
        )}
        {step === "done" && <h2>接收器已就绪</h2>}
        {step === "blocked" && <h2>暂时无法安装</h2>}
        {step === "error" && (
          <>
            <h2>安装未完成</h2>
            <p>原程序可能已被清除。请重新连接这块开发板。</p>
          </>
        )}
        {error && (
          <Feedback error within={dialog.current}>
            {error}
          </Feedback>
        )}
        {!!logs.length && (
          <details>
            <summary>操作详情</summary>
            <pre>{logs.join("\n")}</pre>
          </details>
        )}
      </div>
      <footer>
        {busy ? (
          <button disabled>
            <LoaderCircle className="spin" size={16} /> 处理中…
          </button>
        ) : (
          <>
            <button onClick={() => void close()}>
              {step === "done"
                ? "完成"
                : step === "waiting"
                  ? "稍后检查"
                  : "取消"}
            </button>
            {step === "find" && shown && (
              <button className="primary" onClick={() => void check(shown)}>
                连接这块开发板
              </button>
            )}
            {step === "confirm" && (
              <>
                <button onClick={() => void back()}>返回</button>
                <button
                  className="danger"
                  disabled={
                    !variant ||
                    !consent ||
                    (!device?.psram_known && !boardConfirmed)
                  }
                  onClick={() => void install()}
                >
                  清除并安装
                </button>
              </>
            )}
            {["error", "blocked"].includes(step) && (
              <button onClick={() => void back()}>重新选择</button>
            )}
            {step === "boot" && (
              <button onClick={() => setStep("find")}>返回</button>
            )}
            {step === "done" && (
              <button className="primary" onClick={() => void close(true)}>
                添加遥控器
              </button>
            )}
          </>
        )}
      </footer>
    </dialog>
  );
}
