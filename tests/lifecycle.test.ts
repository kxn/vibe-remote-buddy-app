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
