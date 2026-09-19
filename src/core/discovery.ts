import type { Candidate } from "./types";

export const SCAN_DURATION_MS = 30000;
// A proximity filter, not a distance estimate or a protocol identifier.
export const PAIR_MIN_RSSI = -65;
export function isBoundCandidate(c: Candidate): boolean {
  return (
    Number.isInteger(c.bound_slot) && c.bound_slot >= 0 && c.bound_slot < 4
  );
}
export function visibleCandidates(items: Candidate[]): Candidate[] {
  return items.filter(
    (c) =>
      (c.known || isBoundCandidate(c)) &&
      c.rssi >= PAIR_MIN_RSSI &&
      c.rssi <= 0 &&
      c.age_ms < 5000,
  );
}
/** Rank by signal at admission, never by later RSSI fluctuations. */
export class PairCandidates {
  private items = new Map<number, Candidate>();
  private rank = new Map<number, number>();
  update(list: Candidate[]) {
    const fresh = new Map(
      list
        .filter(
          (c) =>
            (c.known || isBoundCandidate(c)) &&
            Number.isFinite(c.rssi) &&
            c.rssi <= 0 &&
            c.age_ms < 5000,
        )
        .map((c) => [c.candidate_id, c]),
    );
    for (const [id] of this.items) {
      const c = fresh.get(id);
      if (!c || c.rssi < PAIR_MIN_RSSI - 5) {
        this.items.delete(id);
        this.rank.delete(id);
      } else this.items.set(id, c);
    }
    for (const [id, c] of fresh)
      if (!this.items.has(id) && c.rssi >= PAIR_MIN_RSSI) {
        this.items.set(id, c);
        this.rank.set(id, c.rssi);
      }
    return [...this.items.values()].sort(
      (a, b) => this.rank.get(b.candidate_id)! - this.rank.get(a.candidate_id)!,
    );
  }
}
interface DiscoveryPort {
  scan(): Promise<{ scan_epoch: number }>;
  candidates(epoch: number): Promise<Candidate[]>;
  stopScan(): Promise<void>;
}
/** Stop joins in-flight reads/start and sends STOP before callers may pair or restart. */
export class Discovery {
  private stopped = false;
  private task?: Promise<void>;
  constructor(private port: DiscoveryPort) {}
  start(update: (items: Candidate[]) => void): Promise<void> {
    return (this.task ??= this.run(update));
  }
  private async run(update: (items: Candidate[]) => void) {
    let started = false;
    try {
      while (!this.stopped) {
        update([]); // New epochs invalidate candidate IDs and selection.
        const { scan_epoch } = await this.port.scan();
        started = true;
        const stable = new PairCandidates();
        const end = performance.now() + SCAN_DURATION_MS;
        while (!this.stopped && performance.now() < end) {
          const items = await this.port.candidates(scan_epoch);
          if (!this.stopped) update(stable.update(items));
          if (!this.stopped) await new Promise((r) => setTimeout(r, 500));
        }
      }
    } finally {
      if (started) await this.port.stopScan();
    }
  }
  async stop() {
    this.stopped = true;
    await this.task;
  }
}
