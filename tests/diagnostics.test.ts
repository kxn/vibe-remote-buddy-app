import { it, expect, vi } from "vitest";
import { BuddyService, type Platform } from "../src/core/service";
import { DeviceError, OP } from "../src/core/session";
it("diagnostics includes audio, USB, links and history even with no faults", async () => {
  const service = new BuddyService({} as Platform);
  const command = vi.fn(async (op: number, q: {index: number}) => {
    expect(op).toBe(OP.STATS);
    if ([1,2,3,4,8,9,10,17].includes(q.index)) throw new DeviceError(6,op,{});
    return {value:q.index};
  });
  Object.assign(service,{session:{command}});
  const result = await service.diagnostics();
  expect(result).toContainEqual({index:5,data:{value:5}});
  expect(result).toContainEqual({index:6,data:{value:6}});
  expect(result).toContainEqual({index:7,data:{value:7}});
  expect(result).toContainEqual({index:16,data:{value:16}});
  expect(command.mock.calls.some(([,q])=>q.index===18)).toBe(false);
});
it("diagnostics propagates transport failures", async () => {
  const service = new BuddyService({} as Platform);
  Object.assign(service,{session:{command:async()=>{throw Error("transport lost")}}});
  await expect(service.diagnostics()).rejects.toThrow("transport lost");
});
