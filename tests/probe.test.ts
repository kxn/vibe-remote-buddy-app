import { describe, it, expect } from "vitest";
import {
  ProbeClient,
  decodeKey,
  makeVariant,
  captureMapping,
  familyEvidence,
  type ProbeAttribute,
  type ProbeCandidate,
  type ProbeReport,
  type ProbeCommand,
} from "../src/core/probe";
import { OP, DeviceError } from "../src/core/session";
import { validateModel } from "../src/core/models";
import xiaomi from "../resources/remotes/xiaomi.rc003/model.json";
const attr = (extra: Partial<ProbeAttribute>): ProbeAttribute => ({
  index: 0,
  kind: 3,
  handle: 4,
  parent: 3,
  end: 0,
  properties: 0,
  uuid: "0x2908",
  length: 2,
  complete: true,
  hex: "0101",
  ...extra,
});
const report = (hex: string): ProbeReport => ({
  sequence: 1,
  lost: 0,
  time_ms: 100,
  handle: 3,
  length: hex.length / 2,
  hex,
});
const c = {
  name: "New remote",
  company: 123,
  address: "random",
} as ProbeCandidate;
const map = attr({ uuid: "0x2a4b", hex: "05010906", length: 4 });
describe("remote adaptation", () => {
  it("decodes only complete supported input report formats, including release", () => {
    expect(decodeKey(report("00004f0000000000"), [attr({})])).toEqual({
      report: 1,
      usages: [79],
    });
    expect(decodeKey(report("0000000000000000"), [attr({})])).toEqual({
      report: 1,
      usages: [],
    });
    expect(decodeKey(report("01004f0000000000"), [attr({})])).toBeUndefined();
    expect(decodeKey(report("0000010000000000"), [attr({})])).toBeUndefined();
    expect(decodeKey(report("e900"), [attr({ hex: "0301" })])).toEqual({
      report: 3,
      usages: [233],
    });
    expect(
      decodeKey({ ...report("e900"), length: 5 }, [attr({ hex: "0301" })]),
    ).toBeUndefined();
    expect(decodeKey(report("e900"), [attr({ hex: "0302" })])).toBeUndefined();
  });
  it("exports stable fingerprints with complete report map, never RPA", () => {
    const m = makeVariant(
      validateModel(xiaomi),
      c,
      [map],
      "example.remote",
      "Example",
    );
    expect(m.matches).toEqual([{ name: c.name, company: 123 }]);
    expect(m.map_crc).not.toBe(0);
    expect(JSON.stringify(m)).not.toContain("random");
    expect(() =>
      makeVariant(
        validateModel(xiaomi),
        c,
        [{ ...map, complete: false }],
        "example",
        "Example",
      ),
    ).toThrow(/完整/);
    expect(() =>
      makeVariant(
        validateModel(xiaomi),
        { ...c, name: "" },
        [map],
        "example",
        "Example",
      ),
    ).toThrow(/名称/);
    expect(() =>
      makeVariant(validateModel(xiaomi), c, [map, map], "example", "Example"),
    ).toThrow(/唯一/);
  });
  it("captures remaps without changing the source or allowing ambiguous assignment", () => {
    const m = validateModel(xiaomi),
      result = captureMapping(m, 1, 79, 3);
    expect(m.raw).toHaveLength(0);
    expect(result.raw).toEqual([{ report: 1, usage: 79, key: 3 }]);
    expect(captureMapping(result, 1, 79, 3).raw).toHaveLength(1);
    expect(() => captureMapping(result, 1, 79, 4)).toThrow(/其他按钮/);
  });
  it("requires protocol evidence, not advertising names, to suggest a family", () => {
    expect(familyEvidence([])).toBeUndefined();
    expect(
      familyEvidence([
        attr({ kind: 1, uuid: "ab5e0001-5a21-4f05-bc7d-af01f617b664" }),
      ]),
    ).toBe(1);
    expect(
      familyEvidence(
        ["fc01", "fb02", "f801", "fa02"].map((hex) => attr({ hex })),
      ),
    ).toBe(2);
  });
  it("reads all chunks and rejects stalled data", async () => {
    const command = async (op: number, q: any) => ({
      ...map,
      length: 200,
      hex: q.offset === 0 ? "00".repeat(128) : "11".repeat(72),
    });
    const client = new ProbeClient(command as ProbeCommand);
    expect((await client.attribute(0)).hex.length).toBe(400);
    const bad = new ProbeClient((async (op: number, q: any) => ({
      ...map,
      length: 200,
      hex: q.offset === 0 ? "00".repeat(128) : "",
    })) as ProbeCommand);
    await expect(bad.attribute(0)).rejects.toThrow(/进展/);
  });
  it("retains read errors and never treats transport faults as an empty scan", async () => {
    const client = new ProbeClient((async (op: number) => {
      throw new DeviceError(op === OP.CANDIDATE ? 15 : 8, op, {
        sdk_error: 261,
      });
    }) as ProbeCommand);
    await expect(client.candidates()).rejects.toBeInstanceOf(DeviceError);
    const result = await client.identity([map]);
    expect(result[0].read_error).toBeTruthy();
  });
});

