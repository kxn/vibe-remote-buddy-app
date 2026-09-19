import { it, expect } from "vitest";
import { candidateStream, type CandidateCommand } from "../src/core/candidates";
it("skips empty slots and stops immediately after a selected candidate", async () => {
  const cursors: number[] = [];
  const command = (async (_: number, body: Record<string, unknown>) => {
    cursors.push(body.cursor as number);
    return {candidate_id: 9, next: 20};
  }) as CandidateCommand;
  for await (const c of candidateStream(command)) { expect(c.candidate_id).toBe(9); break; }
  expect(cursors).toEqual([0]);
});
it("rejects stalled cursors and suppresses cancelled replies", async () => {
  const consume = async (command: CandidateCommand, cancel=()=>false) => {
    const out=[]; for await(const c of candidateStream(command,cancel)) out.push(c); return out;
  };
  await expect(consume((async()=>({next:0})) as CandidateCommand)).rejects.toThrow();
  let cancelled=false;
  expect(await consume((async()=>{cancelled=true;return {next:24,candidate_id:1};}) as CandidateCommand,()=>cancelled)).toEqual([]);
});
