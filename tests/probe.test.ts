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
      candidate_id: id,
      address: `remote-${id}`,
      address_type: 1,
      rssi,
      age_ms,
    }) as ProbeCandidate;
  it("filters weak and invalid signals while retaining unknown nearby devices", () => {
    const list = new ProbeCandidates();
    expect(
      list.update([candidate(1, -90), candidate(2, -50), candidate(3, 127)]),
    ).toEqual([candidate(2, -50)]);
  });
  it("preserves row order across signal fluctuations and candidate ID replacement", () => {
    const list = new ProbeCandidates();
    list.update([candidate(1, -40), candidate(2, -55)]);
    expect(
      list.update([candidate(2, -30), candidate(1, -60)]).map((c) => c.address),
    ).toEqual(["remote-1", "remote-2"]);
    expect(
      list
        .update([{ ...candidate(1, -60), candidate_id: 44 }, candidate(2, -30)])
        .map((c) => c.candidate_id),
    ).toEqual([44, 2]);
  });
  it("uses hysteresis and ages devices out without constantly reordering", () => {
    const list = new ProbeCandidates();
    list.update([candidate(1, -64)]);
    expect(list.update([candidate(1, -67)])).toHaveLength(1);
    expect(list.update([candidate(1, -71)])).toHaveLength(0);
    expect(list.update([candidate(1, -67)])).toHaveLength(0);
    list.update([candidate(1, -60)]);
    expect(list.update([candidate(1, -60, 5000)])).toHaveLength(0);
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
