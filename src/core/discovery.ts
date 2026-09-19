import type { Candidate } from "./types";

export const SCAN_DURATION_MS = 30000;
// A proximity filter, not a distance estimate or a protocol identifier.
export const PAIR_MIN_RSSI = -55;
export function isBoundCandidate(c: Candidate): boolean {
  return (
    Number.isInteger(c.bound_slot) && c.bound_slot >= 0 && c.bound_slot < 4
  );
}
export function visibleCandidates(items: Candidate[]): Candidate[] {
  return items.filter(
    (c) =>
      c.connectable &&
      (c.known || isBoundCandidate(c)) &&
      c.rssi >= PAIR_MIN_RSSI &&
      c.rssi <= 0 &&
      c.age_ms < 5000,
  );
}
export interface NearbyCandidate { connectable: boolean; rssi: number; age_ms: number }
/** Shared admission, hysteresis and stable ranking for both discovery screens. */
export class NearbyCandidates<T extends NearbyCandidate> {
  private items = new Map<string, T>();
  private rank = new Map<string, number>();
  constructor(private key: (row:T)=>string, private accept:(row:T)=>boolean = ()=>true) {}
  update(list:T[]):T[] {
    const fresh = new Map(list.filter(c => c.connectable && Number.isFinite(c.rssi) &&
      c.rssi <= 0 && c.age_ms < 5000 && this.accept(c)).map(c=>[this.key(c),c]));
    for (const [id] of this.items) {
      const c = fresh.get(id);
      if (!c || c.rssi < PAIR_MIN_RSSI-5) { this.items.delete(id); this.rank.delete(id); }
      else this.items.set(id,c);
    }
    for(const [id,c] of fresh) if(!this.items.has(id) && c.rssi >= PAIR_MIN_RSSI) {
      this.items.set(id,c); this.rank.set(id,c.rssi);
    }
    return [...this.items.entries()].sort((a,b)=>this.rank.get(b[0])!-this.rank.get(a[0])!).map(([,c])=>c);
  }
  clear() { this.items.clear(); this.rank.clear(); }
}
export class PairCandidates extends NearbyCandidates<Candidate> {
  constructor(includeUnknown:()=>boolean=()=>false) {
    super(c=>`${c.scan_epoch}:${c.candidate_id}`, c=>c.known || isBoundCandidate(c) || includeUnknown());
  }
}
interface DiscoveryPort {
  scan(renew?: boolean): Promise<{ scan_epoch: number }>;
  candidates(epoch: number): Promise<Candidate[]>;
  stopScan(): Promise<void>;
}
/** Stop joins in-flight reads/start and sends STOP before callers may pair or restart. */
export class Discovery {
  private stopped = false;
  private task?: Promise<void>;
  constructor(private port: DiscoveryPort, private includeUnknown:()=>boolean=()=>false) {}
  start(update: (items: Candidate[]) => void): Promise<void> {
    return (this.task ??= this.run(update));
  }
  private async run(update: (items: Candidate[]) => void) {
    let started = false;
    try {
      update([]);
      let epoch: number | undefined;
      let stable = new PairCandidates(this.includeUnknown);
      while (!this.stopped) {
        const { scan_epoch } = await this.port.scan(started);
        if (epoch !== undefined && epoch !== scan_epoch) {
          stable = new PairCandidates(this.includeUnknown);
          if (!this.stopped) update([]);
        }
        epoch = scan_epoch;
        started = true;
        // Renew before expiration, preserving the device list and selection.
        const end = performance.now() + SCAN_DURATION_MS / 2;
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