import { ProbeCandidates, sdkError } from "../src/core/probe";
describe("probe discovery usability", () => {
  const candidate = (id: number, rssi: number, age_ms = 0) =>
    ({
      connectable: true,
      candidate_id: id,
      address: `remote-${id}`,
      address_type: 1,
      rssi,
      age_ms,
    }) as ProbeCandidate;
  it("filters weak and invalid signals while retaining unknown nearby devices", () => {
    const list = new ProbeCandidates();
    expect(
      list.update([
        candidate(1, -90),
        candidate(2, -50),
        candidate(3, 127),
        { ...candidate(4, -25), connectable: false },
      ]),
    ).toEqual([candidate(2, -50)]);
  });
  it("preserves row order across signal fluctuations and candidate ID replacement", () => {
    const list = new ProbeCandidates();
    list.update([candidate(1, -40), candidate(2, -55)]);
    expect(
      list.update([candidate(2, -30), candidate(1, -50)]).map((c) => c.address),
    ).toEqual(["remote-1", "remote-2"]);
    expect(
      list
        .update([{ ...candidate(1, -50), candidate_id: 44 }, candidate(2, -30)])
        .map((c) => c.candidate_id),
    ).toEqual([44, 2]);
  });
  it("inserts a stronger newcomer ahead without reranking existing devices", () => {
    const list = new ProbeCandidates();
    list.update([candidate(1, -45), candidate(2, -50)]);
    expect(
      list
        .update([candidate(1, -55), candidate(2, -30), candidate(3, -35)])
        .map((c) => c.candidate_id),
    ).toEqual([3, 1, 2]);
  });
  it("uses hysteresis and ages devices out without constantly reordering", () => {
    const list = new ProbeCandidates();
    list.update([candidate(1, -54)]);
    expect(list.update([candidate(1, -57)])).toHaveLength(1);
    expect(list.update([candidate(1, -61)])).toHaveLength(0);
    expect(list.update([candidate(1, -57)])).toHaveLength(0);
    list.update([candidate(1, -50)]);
    expect(list.update([candidate(1, -50, 5000)])).toHaveLength(0);
  });
  it("distinguishes the NimBLE host domain from ATT and HCI errors", () => {
    expect(sdkError(7)).toContain("BLE_HS_ENOTCONN");
    expect(sdkError(0x207)).toContain("HCI");
    expect(sdkError(0x107)).toContain("ATT");
  });
  it("preserves the failed operation and firmware stage", async () => {
    const client = new ProbeClient((async () => ({
      active: true,
      pending: false,
      sdk_error: 7,
      error_phase: "characteristics",
      disconnect_reason: 0x213,
    })) as ProbeCommand);
    await expect(client.wait("发现服务与特征")).rejects.toThrow(
      /发现服务与特征.*BLE_HS_ENOTCONN.*发现特征.*对端主动断开/,
    );
  });
});

