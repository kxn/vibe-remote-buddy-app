import { it, expect, vi } from "vitest";
import { BuddyService, type Platform } from "../src/core/service";
import { OP, DeviceError } from "../src/core/session";
import type { Slot, Mapping } from "../src/core/types";
function setup(states: number[]) {
  const service = new BuddyService({
    save: async () => {},
  } as unknown as Platform);
  const slot = { slot: 0, peer_id: 123, generation: 1, state: 5 } as Slot;
  service.snapshot = {
    ...service.snapshot,
    status: "connected",
    board: { serial: "board" } as never,
    info: { voice_owner: 255 } as never,
    slots: [slot],
  };
  let reads = 0;
  const command = vi.fn(async (op: number) => {
    if (op === OP.SLOT)
      return { ...slot, state: states[Math.min(reads++, states.length - 1)] };
    if (op === OP.CATALOG) throw new DeviceError(6, op, {});
    if (op === OP.MAP_GET)
      return { key: 2, kind: 3, modifiers: 0, value: 44, revision: 2 };
    return {};
  });
  (service as unknown as { session: unknown }).session = { command };
  return { service, slot, command };
}
it("does not read mappings from an offline remote", async () => {
  const h = setup([1]);
  await expect(h.service.keys(h.slot)).rejects.toThrow("唤醒");
  expect(h.command.mock.calls.map((c) => c[0])).toEqual([OP.SLOT]);
});
it("rejects a disconnect during configuration reads", async () => {
  const h = setup([5, 1]);
  await expect(h.service.keys(h.slot)).rejects.toThrow("连接已变化");
});
it("does not overwrite a newer mapping revision", async () => {
  const h = setup([5]);
  await expect(
    h.service.saveMap(h.slot, {
      key: 2,
      kind: 3,
      modifiers: 0,
      value: 44,
      revision: 1,
    } as Mapping),
  ).rejects.toThrow("已变化");
  expect(h.command.mock.calls.some((c) => c[0] === OP.MAP_SET)).toBe(false);
  expect(h.service.snapshot.busy).toBe(false);
});

it("revokes local action permissions before a snapshot restore can partially fail", async () => {
  const h = setup([5]);
  h.slot.model = "example";
  h.slot.map_revision = 3;
  h.service.snapshot.info = {
    ...h.service.snapshot.info,
    catalog_api: 2,
  } as never;
  h.service.settings.boards.board = {
    aliases: {},
    actions: {},
    authorizations: { "123:8": 7 },
    shared: {},
    followers: {},
  };
  h.command.mockImplementation((async (op: number) => {
    if (op === OP.SLOT) return { ...h.slot };
    if (op === OP.CONFIG_BEGIN) throw Error("write failed");
    return {};
  }) as never);
  const backup = JSON.parse(JSON.stringify(h.service.settings));
  backup.boards.board.bindings = [
    { peer_id: 123, model: "example", hex: "00" },
  ];
  await expect(h.service.importSettings(backup)).rejects.toThrow(
    "write failed",
  );
  expect(h.service.settings.boards.board.authorizations).toEqual({});
});


it("rejects the voice toggle before any writes on older firmware", async () => {
  const h = setup([5]);
  await expect(h.service.saveMap(h.slot, {
    key: 8, kind: 6, modifiers: 0, value: 0, revision: 2,
  } as Mapping)).rejects.toThrow("更新接收器固件");
  expect(h.command).not.toHaveBeenCalled();
});

it("resolves an action draft before applying the shared binding validation", async () => {
 const h=setup([5]);let actual={key:8,kind:1,modifiers:0,value:40,revision:2} as Mapping;
 h.command.mockImplementation((async(op:number,body:any)=>{
  if(op===OP.SLOT)return h.slot;
  if(op===OP.MAP_GET)return {...actual};
  if(op===OP.MAP_SET){actual={...body,revision:body.revision+1};return {};}
  return {};
 }) as never);
 vi.spyOn(h.service,"refresh").mockResolvedValue();
 const saved=await h.service.saveMap(h.slot,{...actual,kind:4,value:0},{kind:"command",target:"task_view",label:"任务视图"});
 expect(saved.kind).toBe(4);expect(saved.value).toBeGreaterThan(0);
 expect(h.service.settings.boards.board.authorizations["123:8"]).toBe(saved.value);
});
