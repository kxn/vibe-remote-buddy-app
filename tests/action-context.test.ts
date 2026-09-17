import { it, expect, vi } from "vitest";
import { BuddyService, type Platform } from "../src/core/service";
import { OP } from "../src/core/session";

function harness() {
  const run = vi.fn(async () => {});
  const service = new BuddyService({run} as unknown as Platform);
  service.snapshot.board = {serial: "board"} as never;
  const action = {kind: "input" as const, profile: "chatgpt", target: "", label: "ChatGPT"};
  Object.assign(service.boardConfig(), {actions: {1: action}, authorizations: {"101:7": 1, "202:7": 1}});
  const command = vi.fn(async (op: number, q: any) => {
    if (op === OP.SLOT) return {slot: q.slot, peer_id: q.slot === 0 ? 101 : 202, generation: 3, state: 5};
    if (op === OP.MAP_GET && q.key === 2) return {key: 2, kind: 3, modifiers: q.peer_id === 101 ? 64 : 9, value: 0, revision: 1};
    return {key: q.key, kind: 4, value: 1};
  });
  const internal = service as unknown as { session: unknown; action(e: Record<string, unknown>): Promise<void> };
  internal.session = {command};
  return {service, internal, command, run, action};
}
it("reads the triggering peer's current voice mapping even when both share one action", async () => {
  const h = harness();
  await h.internal.action({slot: 0, peer_id: 101, generation: 3, key: 7, action: 1});
  await h.internal.action({slot: 1, peer_id: 202, generation: 3, key: 7, action: 1});
  expect(h.run.mock.calls).toEqual([[h.action, "doubao"], [h.action, "wechat"]]);
  expect(h.command).toHaveBeenCalledWith(OP.MAP_GET, {slot: 1, peer_id: 202, key: 2});
});
it("does not execute a stale event after a slot has been reused", async () => {
  const h = harness();
  await h.internal.action({slot: 0, peer_id: 999, generation: 3, key: 7, action: 1});
  expect(h.run).not.toHaveBeenCalled();
});
it("does not execute after receiver loss while reading the voice mapping", async () => {
  const h = harness();
  const original = h.command.getMockImplementation()!;
  h.command.mockImplementation(async (op, q) => {
    const result = await original(op, q);
    if (op === OP.MAP_GET && q.key === 2) h.internal.session = undefined;
    return result;
  });
  await h.internal.action({slot: 0, peer_id: 101, generation: 3, key: 7, action: 1});
  expect(h.run).not.toHaveBeenCalled();
  expect(h.service.snapshot.error).toContain("接收器已变化");
});
