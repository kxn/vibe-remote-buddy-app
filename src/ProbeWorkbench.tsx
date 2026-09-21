import { RemotePreview } from "./RemotePreview";
import {
  modelCandidates,
  scanKnown,
  KeyConfirmation,
  type ModelCandidate,
} from "./core/onboarding";
import { ProbeMicrophone } from "./core/probe-microphone";
import { Feedback } from "./Feedback";
import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { BuddyService, ProbeSessionLostError } from "./core/service";
import { remoteModels, type RemoteModel } from "./core/models";
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
const steps = ["连接设备", "选择机型", "确认与布局", "完成"];
/* Voice protocol family of a model; display only, matching never uses it. */
const familyLabel = (f: number) =>
  f === 2 ? "联通 ICO" : f === 3 ? "旧版 mSBC" : "ATVV";
export function ProbeWorkbench({
  service,
  close,
  preferredModel,
}: {
  service: BuddyService;
  close: () => void;
  preferredModel?: string;
}) {
  const confirmation = useRef<KeyConfirmation | undefined>(undefined);
  const stageRef = useRef(0);
  const [showAll, setShowAll] = useState(false),
    [choices, setChoices] = useState<ModelCandidate[]>([]),
    [choice, setChoice] = useState(""),
    [confirmed, setConfirmed] = useState<number[]>([]);
  const choiceRef = useRef<ModelCandidate | undefined>(undefined);
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
    autoTitle = useRef(""),
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
  stageRef.current = step;
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
        while (alive.current && !sessionLost.current && !ended.current) {
          try {
            if (!locked.current) {
              const pollEpoch = epoch.current;
              const s = await started.status();
              if (!alive.current || ended.current) break;
              if (locked.current || pollEpoch !== epoch.current) {
                await sleep(80);
                continue;
              }
              setStatus(s);
              if (!s.connected && captureRef.current) {
                capturing(undefined);
                if (stageRef.current === 5) setStep(1);
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
                if (!alive.current || ended.current) break;
                if (pollEpoch !== epoch.current) continue;
                for (const r of batch) {
                  after.current = Math.max(after.current, r.sequence);
                  if (
                    stageRef.current === 4 &&
                    confirmation.current &&
                    !locked.current
                  ) {
                    const result = confirmation.current.accept(
                      r,
                      attrsRef.current,
                    );
                    setConfirmed([...confirmation.current.verified]);
                    if (result.error) setError(result.error);
                    else if (result.key) setError("");
                    continue;
                  }
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
                      `${voiceError(v.error || "audio decode failed")}${v.adapter_error && v.adapter_error !== v.error ? " · " + v.adapter_error : ""}${v.sdk_error ? " · " + sdkError(v.sdk_error) : ""}${v.decode_error ? " · 解码错误 " + v.decode_error : ""}`,
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
      confirmation.current = undefined;
      choiceRef.current = undefined;
      setChoices([]);
      setChoice("");
      setConfirmed([]);
      voiceProof.current = undefined;
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
      if (!(await c.status()).encrypted) await c.security();
      setProgress("读取服务与设备信息");
      const a = await c.identity(await c.discover());
      attrsRef.current = a;
      setAttrs(a);
      let s = await c.status();
      setStatus(s);
      const family = familyEvidence(a);
      if (!family) throw Error("此设备的语音协议暂不支持，请保存诊断");
      if (protocol && family !== protocol)
        throw Error("设备协议特征与所选协议不一致");
      setProgress("订阅按键通道");
      await c.subscribe(a);
      s = await c.status();
      setStatus(s);
      if (!s.connected) throw Error("连接已断开，请重新连接");
      setIdentified(true);
      const found = modelCandidates(a, service.modelCatalog);
      setChoices(found);
      const preferred =
        found.find((x) => x.model.id === preferredModel) ?? found[0];
      setChoice(preferred?.model.id ?? "");
      choiceRef.current = preferred;
      setStep(1);
      voiceProof.current = undefined;
      baseline.current = after.current = s.sequence;
      pending.current = undefined;
    });
  }
  function beginLayout(attributes: ProbeAttribute[], candidate = selected) {
    try {
      const family = familyEvidence(attributes);
      if (!family || (protocol && protocol !== family))
        throw Error("请先完成连接与协议识别");
      const catalog = [...remoteModels.values()];
      const existing = catalog.find((m) => m.family === family);
      // Protocol 3 has no factory key layout yet; reuse a valid seed, then
      // clear all bindings below. Never install a guessed name-only match.
      const seed =
        existing ??
        (family === 3 ? catalog.find((m) => m.family === 1) : undefined);
      const base = seed
        ? { ...seed, family: family as RemoteModel["family"] }
        : undefined;
      if (!base || !candidate) throw Error("缺少协议模板");
      if (!modelRef.current) {
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
          editorColumns: 3,
          editorRows: 8,
          buttons: [],
        };
        delete m.image;
        autoTitle.current = m.title;
        update(m);
      }
      setStep(2);
      setNotice("");
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  async function chooseModel() {
    await run(async () => {
      if (ended.current && modelRef.current) {
        await addKnown(modelRef.current);
        return;
      }
      if (!status?.connected) throw Error("连接已断开，请重新连接");
      const selectedChoice = choices.find((c) => c.model.id === choice);
      choiceRef.current = selectedChoice;
      setProofs({});
      setConfirmed([]);
      confirmation.current = undefined;
      if (selectedChoice && !selectedChoice.variant) {
        update(structuredClone(selectedChoice.model));
        if (!selectedChoice.confirmKeys) {
          await addKnown(selectedChoice.model);
          return;
        }
        if (selectedChoice.model.family === 1) {
          preflight.current = true;
          voiceProof.current = undefined;
          setStep(5);
          capturing({ key: 2, phase: "voice", listened: false });
          await prepareVoice();
          return;
        }
        confirmation.current = new KeyConfirmation(selectedChoice.model);
        baseline.current = after.current = (
          await client.current!.status()
        ).sequence;
        setStep(4);
        return;
      }
      modelRef.current = undefined;
      setModel(undefined);
      if (selectedChoice) {
        update(
          makeVariant(
            selectedChoice.model,
            selected!,
            attrsRef.current,
            `remote.${Date.now().toString(36)}`,
            selectedChoice.model.title,
          ),
        );
      } else beginLayout(attrsRef.current);
      if (!modelRef.current) throw Error("无法建立适配配置");
      preflight.current = true;
      voiceProof.current = undefined;
      setStep(5);
      capturing({ key: 2, phase: "voice", listened: false });
      await prepareVoice();
    });
  }
  async function addKnown(m: RemoteModel) {
    setProgress("保存到接收器");
    if (!ended.current) await service.installCatalog();
    await service.adoptProbe(m.id, () => {
      ended.current = true;
    });
    update(m);
    setStep(3);
    setNotice("遥控器已添加");
  }
  async function finishKeys() {
    if (!model || !model.keys.every((k) => confirmed.includes(k.id))) return;
    if (choiceRef.current && !choiceRef.current.variant) {
      await run(() => addKnown(model));
      return;
    }
    const collected: Record<number, KeyProof> = {};
    for (const key of model.keys) {
      if (key.id === 2 && voiceProof.current) collected[2] = voiceProof.current;
      else {
        const raw = confirmation.current?.proofs.get(key.id);
        if (!raw) {
          fail("按键缺少映射，请重新适配");
          return;
        }
        collected[key.id] = { report: raw.report, usage: raw.usage };
      }
    }
    await save(collected);
  }
  function applyPreset() {
    const preset = remoteModels.get(presetId);
    if (!model || !preset) return;
    try {
      update(copyLayoutPreset(model, preset));
      setProofs({});
      setReplacePreset(false);
      setPresetId("");
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
      if (stageRef.current === 5) {
        preflight.current = false;
        setStep(1);
      }
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
        if (choiceRef.current) {
          confirmation.current = new KeyConfirmation(modelRef.current!);
          confirmation.current.verified.add(2);
          setConfirmed([2]);
          setStep(4);
        } else setStep(2);
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
  async function save(verified = proofs) {
    await run(async () => {
      const m = verifiedModel(model!, verified);
      m.layout.artworkButtons = true;
      if (remoteModels.has(m.id) && localSaved.current !== m.id)
        throw Error("型号标识已存在");
      /* Same-named models are distinguished by fingerprint evidence, but the
       * operator must see that choice was made. Auto titles also gain the key
       * count so identical broadcast names stop colliding in pickers. */
      if (m.title === autoTitle.current && m.keys.length)
        m.title = `${m.title} · ${m.keys.length}键`;
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
        setProgress("保存到接收器");
        await service.reloadModels();
        await service.adoptProbe(m.id, () => {
          ended.current = true;
        });
        ended.current = true;
        setStep(3);
        setNotice("遥控器已添加");
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
  const preset = presetId ? remoteModels.get(presetId) : undefined;
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
        aria-label="添加遥控器"
        className={`dialog probe-workbench ${step === 2 || step === 5 ? "workspace-mode" : ""}`}
      >
        <header>
          <h2>添加遥控器</h2>
          <button disabled={busy || !!capture} onClick={() => void finish()}>
            关闭
          </button>
        </header>
        <nav className="probe-steps">
          {steps.map((s, i) => (
            <span
              key={s}
              className={
                (step === 4 || step === 5 ? 2 : step) === i ? "active" : ""
              }
            >
              {i < (step === 4 || step === 5 ? 2 : step) ? "✓" : i + 1} {s}
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
        {identified && !ended.current && !status?.connected && !error && (
          <Feedback>遥控器已断开，验证按键前请重新连接。</Feedback>
        )}
        <div className={`onboarding-content ${step === 5 ? "voice-step" : ""} ${step === 2 ? "layout-step" : ""} ${step === 1 || step === 4 ? "candidate-step" : ""}`}>
          {step === 0 && (
            <>
              <div className="probe-actions">
                <LoaderCircle className="spin" size={16} />
                <span>搜索附近的遥控器</span>
                <label>
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => {
                      setShowAll(e.target.checked);
                      if (
                        !e.target.checked &&
                        selected &&
                        !scanKnown(selected, service.pairingModels)
                      )
                        setSelected(undefined);
                    }}
                  />
                  显示所有机型
                </label>
              </div>
              <div className="probe-devices">
                {candidates
                  .filter(
                    (c) =>
                      c.bound_slot < 0 &&
                      (showAll || scanKnown(c, service.pairingModels)),
                  )
                  .map((c) => (
                    <button
                      key={`${c.address_type}:${c.address}`}
                      className={`probe-device ${selected?.address === c.address ? "selected" : ""}`}
                      disabled={busy}
                      onClick={() => setSelected(c)}
                    >
                      <span>
                        <strong>{c.name || "未命名设备"}</strong>
                        {!scanKnown(c, service.pairingModels) && (
                          <small>需适配</small>
                        )}
                      </span>
                      <small>信号良好</small>
                    </button>
                  ))}
              </div>
            </>
          )}
          {step === 1 && (
            <div className="onboarding-columns">
              <div>
                <h3>{selected?.name}</h3>
                <label>
                  机型
                  <select
                    disabled={busy}
                    value={choice}
                    onChange={(e) => {
                      setChoice(e.target.value);
                      setError("");
                    }}
                  >
                    {choices.map((c) => (
                      <option key={c.model.id} value={c.model.id}>
                        {c.model.title}
                        {c.match === "compatible" ? "（需确认）" : ""}
                      </option>
                    ))}
                    <option value="">未知遥控器需要适配</option>
                  </select>
                </label>
              </div>
              <div className="onboarding-preview">
                {choices.find((c) => c.model.id === choice) ? (
                  <RemotePreview
                    model={choices.find((c) => c.model.id === choice)!.model}
                  />
                ) : (
                  <span>创建新的遥控器配置</span>
                )}
              </div>
            </div>
          )}
          {step === 4 && model && (
            <div className="onboarding-columns">
              <div>
                <h3>依次按下并松开每个按键</h3>
                <p>
                  {confirmed.length} / {model.keys.length}
                </p>
                <div className="confirmation-keys">
                  {model.keys.map((k) => (
                    <span
                      key={k.id}
                      className={confirmed.includes(k.id) ? "verified" : ""}
                    >
                      {k.label}
                      {confirmed.includes(k.id) ? " ✓" : ""}
                    </span>
                  ))}
                </div>
              </div>
              <div className="onboarding-preview">
                <RemotePreview model={model} verified={confirmed} />
              </div>
            </div>
          )}
          {step === 2 && model && (
            <>
              <div className="layout-settings">
                <label>型号名称
                  <input value={model.title} disabled={modalBusy}
                    onChange={e => update({...model, title:e.target.value})} />
                </label>
                <label>复制布局
                  <div className="layout-preset-control">
                    <select aria-label="布局预设" value={presetId} disabled={modalBusy}
                      onChange={e => setPresetId(e.target.value)}>
                      <option value="">选择型号</option>
                      {[...remoteModels.values()].map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </select>
                  </div>
                </label>

              </div>
              <ProbeLayout
                preview={preset}
                loadPreview={() => model.keys.length ? setReplacePreset(true) : applyPreset()}
                cancelPreview={() => setPresetId("")}
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
                        (k) =>
                          proofs[k.id] && (k.id !== 2 || proofs[k.id].voice),
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
                    {localSaved.current
                      ? ended.current
                        ? "重试绑定"
                        : "重试保存"
                      : "保存并使用"}
                  </button>
                </div>
              </div>
            </>
          )}
          {step === 3 && model && (
            <>
              <h3>{model.title}</h3>
              <p>{model.keys.length} 个按键 · 已添加</p>
              <div className="probe-footer">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      service.releaseProbe();
                      close();
                    })
                  }
                >
                  完成
                </button>
              </div>
            </>
          )}
        </div>
        {[0, 1, 4].includes(step) && (
          <div className="probe-footer onboarding-footer">
            <button
              disabled={busy || ended.current || !!localSaved.current}
              onClick={() =>
                step === 0
                  ? void finish()
                  : step === 1
                    ? void backToScan()
                    : (setStep(1), setError(""))
              }
            >
              {step === 0 ? "取消" : "返回"}
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                sessionLost.current ||
                (step === 0
                  ? !selected
                  : step === 4
                    ? !model?.keys.every((k) => confirmed.includes(k.id))
                    : !status?.connected && !ended.current)
              }
              onClick={() =>
                step === 0
                  ? void connect()
                  : step === 1
                    ? void chooseModel()
                    : void finishKeys()
              }
            >
              {step === 0 ? "连接" : step === 4 ? "添加" : "下一步"}
            </button>
            {step !== 0 && !status?.connected && !ended.current && (
              <button disabled={busy} onClick={() => void connect()}>
                重新连接
              </button>
            )}
          </div>
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
            className={step === 5 ? "onboarding-voice" : "probe-modal-layer"}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape" && !busy) void cancelCapture();
            }}
          >
            <section
              role="dialog"
              aria-modal={step === 5 ? undefined : true}
              aria-label="验证按键"
              className="probe-modal capture-modal"
            >
              <h3>
                验证按键 ·{" "}
                {model?.keys.find((k) => k.id === capture.key)?.label ?? "语音"}
              </h3>
              <label hidden={step === 5}>
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
                    {!audio && !error && voice?.recording && (
                      <div className="probe-voice-state">
                        <span>
                          已录音 {(
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