describe("voice retry ownership", () => {
  it("rearms an idle failed recording without disconnecting or deleting its bond", async () => {
    const ops: number[] = [];
    const client = new ProbeClient((async (op: number) => {
      ops.push(op);
      return op === OP.PROBE_VOICE_STATUS
        ? { idle: true, error: "audio decode failed", decode_error: 2 }
        : {};
    }) as ProbeCommand);
    await client.cancelVoice();
    expect(ops).toEqual([OP.PROBE_VOICE_CANCEL, OP.PROBE_VOICE_STATUS]);
    expect(client.trace).toHaveLength(2);
  });
  it("reports a failed adapter distinctly without silently reconnecting", async () => {
    const client = new ProbeClient((async (op: number) =>
      op === OP.PROBE_VOICE_STATUS
        ? { idle: true, adapter_error: "timeout", sdk_error: 13 }
        : {}) as ProbeCommand);
    await expect(client.cancelVoice()).rejects.toThrow("SDK 13");
  });
  it("only subscribes key reports before starting the voice adapter", async () => {
    const subscribed: number[] = [];
    const client = new ProbeClient((async (op: number, q: any) => {
      if (op === OP.PROBE_SUBSCRIBE) subscribed.push(q.index);
      return { active: true, pending: false, sdk_error: 0 };
    }) as ProbeCommand);
    const attrs = [1, 3, 248, 252, 253].flatMap((id, i) => [
      attr({ kind: 2, index: i, handle: i + 10, uuid: "2a4d", properties: 16 }),
      attr({ parent: i + 10, hex: id.toString(16).padStart(2, "0") + "01" }),
    ]);
    await client.subscribe(attrs);
    expect(subscribed).toEqual([0, 1, 2]);
  });
});

it("waits for the GAP reason after an SMP ENOTCONN callback", async () => {
  let reads = 0;
  const c = new ProbeClient((async () => ({
    active: true,
    pending: false,
    connected: ++reads === 1,
    sdk_error: 7,
    disconnect_reason: reads === 1 ? 0 : 531,
    error_phase: "pairing",
  })) as ProbeCommand);
  await expect(c.wait("配对加密")).rejects.toThrow("断开原因");
  expect(reads).toBe(2);
});
it("stops obsolete scanning requests when a connection starts", async () => {
  let count = 0;
  const c = new ProbeClient((async () => {
    count++;
    throw new DeviceError(6, OP.CANDIDATE, {});
  }) as ProbeCommand);
  await c.candidates(() => count === 1);
  expect(count).toBe(1);
});

