import { describe, it, expect, vi, afterEach } from "vitest";
import {
  Discovery,
  PairCandidates,
  visibleCandidates,
  isBoundCandidate,
} from "../src/core/discovery";
import type { Candidate } from "../src/core/types";
const candidate = (patch: Partial<Candidate> = {}): Candidate => ({
  connectable: true,
  candidate_id: 1,
  scan_epoch: 1,
  name: "remote",
  rssi: -45,
  known: true,
  bound_slot: -1,
  age_ms: 0,
  seen: 0,
  ...patch,
});
afterEach(() => vi.useRealTimers());
describe("discovery", () => {
  it("does not label either unbound sentinel as added", () => {
    for (const slot of [-1, 255, 4, 0.5])
      expect(isBoundCandidate(candidate({ bound_slot: slot }))).toBe(false);
    for (const slot of [0, 3])
      expect(isBoundCandidate(candidate({ bound_slot: slot }))).toBe(true);
  });
  it("requires a supported model or bond plus fresh nearby signal; never merges by name", () => {
    const items = [
      candidate(),
      candidate({ candidate_id: 2 }),
      candidate({ known: false, name: "" }),
      candidate({ rssi: -76 }),
      candidate({ age_ms: 5000 }),
      candidate({ rssi: 127 }),
      candidate({ known: false, bound_slot: 0 }),
    ];
    expect(visibleCandidates(items)).toEqual([items[0], items[1], items[6]]);
  });
  it("renews scans beyond 30 seconds and stops without another renewal", async () => {
    vi.useFakeTimers();
    const epoch = 1;
    const port = {
      scan: vi.fn(async () => ({ scan_epoch: epoch })),
      candidates: vi.fn(async (e: number) => [candidate({ scan_epoch: e })]),
      stopScan: vi.fn(async () => {}),
    };
    const update = vi.fn();
    const scan = new Discovery(port);
    const task = scan.start(update);
    await vi.advanceTimersByTimeAsync(16000);
    expect(port.scan).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.filter(([items]) => items.length === 0)).toHaveLength(1);
    const stop = scan.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stop;
    await task;
    await vi.advanceTimersByTimeAsync(60000);
    expect(port.scan).toHaveBeenCalledTimes(2);
    expect(port.stopScan).toHaveBeenCalledTimes(1);
  });
  it("joins a pending scan start before stopping, without publishing late results", async () => {
    let resolve!: (value: { scan_epoch: number }) => void;
    const port = {
      scan: vi.fn(
        () => new Promise<{ scan_epoch: number }>((r) => (resolve = r)),
      ),
      candidates: vi.fn(async () => [candidate()]),
      stopScan: vi.fn(async () => {}),
    };
    const update = vi.fn();
    const scan = new Discovery(port);
    const task = scan.start(update);
    const stop = scan.stop();
    expect(port.stopScan).not.toHaveBeenCalled();
    resolve({ scan_epoch: 1 });
    await stop;
    await task;
    expect(port.candidates).not.toHaveBeenCalled();
    expect(port.stopScan).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

it("ranks new nearby devices by admission strength, retains order and hysteresis", () => {
  const list = new PairCandidates();
  const ids = (rows: Candidate[]) => rows.map((c) => c.candidate_id);
  expect(
    ids(
      list.update([
        candidate({ candidate_id: 1, rssi: -50 }),
        candidate({ candidate_id: 2, rssi: -40 }),
        candidate({ candidate_id: 3, rssi: -81 }),
      ]),
    ),
  ).toEqual([2, 1]);
  expect(
    ids(
      list.update([
        candidate({ candidate_id: 1, rssi: -35 }),
        candidate({ candidate_id: 2, rssi: -78 }),
        candidate({ candidate_id: 4, rssi: -30 }),
      ]),
    ),
  ).toEqual([4, 2, 1]);
  expect(
    ids(
      list.update([
        candidate({ candidate_id: 1, rssi: -81 }),
        candidate({ candidate_id: 4, rssi: -35 }),
      ]),
    ),
  ).toEqual([4]);
});

it("hides nonconnectable advertisements even with a strong signal", () => {
 const c=candidate({connectable:false,rssi:-25});
 expect(visibleCandidates([c])).toEqual([]);
 expect(new PairCandidates().update([c])).toEqual([]);
});

it("explicit model selection admits unknown candidates only at the relaxed proximity threshold",()=>{
 const list=new PairCandidates(()=>true);
 expect(list.update([
  candidate({known:false}),
  candidate({candidate_id:2,known:false,rssi:-75}),
  candidate({candidate_id:3,known:false,rssi:-76}),
 ]).map(c=>c.candidate_id)).toEqual([1,2]);
});
