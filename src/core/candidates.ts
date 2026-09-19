import { OP } from "./session";
export type CandidateCommand = <T>(op: number, body: Record<string, unknown>) => Promise<T>;
/** One bounded cursor for both discovery clients. Empty slots cost no USB round trip. */
export async function* candidateStream<T extends { candidate_id: number }>(
  command: CandidateCommand, cancelled: () => boolean = () => false,
): AsyncGenerator<T> {
  let cursor = 0;
  while (cursor < 24 && !cancelled()) {
    const row = await command<T & { next: number }>(OP.CANDIDATE, { cursor });
    if (!Number.isInteger(row.next) || row.next <= cursor || row.next > 24)
      throw Error("请更新接收器固件");
    cursor = row.next;
    if (!cancelled() && row.candidate_id) yield row;
  }
}
