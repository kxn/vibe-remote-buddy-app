import { ProbeMicrophone } from "./core/probe-microphone";
import { Feedback } from "./Feedback";
import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { BuddyService, ProbeSessionLostError } from "./core/service";
import {
  remoteModels,
  conflictingModel,
  type RemoteModel,
} from "./core/models";
import {
  ProbeClient,
  decodeProbeKey,
  makeVariant,
  familyEvidence,
  sdkError,
  probeStages,
  type ProbeCandidate,
  type ProbeAttribute,
  type ProbeReport,
  type ProbeStatus,
  type ProbeVoiceStatus,
} from "./core/probe";
import {
  copyLayoutPreset,
  verifiedModel,
  removeKey,
  type KeyProof,
} from "./core/probe-layout";
import { renderRemoteArtwork } from "./core/remote-artwork";
import { ProbeLayout } from "./ProbeLayout";
import { OP, sleep, DeviceError } from "./core/session";
import { call, native } from "./native";
type Capture = {
  key: number;
  proof?: KeyProof;
  phase: "key" | "voice";
  down?: boolean;
  listened: boolean;
};
const steps = ["发现设备", "连接与识别", "按键与布局", "完成"];
export function ProbeWorkbench({
  service,
  close,
  addRemote,
}: {
  service: BuddyService;
  close: () => void;
  addRemote: () => void;
}) {
  const client = useRef<ProbeClient | undefined>(undefined),
    alive = useRef(true),
    locked = useRef(false),
    ended = useRef(false),
    after = useRef(0),
    baseline = useRef(0),
    pending = useRef<
      { handle: number; report: number; usage: number } | undefined
    >(undefined),
    captureRef = useRef<Capture | undefined>(undefined),
    attrsRef = useRef<ProbeAttribute[]>([]),
    modelRef = useRef<RemoteModel | undefined>(undefined),
    voicePrepared = useRef(false),
    microphone = useRef(new ProbeMicrophone()),
    sessionLost = useRef(false),
    voiceProof = useRef<KeyProof | undefined>(undefined),
    preflight = useRef(false),
    audioFetching = useRef(false),
    urlRef = useRef(""),
    lastVoice = useRef<ProbeVoiceStatus | undefined>(undefined),
    localSaved = useRef(""),
    epoch = useRef(0),
    dialogRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(true),
    [progress, setProgress] = useState("正在搜索"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [candidates, setCandidates] = useState<ProbeCandidate[]>([]),
    [selected, setSelected] = useState<ProbeCandidate>(),
    [protocol, setProtocol] = useState(0),
    [status, setStatus] = useState<ProbeStatus>(),
    [attrs, setAttrs] = useState<ProbeAttribute[]>([]),
    [reports, setReports] = useState<ProbeReport[]>([]),
    [model, setModel] = useState<RemoteModel>(),
    [proofs, setProofs] = useState<Record<number, KeyProof>>({}),
    [capture, setCapture] = useState<Capture>(),
    [voice, setVoice] = useState<ProbeVoiceStatus>(),
    [audio, setAudio] = useState(""),
    [failures, setFailures] = useState<string[]>([]),
    [identified, setIdentified] = useState(false),
    [presetId, setPresetId] = useState(""),
    [replacePreset, setReplacePreset] = useState(false);
  function update(m: RemoteModel) {
    modelRef.current = m;
    setModel(m);
    setProofs((old) =>
      Object.fromEntries(
        Object.entries(old).filter(([id]) =>
          m.keys.some((k) => k.id === Number(id)),
        ),
      ),
    );
  }
  function capturing(c?: Capture) {
    captureRef.current = c;
    setCapture(c);
  }
  function clearAudio() {
    microphone.current.cancel();
    client.current?.clearAudio();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setAudio("");
    setVoice(undefined);
  }
  function fail(e: unknown) {
    microphone.current.cancel();
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof ProbeSessionLostError) {
      sessionLost.current = true;
      epoch.current++;
      microphone.current.cancel();
      capturing(undefined);
      voicePrepared.current = false;
    }
    const detail =
      e instanceof DeviceError
        ? ` [opcode=0x${e.opcode.toString(16)} status=${e.status} ${JSON.stringify(e.detail)}]`
        : "";
    if (native)
      void call("save_probe_diagnostic", {
        value: {
          time: new Date().toISOString(),
          failure: message + detail,
          model: modelRef.current,
          attributes: attrsRef.current,
          capture: captureRef.current,
          voice: lastVoice.current,
          trace: client.current?.trace,
        },
      }).catch((e) => service.report(e));
    setError(message);
    setFailures((old) => [...old, message + detail].slice(-64));
  }
  async function run(fn: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) fail(e);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nested =
        dialogRef.current?.querySelector<HTMLElement>(".probe-modal");
      const root = nested ?? dialogRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),audio,summary",
        ),
      ).filter((e) => e.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (!first) return;
      if (
        !root.contains(document.activeElement) ||
        document.activeElement === root ||
        (e.shiftKey && document.activeElement === first) ||
        (!e.shiftKey && document.activeElement === last)
      ) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    alive.current = true;
    dialogRef.current?.focus();
    let started: ProbeClient | undefined;
    void (async () => {
      try {
        started = new ProbeClient(
          await service.beginProbe((body) =>
            client.current?.receiveAudio(body),
          ),
        );
        client.current = started;
        if (!alive.current) {
          await started.end();
          service.releaseProbe();
          return;
        }
        setBusy(false);
        while (alive.current && !sessionLost.current) {
          try {
            if (!locked.current) {
              const pollEpoch = epoch.current;
              const s = await started.status();
              if (!alive.current) break;
              if (locked.current || pollEpoch !== epoch.current) {
                await sleep(80);
                continue;
              }
              setStatus(s);
              if (!s.connected && captureRef.current) {
                capturing(undefined);
                clearAudio();
                voicePrepared.current = false;
                setError("连接已断开，请返回连接步骤重试");
              }
              if (s.active && !s.connected && !s.pending) {
                const list = await started.candidates(
                  () =>
                    !alive.current ||
                    locked.current ||
                    pollEpoch !== epoch.current,
                );
                if (
                  alive.current &&
                  !locked.current &&
                  pollEpoch === epoch.current
                )
                  setCandidates(list);
              }
              if (s.active && s.connected) {
                const batch =
                  captureRef.current?.phase === "voice"
                    ? []
                    : await started.reports(after.current);
                if (!alive.current) break;
                if (pollEpoch !== epoch.current) continue;
                for (const r of batch) {
                  after.current = Math.max(after.current, r.sequence);
                  const c = captureRef.current;
                  if (
                    locked.current ||
                    !c ||
                    c.phase !== "key" ||
                    r.sequence <= baseline.current
                  )
                    continue;
                  if (r.lost) {
                    pending.current = undefined;
                    capturing({ ...c, proof: undefined, down: false });
                    baseline.current = r.sequence;
                    setError("按键报告有遗漏，请重新按下并松开");
                    continue;
                  }
                  const d = decodeProbeKey(
                    r,
                    attrsRef.current,
                    c.key,
                    modelRef.current?.family ?? 0,
                  );
                  if (!d) continue;
                  if (d.usages.length === 1) {
                    if (
                      pending.current &&
                      (pending.current.handle !== r.handle ||
                        pending.current.report !== d.report ||
                        pending.current.usage !== d.usages[0])
                    ) {
                      pending.current = undefined;
                      capturing({ ...c, proof: undefined, down: false });
                      setError("请单独按下一个按键");
                      continue;
                    }
                    capturing({ ...c, proof: undefined, down: true });
                    setError("");
                    pending.current = {
                      handle: r.handle,
                      report: d.report,
                      usage: d.usages[0],
                    };
                  } else if (
                    !d.usages.length &&
                    pending.current?.handle === r.handle
                  ) {
                    const p = pending.current;
                    pending.current = undefined;
                    capturing({
                      ...c,
                      proof: { report: p.report, usage: p.usage },
                      down: false,
                    });
                    setError("");
                  } else if (d.usages.length > 1) {
                    pending.current = undefined;
                    capturing({ ...c, proof: undefined, down: false });
                    setError("请单独按下一个按键");
                  }
                }
                if (batch.length)
                  setReports((old) => [...old, ...batch].slice(-256));
                if (captureRef.current?.phase === "voice" && !locked.current) {
                  const voiceEpoch = epoch.current;
                  const v = await started.command<ProbeVoiceStatus>(
                    OP.PROBE_VOICE_STATUS,
                  );
                  if (
                    !alive.current ||
                    locked.current ||
                    voiceEpoch !== epoch.current ||
                    captureRef.current?.phase !== "voice"
                  )
                    continue;
                  const previousVoice = lastVoice.current;
                  if (microphone.current.error && !v.error) {
                    v.error = microphone.current.error;
                    if (previousVoice?.error !== v.error)
                      await started.cancelVoice();
                  }
                  if (
                    v.released &&
                    v.trigger_usage &&
                    v.trigger_report !== undefined &&
                    captureRef.current
                  )
                    capturing({
                      ...captureRef.current,
                      proof: {
                        report: v.trigger_report,
                        usage: v.trigger_usage,
                      },
                    });
                  lastVoice.current = v;
                  setVoice(v);
                  if (
                    (v.error || v.decode_error) &&
                    (v.error !== previousVoice?.error ||
                      v.decode_error !== previousVoice?.decode_error ||
                      v.sdk_error !== previousVoice?.sdk_error)
                  ) {
                    await started.voiceDiagnostics(
                      () =>
                        !alive.current ||
                        locked.current ||
                        voiceEpoch !== epoch.current,
                    );
                    if (
                      !alive.current ||
                      locked.current ||
                      voiceEpoch !== epoch.current
                    )
                      continue;
                    fail(
                      `${voiceError(v.error || "audio decode failed")}${v.adapter_error ? " · " + v.adapter_error : ""}${v.sdk_error ? " · " + sdkError(v.sdk_error) : ""}${v.decode_error ? " · 解码错误 " + v.decode_error : ""}`,
                    );
                  }
                  if (
                    !v.armed &&
                    !v.recording &&
                    v.released &&
                    v.samples &&
                    !v.pending_samples &&
                    !v.error &&
                    !v.decode_error &&
                    !urlRef.current &&
                    !audioFetching.current
                  ) {
                    audioFetching.current = true;
                    const generation = epoch.current;
                    void run(async () => {
                      setProgress("完成录音");
                      try {
                        // UAC tail has drained on board. Allow the host audio buffer to arrive.
                        await sleep(200);
                        const wav = await microphone.current.finish();
                        if (!alive.current || epoch.current !== generation)
                          return;
                        urlRef.current = URL.createObjectURL(wav);
                        setAudio(urlRef.current);
                      } catch (e) {
                        setVoice((old) =>
                          old
                            ? { ...old, error: "读取录音失败，请重新录音" }
                            : old,
                        );
                        throw e;
                      }
                    });
                  }
                }
              }
            }
          } catch (e) {
            if (alive.current && !locked.current) fail(e);
          }
          await sleep(150);
        }
      } catch (e) {
        if (alive.current) {
          fail(e);
          setBusy(false);
        }
      }
    })();
    return () => {
      alive.current = false;
      epoch.current++;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      microphone.current.cancel();
      if (started && !ended.current && !sessionLost.current) {
        ended.current = true;
        void started
          .end()
          .catch((e) => service.report(e))
          .finally(() => service.releaseProbe());
      }
    };
  }, [service]);
  async function finish() {
    await run(async () => {
      epoch.current++;
      if (!ended.current && !sessionLost.current) await client.current?.end();
      ended.current = true;
      service.releaseProbe();
      close();
    });
  }
  async function backToScan() {
    await run(async () => {
      epoch.current++;
      await client.current!.end();
      await client.current!.command(OP.PROBE_BEGIN);
      client.current!.resetCandidates();
      voicePrepared.current = false;
      ended.current = false;
      epoch.current++;
      attrsRef.current = [];
      modelRef.current = undefined;
      setModel(undefined);
      setAttrs([]);
      setReports([]);
      setProofs({});
      setCandidates([]);
      setSelected(undefined);
      setIdentified(false);
      setStatus(undefined);
      setFailures([]);
      after.current = 0;
      capturing(undefined);
      clearAudio();
      setNotice("");
      localSaved.current = "";
      setStep(0);
    });
  }
  async function connect() {
    if (!selected) return;
    await run(async () => {
      const c = client.current!;
      const connectEpoch = ++epoch.current;
      setNotice("");
      setIdentified(false);
      const fresh = await c.connectSelected(
        selected,
        setProgress,
        () => !alive.current || epoch.current !== connectEpoch,
      );
      setSelected(fresh);
      setProgress("配对并加密");
      await c.security();
      setProgress("读取服务与设备信息");
      const a = await c.identity(await c.discover());
      attrsRef.current = a;
      setAttrs(a);
      let s = await c.status();
      setStatus(s);
      const family = familyEvidence(a);
      if (!family) throw Error("未识别出受支持的语音协议，请保存诊断");
      if (protocol && family !== protocol)
        throw Error("设备协议特征与所选协议不一致");
      setProgress("订阅按键通道");
      await c.subscribe(a);
      s = await c.status();
      setStatus(s);
      if (!s.connected) throw Error("连接已断开，请重新连接");
      setIdentified(true);
      beginLayout(a, fresh);
      setStep(1);
      preflight.current = true;
      voiceProof.current = undefined;
      baseline.current = after.current = s.sequence;
      pending.current = undefined;
      capturing({ key: 2, phase: "voice", listened: false });
      await prepareVoice();
    });
  }
  function beginLayout(attributes: ProbeAttribute[], candidate = selected) {
    try {
      const family = familyEvidence(attributes);
      if (!family || (protocol && protocol !== family))
        throw Error("请先完成连接与协议识别");
      const base = [...remoteModels.values()].find((m) => m.family === family);
      if (!base || !candidate) throw Error("缺少协议模板");
      if (!model) {
        const m = makeVariant(
          base,
          candidate,
          attributes,
          `remote.${Date.now().toString(36)}`,
          candidate.name,
        );
        m.keys = [];
        m.raw = [];
        m.layout = {
          width: 320,
          height: 560,
          thumbnailSymbols: true,
          buttons: [],
        };
        delete m.image;
        update(m);
      }
      setStep(2);
      setNotice("");
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  function applyPreset() {
    const preset = remoteModels.get(presetId);
    if (!model || !preset) return;
    try {
      update(copyLayoutPreset(model, preset));
      setProofs({});
      setReplacePreset(false);
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  async function verify(key: number) {
    await run(async () => {
      epoch.current++;
      if (key === 2 && voiceProof.current) {
        setProofs((old) => ({ ...old, [2]: voiceProof.current! }));
        return;
      }
      if (key === 2) {
        capturing({ key: 2, phase: "voice", listened: false });
        await prepareVoice();
        return;
      }
      setProgress("准备按键验证");
      const s = await client.current!.status();
      if (!s.connected) throw Error("遥控器已断开");
      baseline.current = s.sequence;
      after.current = Math.max(after.current, s.sequence);
      pending.current = undefined;
      clearAudio();
      capturing({ key, phase: "key", listened: false });
    });
  }
  function checkProof(c: Capture) {
    if (!c.proof) throw Error("尚未收到完整按下和松开");
    for (const [id, p] of Object.entries(proofs))
      if (
        Number(id) !== c.key &&
        p.report === c.proof.report &&
        p.usage === c.proof.usage
      )
        throw Error("这个键码已分配给其他按键");
  }
  async function prepareVoice() {
    if (service.snapshot.info?.probe_voice_api !== 4)
      throw Error("请更新接收器固件以支持语音验证");
    epoch.current++;
    audioFetching.current = false;
    clearAudio();
    lastVoice.current = undefined;
    setProgress("准备语音协议");
    if (voicePrepared.current) {
      await client.current!.cancelVoice();
      const until = Date.now() + 3000;
      while (true) {
        const v = await client.current!.command<ProbeVoiceStatus>(
          OP.PROBE_VOICE_STATUS,
        );
        if (v.idle) break;
        if (Date.now() > until) throw Error("请松开语音键后重试");
        await sleep(80);
      }
    }
    await microphone.current.start();
    await client.current!.command(OP.PROBE_VOICE_ARM, {
      family: modelRef.current!.family,
      map_crc: modelRef.current!.map_crc,
      learn: true,
      report: 0,
      usage: 0,
    });
    voicePrepared.current = true;
    capturing({ key: 2, phase: "voice", listened: false });
  }
  async function testVoice() {
    await run(prepareVoice);
  }
  async function reconnectVoice() {
    await run(async () => {
      epoch.current++;
      const recovered = await client.current!.reconnect(
        selected!,
        model!,
        setProgress,
      );
      setSelected(recovered.candidate);
      attrsRef.current = recovered.attrs;
      setAttrs(recovered.attrs);
      after.current = baseline.current = 0;
      pending.current = undefined;
      voicePrepared.current = false;
      clearAudio();
      const c = captureRef.current;
      if (c) {
        capturing({ key: 2, phase: "voice", listened: false });
        await prepareVoice();
      }
    });
  }
  async function cancelCapture(remove = false) {
    await run(async () => {
      epoch.current++;
      if (captureRef.current?.phase === "voice")
        await client.current!.command(OP.PROBE_VOICE_CANCEL);
      if (remove && model && captureRef.current)
        update(removeKey(model, captureRef.current.key));
      pending.current = undefined;
      capturing(undefined);
      clearAudio();
    });
  }
  function confirmCapture() {
    try {
      const c = captureRef.current!;
      checkProof(c);
      if (
        c.key === 2 &&
        !(
          voiceProof.current &&
          c.proof?.report === voiceProof.current.report &&
          c.proof?.usage === voiceProof.current.usage
        ) &&
        (!c.listened || !audio || voice?.error || !voice?.released)
      )
        throw Error("请完成录音、试听并确认声音正常");
      if (c.key === 2) voiceProof.current = { ...c.proof!, voice: true };
      if (preflight.current) {
        preflight.current = false;
        setStep(2);
      }
      setProofs((old) => ({
        ...old,
        [c.key]: { ...c.proof!, ...(c.key === 2 ? { voice: true } : {}) },
      }));
      capturing(undefined);
      clearAudio();
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    if (!capture?.proof || capture.phase !== "key" || busy || error) return;
    const timer = window.setTimeout(() => {
      if (captureRef.current !== capture || locked.current) return;
      try {
        checkProof(capture);
      } catch (e) {
        fail(e);
        return;
      }
      if (
        capture.key === 2 &&
        (!voiceProof.current ||
          voiceProof.current.report !== capture.proof?.report ||
          voiceProof.current.usage !== capture.proof?.usage)
      )
        void testVoice();
      else confirmCapture();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [capture, busy, error]);
  function evidence() {
    return {
      schema: 2,
      firmware: service.snapshot.info?.firmware,
      protocol,
      candidate: selected,
      attributes: attrs,
      reports,
      timings: client.current?.trace,
      failures,
      status,
      proofs,
      voice: lastVoice.current,
    };
  }
  async function save() {
    await run(async () => {
      const m = verifiedModel(model!, proofs);
      m.layout.artworkButtons = true;
      const conflict = conflictingModel(m);
      if (conflict)
        throw Error(
          `此遥控器已有型号「${conflict.title}」（${conflict.id}），请使用已有型号，不能重复添加相同识别规则`,
        );
      if (remoteModels.has(m.id) && localSaved.current !== m.id)
        throw Error("型号标识已存在");
      setProgress("保存型号");
      let result: string | null = localSaved.current;
      if (!result) {
        result = await call<string | null>("save_remote_model", {
          model: m,
          image: renderRemoteArtwork(m),
          evidence: JSON.stringify(evidence()),
        });
        if (!result) return;
        localSaved.current = m.id;
      }
      {
        if (!ended.current) {
          await client.current!.end();
          ended.current = true;
        }
        setProgress("同步型号到接收器");
        await service.reloadModels();
        setStep(3);
        setNotice("型号已保存");
      }
    });
  }
  const complete =
    !!model?.keys.length &&
    model.keys.every(
      (k) => proofs[k.id] && (k.id !== 2 || proofs[k.id].voice),
    ) &&
    model.keys.some((k) => k.id === 2);
  const modalBusy = busy || !!capture || !!localSaved.current;
  return (
    <div
      className="shade"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          if (!busy) void (capture ? cancelCapture() : finish());
        }
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="遥控器适配工具"
        className="dialog probe-workbench"
      >
        <header>
          <h2>适配新遥控器</h2>
          <button disabled={busy || !!capture} onClick={() => void finish()}>
            关闭
          </button>
        </header>
        <nav className="probe-steps">
          {steps.map((s, i) => (
            <span key={s} className={step === i ? "active" : ""}>
              {i < step ? "✓" : i + 1} {s}
            </span>
          ))}
        </nav>
        <div className="probe-progress-slot">
          {busy && (
            <p className="probe-status">
              <LoaderCircle className="spin" size={16} />
              {progress}
            </p>
          )}
        </div>
        {!capture && error && (
          <Feedback error>
            <span>{error}</span>
            <button
              disabled={busy || !native}
              onClick={() =>
                void run(async () => {
                  await call("export_config", {
                    text: JSON.stringify(evidence(), null, 2),
                  });
                })
              }
            >
              保存诊断
            </button>
          </Feedback>
        )}
        {notice && (
          <Feedback>
            {step === 1 ? "✓ " : ""}
            {notice}
          </Feedback>
        )}
        {identified && !status?.connected && !error && (
          <Feedback>遥控器已断开，验证按键前请重新连接。</Feedback>
        )}
        {step === 0 && (
          <>
            <div className="probe-actions">
              <h3>附近的设备</h3>
              <LoaderCircle className="spin" size={16} />
              <span>正在搜索</span>
            </div>
            <p>将遥控器置于配对模式，并放在接收器旁。</p>
            <div className="probe-devices">
              {candidates.map((c) => (
                <div
                  key={`${c.address_type}:${c.address}`}
                  className="probe-device"
                >
                  <div>
                    <strong>{c.name || "未命名设备"}</strong>
                    <small>
                      {c.address} · {c.rssi} dBm
                    </small>
                  </div>
                  <button
                    disabled={busy || !c.connectable || c.bound_slot >= 0}
                    onClick={() => {
                      setSelected(c);
                      setStep(1);
                      setError("");
                    }}
                  >
                    {c.bound_slot >= 0
                      ? "已添加"
                      : c.connectable
                        ? "选择"
                        : "不可连接"}
                  </button>
                </div>
              ))}
              {!candidates.length && <p className="muted">暂未发现附近设备</p>}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h3>{selected?.name || selected?.address}</h3>
            <div>
              <label className="probe-form">
                协议类型
                <select
                  value={protocol}
                  disabled={busy || !!model}
                  onChange={(e) => {
                    setProtocol(Number(e.target.value));
                    setIdentified(false);
                    setNotice("");
                  }}
                >
                  <option value={0}>自动识别</option>
                  <option value={1}>ATVV（小米等）</option>
                  <option value={2}>HID/ICO（联通、移动等）</option>
                </select>
              </label>
            </div>
            {error && (
              <details>
                <summary>设备信息与诊断</summary>
                <p>
                  {status?.encrypted ? "已加密" : "未加密"} ·{" "}
                  {probeStages[status?.phase ?? ""] ?? status?.phase}
                </p>
                <div className="probe-scroll">
                  <pre>
                    {JSON.stringify(
                      { attributes: attrs, status, failures },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </details>
            )}
            <div className="probe-footer">
              <button disabled={busy} onClick={() => void backToScan()}>
                返回
              </button>
              <button
                disabled={busy || voicePrepared.current}
                className="primary"
                onClick={() => {
                  if (identified && status?.connected) {
                    if (voiceProof.current) setStep(2);
                    else void verify(2);
                  } else void connect();
                }}
              >
                {identified && status?.connected
                  ? voiceProof.current
                    ? "配置按键"
                    : "验证语音"
                  : error
                    ? "重试识别"
                    : "识别"}
              </button>
            </div>
          </>
        )}
        {step === 2 && model && (
          <>
            <div className="probe-name-fields">
              <label>
                型号名称
                <input
                  value={model.title}
                  disabled={modalBusy}
                  onChange={(e) => update({ ...model, title: e.target.value })}
                />
              </label>
              <details>
                <summary>高级信息</summary>
                <label>
                  型号标识
                  <input
                    value={model.id}
                    disabled={modalBusy}
                    onChange={(e) => update({ ...model, id: e.target.value })}
                  />
                </label>
              </details>
            </div>
            <div className="probe-actions">
              <label>
                从已有布局复制
                <select
                  aria-label="布局预设"
                  value={presetId}
                  disabled={modalBusy}
                  onChange={(e) => setPresetId(e.target.value)}
                >
                  <option value="">选择型号</option>
                  {[...remoteModels.values()].map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={modalBusy || !presetId}
                onClick={() =>
                  model.keys.length ? setReplacePreset(true) : applyPreset()
                }
              >
                加载布局
              </button>
            </div>
            <ProbeLayout
              model={model}
              proofs={proofs}
              change={update}
              verify={(key) => void verify(key)}
              disabled={modalBusy}
            />
            <div className="probe-footer">
              <button disabled={modalBusy} onClick={() => setStep(1)}>
                返回
              </button>
              <div className="probe-actions">
                <small>
                  已验证{" "}
                  {
                    model.keys.filter(
                      (k) => proofs[k.id] && (k.id !== 2 || proofs[k.id].voice),
                    ).length
                  }{" "}
                  / {model.keys.length}
                  {!model.keys.some((k) => k.id === 2) ? " · 需要语音键" : ""}
                </small>
                <button
                  className="primary"
                  disabled={busy || !!capture || !complete}
                  onClick={() => void save()}
                >
                  {localSaved.current ? "重试同步" : "保存并使用"}
                </button>
              </div>
            </div>
          </>
        )}
        {step === 3 && model && (
          <>
            <h3>{model.title}</h3>
            <p>{model.keys.length} 个按键 · 语音已验证</p>
            <div className="probe-footer">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    service.releaseProbe();
                    addRemote();
                  })
                }
              >
                添加这只遥控器
              </button>
            </div>
          </>
        )}
        {replacePreset && (
          <div
            className="probe-modal-layer"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setReplacePreset(false);
            }}
          >
            <section
              className="probe-modal"
              role="dialog"
              aria-modal="true"
              aria-label="替换当前布局"
            >
              <h3>替换当前布局？</h3>
              <p>当前布局和按键验证结果将被清除。</p>
              <div className="probe-actions">
                <button onClick={() => setReplacePreset(false)}>取消</button>
                <button className="primary" onClick={applyPreset}>
                  替换
                </button>
              </div>
            </section>
          </div>
        )}
        {capture && (
          <div
            className="probe-modal-layer"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" && !busy) void cancelCapture();
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label="验证按键"
              className="probe-modal capture-modal"
            >
              <h3>
                验证按键 ·{" "}
                {model?.keys.find((k) => k.id === capture.key)?.label ?? "语音"}
              </h3>
              <label>
                按键名称
                <input
                  maxLength={24}
                  disabled={busy}
                  value={
                    model?.keys.find((k) => k.id === capture.key)?.label ??
                    "语音"
                  }
                  onChange={(e) => {
                    if (model)
                      update({
                        ...model,
                        keys: model.keys.map((k) =>
                          k.id === capture.key
                            ? { ...k, label: e.target.value }
                            : k,
                        ),
                      });
                  }}
                />
              </label>
              {capture.phase === "key" ? (
                <>
                  {capture.key === 2 && (
                    <p className="probe-stage-title">1. 确认语音键</p>
                  )}
                  <p>
                    请操作遥控器上的「
                    {model?.keys.find((k) => k.id === capture.key)?.label ??
                      "语音"}
                    」键：
                  </p>
                  <div className="probe-key-gesture">
                    <strong
                      className={capture.down || capture.proof ? "done" : ""}
                    >
                      按下{(capture.down || capture.proof) && " ✓"}
                    </strong>
                    <span>→</span>
                    <strong className={capture.proof ? "done" : ""}>
                      松开{capture.proof && " ✓"}
                    </strong>
                  </div>
                  <p role="status">
                    {capture.proof
                      ? "验证通过"
                      : capture.down
                        ? "已按下，请松开"
                        : "等待按键…"}
                  </p>
                </>
              ) : (
                <>
                  <p className="probe-stage-title">
                    {audio ? "试听确认" : "测试录音"}
                  </p>
                  <p role="status">
                    {error || voice?.error
                      ? "测试未完成"
                      : busy
                        ? progress
                        : audio
                          ? "录音已就绪，请试听"
                          : voice?.recording
                            ? "正在录音，说话约 3 秒后松开"
                            : voice?.released
                              ? "正在处理录音"
                              : voice?.ready
                                ? "请按住语音键说话约 3 秒，然后松开。"
                                : "正在准备语音协议…"}
                  </p>
                  <div className="voice-media-slot">
                    {!audio && !error && (
                      <div className="probe-voice-state">
                        <span>
                          {(
                            (voice?.samples ?? 0) / (voice?.rate || 16000)
                          ).toFixed(1)}{" "}
                          秒
                        </span>
                      </div>
                    )}
                    {audio && (
                      <audio
                        controls
                        src={audio}
                        onEnded={() =>
                          captureRef.current === capture &&
                          capturing({ ...capture, listened: true })
                        }
                      />
                    )}
                  </div>
                  <div className="voice-retry-slot">
                    {voice?.adapter_error && (
                      <button
                        disabled={busy}
                        onClick={() => void reconnectVoice()}
                      >
                        重新连接
                      </button>
                    )}
                    {(audio || error) && !voice?.adapter_error && (
                      <button disabled={busy} onClick={() => void testVoice()}>
                        重新录音
                      </button>
                    )}
                  </div>
                </>
              )}
              {error && <Feedback error>{error}</Feedback>}
              {busy && capture.phase === "key" && (
                <Feedback>{progress}</Feedback>
              )}
              <div className="probe-actions">
                {capture.key !== 2 && (
                  <button
                    disabled={busy}
                    onClick={() => void cancelCapture(true)}
                  >
                    移除按键
                  </button>
                )}
                <button
                  className="capture-cancel"
                  disabled={busy}
                  onClick={() => void cancelCapture()}
                >
                  取消
                </button>
                {capture.phase === "voice" && audio && (
                  <button
                    className="primary"
                    disabled={
                      busy || !!error || !!voice?.error || !capture.listened
                    }
                    onClick={confirmCapture}
                  >
                    声音正常
                  </button>
                )}
                {capture.phase === "key" &&
                  capture.key === 2 &&
                  capture.proof &&
                  error && (
                    <button
                      className="capture-retry"
                      disabled={busy}
                      onClick={() => void testVoice()}
                    >
                      重试试录
                    </button>
                  )}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
function voiceError(s: string) {
  const messages: Record<string, string> = {
    "voice initialization timeout": "语音协议准备超时，请返回重新连接",
    "no audio stream": "没有收到语音数据",
    "audio stalled": "语音数据中断",
    "audio decode failed": "音频解码失败",
    "unsupported audio format": "音频格式不支持",
    "host audio buffer overrun": "音频传输缓冲已满，请重新录音",
    "audio transport buffer full": "音频传输缓冲已满，请重新录音",
    "no decoded audio": "没有可试听的音频",
    "voice protocol fault": "语音协议报错",
    "voice ended abnormally": "语音异常结束",
  };
  return messages[s] ?? s;
}