it("restarts a failed live probe, ignores stale and unrelated advertisements, and connects with the new epoch", async () => {
  const selected = {
    address: "0c:f3:de:94:c5:d3",
    address_type: 0,
    name: "CMCC",
    candidate_id: 26,
    scan_epoch: 3,
  } as ProbeCandidate;
  const ops: number[] = [];
  let ended = false,
    connected = false;
  const c = new ProbeClient((async (op: number, body: any) => {
    ops.push(op);
    if (op === OP.PROBE_END) ended = true;
    if (op === OP.PROBE_STATUS)
      return {
        active: !ended || connected,
        connected: !ended || connected,
        pending: false,
        sdk_error: ended ? 0 : 7,
      };
    if (op === OP.CANDIDATE)
      return {
        ...selected,
        candidate_id: 41,
        scan_epoch: 4,
        connectable: true,
        name: "",
        age_ms: body.index === 0 ? 8807 : 25,
        address: body.index === 1 ? "other-device" : selected.address,
      };
    if (op === OP.PROBE_CONNECT) {
      expect(body).toEqual({ candidate_id: 41, scan_epoch: 4 });
      connected = true;
    }
    return {};
  }) as ProbeCommand);
  const fresh = await c.connectSelected(selected, () => {});
  expect(fresh.name).toBe("CMCC");
  expect(ops).toEqual([
    OP.PROBE_STATUS,
    OP.PROBE_END,
    OP.PROBE_STATUS,
    OP.PROBE_BEGIN,
    OP.CANDIDATE,
    OP.CANDIDATE,
    OP.CANDIDATE,
    OP.PROBE_CONNECT,
    OP.PROBE_STATUS,
  ]);
});
it("preserves a healthy established link when identifying again", async () => {
  const ops: number[] = [];
  const c = new ProbeClient((async (op: number) => {
    ops.push(op);
    return { active: true, connected: true, pending: false, sdk_error: 0 };
  }) as ProbeCommand);
  const selected = { address: "selected" } as ProbeCandidate;
  expect(await c.connectSelected(selected, () => {})).toBe(selected);
  expect(ops).toEqual([OP.PROBE_STATUS]);
});
it("does not connect after a selected-target search is cancelled", async () => {
  let cancelled = false;
  const c = new ProbeClient((async (op: number) => {
    if (op === OP.PROBE_STATUS)
      return { active: true, connected: false, pending: false, sdk_error: 0 };
    if (op !== OP.CANDIDATE) throw Error("unexpected connection");
    cancelled = true;
    return {
      address: "selected",
      address_type: 0,
      connectable: true,
      age_ms: 0,
    };
  }) as ProbeCommand);
  await expect(
    c.connectSelected(
      { address: "selected", address_type: 0 } as ProbeCandidate,
      () => {},
      () => cancelled,
    ),
  ).rejects.toThrow("连接已取消");
});

it("collects bounded fragment metadata after failure without recording PCM reads", async () => {
  const c = new ProbeClient((async (_op: number, q: any) => {
    if (q.transport) return { high_water: 640, backpressure: 0 };
    if (q.diagnostic === undefined) return { hex: "private audio" };
    if (q.diagnostic === 2) throw new DeviceError(6, OP.PROBE_VOICE_READ, {});
    return {
      index: q.diagnostic,
      time_ms: 100,
      fragment: "01000000000000000000",
    };
  }) as ProbeCommand);
  await c.voiceDiagnostics();
  expect(c.trace).toHaveLength(4);
  expect(c.trace[0].result).toEqual({ high_water: 640, backpressure: 0 });
  expect(c.trace[1].result).toHaveProperty("fragment");
  await c.command(OP.PROBE_VOICE_READ, { offset: 0 });
  expect(c.trace[4].result).toEqual({ offset: 0 });
});

it("assembles streamed audio without download requests and isolates captures", async () => {
  const c = new ProbeClient((async () => {
    throw Error("unexpected audio download");
  }) as ProbeCommand);
  c.receiveAudio({ capture: 8, offset: 0, hex: "0100" });
  c.receiveAudio({ capture: 7, offset: 0, hex: "ff7f" });
  c.receiveAudio({ capture: 8, offset: 2, hex: "0200" });
  const wav = c.audioWav(8, 4, 16000);
  const v = new DataView(await wav.arrayBuffer());
  expect(v.getInt16(44, true)).toBe(1);
  expect(v.getInt16(46, true)).toBe(2);
  c.receiveAudio({ capture: 8, offset: 8, hex: "0000" });
  expect(c.audioError(8)).toContain("序号");
  expect(() => c.audioWav(8, 4, 16000)).toThrow();
  c.clearAudio();
  expect(c.audioSize(8)).toBe(0);
});

it("recognizes legacy Xiaomi feature topology without guessing ATVV", () => {
  const refs = [attr({}), ...[4,5,6,7,8].map(id => attr({hex: `0${id}03`}))];
  expect(familyEvidence(refs)).toBe(3);
  expect(familyEvidence(refs.slice(0, -1))).toBeUndefined();
  expect(familyEvidence([...refs, attr({kind:1, uuid:"ab5e0001-5a21-4f05-bc7d-af01f617b664"})])).toBeUndefined();
});
