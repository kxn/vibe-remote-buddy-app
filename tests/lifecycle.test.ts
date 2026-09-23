import { it, expect, vi } from "vitest";
import { BuddyService, type Platform } from "../src/core/service";
import { OP } from "../src/core/session";
function harness() {
  const service=new BuddyService({} as Platform);
  Object.assign(service.snapshot,{status:"connected",info:{voice_owner:255},slots:[{peer_id:77,model:"test",state:0}]});
  vi.spyOn(service,"refresh").mockResolvedValue();
  const command=vi.fn(async(op:number)=>op===OP.OPERATION ?
    {operation_id:3,pending:false,result:0,peer_id:77}: {operation_id:3});
  Object.assign(service,{session:{command}});
  return {service,command};
}
it("binding success survives immediate remote sleep",async()=>{
  const {service}=harness();
  await expect(service.pair({age_ms:0,seen:performance.now(),candidate_id:4,scan_epoch:1} as any,()=>{})).resolves.toBeUndefined();
});
it("retry after adoption reuses its operation instead of taking the link twice",async()=>{
  const {service,command}=harness();const accepted=vi.fn();
  await service.adoptProbe("test",accepted);
  await service.adoptProbe("test",accepted);
  expect(command.mock.calls.filter(([op])=>op===OP.PROBE_ADOPT)).toHaveLength(1);
  expect(accepted).toHaveBeenCalledTimes(2);
});

it("offline bindings with unsigned peer IDs can be removed", async () => {
  const {service, command} = harness();
  const slot = {slot: 2, peer_id: 3608444133, state: 1} as any;
  service.snapshot.slots = [slot];
  const config = {aliases: {[slot.peer_id]: "local"}, followers: {}, authorizations: {}};
  vi.spyOn(service, "boardConfig").mockReturnValue(config as any);
  vi.spyOn(service, "persist").mockResolvedValue();
  vi.mocked(service.refresh).mockImplementation(async () => {service.snapshot.slots = [];});
  await service.unbind(slot);
  expect(command).toHaveBeenCalledWith(OP.UNBIND, {slot: 2, peer_id: 3608444133});
  expect(service.snapshot.busy).toBe(false);
  expect(config.aliases).toEqual({});
});
it("failed unbind refreshes slots without concealing incomplete cleanup", async () => {
  const {service, command} = harness();
  const slot = {slot: 2, peer_id: 3608444133, state: 1} as any;
  service.snapshot.slots = [slot];
  command.mockImplementation(async (op: number) => op === OP.OPERATION
    ? {operation_id: 3, pending: false, result: 10, uncertain: true} as any
    : {operation_id: 3});
  vi.mocked(service.refresh).mockImplementation(async () => {service.snapshot.slots = [];});
  await expect(service.unbind(slot)).rejects.toThrow("操作结果不确定");
  expect(service.refresh).toHaveBeenCalledTimes(1);
  expect(service.snapshot.slots).toEqual([]);
  expect(service.snapshot.busy).toBe(false);
});

it("limits new adoption to two while retaining four legacy bindings for deletion", async () => {
  const { service, command } = harness();
  Object.assign(service.snapshot.info!, { max_remotes: 2, slots: 4, lifecycle_api: 2, probe_api: 1, probe_voice_api: 5 });
  service.snapshot.slots = [0,1,2,3].map(slot => ({slot,peer_id:100+slot,state:1} as any));
  await expect(service.beginProbe()).rejects.toThrow("最多可添加 2 个遥控器");
  expect(command).not.toHaveBeenCalled();
  service.snapshot.slots = service.snapshot.slots.slice(2);
  await expect(service.beginProbe()).rejects.toThrow("最多可添加 2 个遥控器");
  service.snapshot.slots.pop();
  await service.beginProbe();
  expect(command).toHaveBeenCalledWith(OP.PROBE_BEGIN);
});
