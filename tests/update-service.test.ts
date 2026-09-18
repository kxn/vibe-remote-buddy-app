import {it,expect,vi,afterEach} from "vitest";
import {BuddyService,type Platform} from "../src/core/service";
import type {FirmwarePackage} from "../src/core/firmware";
const mocks=vi.hoisted(()=>({transfer:vi.fn(async()=>{})}));
vi.mock("../src/core/firmware",()=>({
 validatePackage:async()=>new Uint8Array(),isNewer:()=>true,
 transferFirmware:mocks.transfer,
}));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();mocks.transfer.mockClear();});
function harness(){
 const board={serial:"receiver",path:"COM14",name:"Buddy"};
 const lock=vi.fn(async()=>{}),close=vi.fn(async()=>{});
 const platform={ports:async()=>[{...board,serial:"other"},board],updateLock:lock} as unknown as Platform;
 const s=new BuddyService(platform);
 const info={firmware:"buddy-0.5.0",bank:0,voice_owner:255,confirmed:true};
 Object.assign(s.snapshot,{board,info,status:"connected"});Object.assign(s,{session:{close}});
 const pkg={manifest:{version:"0.5.1"}} as FirmwarePackage;
 return {s,info,pkg,lock,close};
}
it("survives a second USB loss during boot and waits for confirmation",async()=>{
 vi.useFakeTimers();const h=harness();let connections=0,reads=0;
 vi.spyOn(h.s,"connect").mockImplementation(async port=>{
  expect(port.serial).toBe("receiver");connections++;Object.assign(h.s,{session:{close:async()=>{}}});
 });
 vi.spyOn(h.s,"refresh").mockImplementation(async()=>{
  if(++reads===1)throw Error("USB restarting again");
  Object.assign(h.s.snapshot,{info:{...h.info,firmware:"buddy-0.5.1",bank:1,confirmed:reads>=3}});
 });
 const result=h.s.updateFirmware(h.pkg);await vi.advanceTimersByTimeAsync(10000);await result;
 expect(connections).toBe(2);expect(reads).toBe(3);
 expect(h.s.snapshot.firmwareProgress).toEqual({phase:"更新完成",percent:100,active:false});
 expect(h.lock.mock.calls).toEqual([[true],[false]]);expect(h.s.snapshot.busy).toBe(false);
});
it("reports rollback as failure and releases the native exit lock",async()=>{
 vi.useFakeTimers();const h=harness();
 vi.spyOn(h.s,"connect").mockImplementation(async()=>{Object.assign(h.s,{session:{close:async()=>{}}});});
 vi.spyOn(h.s,"refresh").mockResolvedValue();
 const result=expect(h.s.updateFirmware(h.pkg)).rejects.toThrow("原版本");
 await vi.advanceTimersByTimeAsync(5000);await result;
 expect(h.s.snapshot.firmwareProgress?.active).toBe(false);
 expect(h.lock.mock.calls).toEqual([[true],[false]]);expect(h.s.snapshot.busy).toBe(false);
});
it("refuses updates during recording without acquiring a lock",async()=>{
 const h=harness();h.s.snapshot.info!.voice_owner=1;
 await expect(h.s.updateFirmware(h.pkg)).rejects.toThrow("录音");
 expect(h.lock).not.toHaveBeenCalled();expect(mocks.transfer).not.toHaveBeenCalled();
});
