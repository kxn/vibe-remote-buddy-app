import {it,expect,vi} from 'vitest';
import {BuddyService,type Platform} from '../src/core/service';
import {OP,DeviceError} from '../src/core/session';
import type {Slot,Mapping} from '../src/core/types';
function setup(states:number[]) {
 const service=new BuddyService({save:async()=>{}} as unknown as Platform);
 const slot={slot:0,peer_id:123,generation:1,state:5} as Slot;
 service.snapshot={...service.snapshot,status:'connected',board:{serial:'board'} as never,info:{voice_owner:255} as never,slots:[slot]};
 let reads=0;
 const command=vi.fn(async(op:number)=>{
  if(op===OP.SLOT)return {...slot,state:states[Math.min(reads++,states.length-1)]};
  if(op===OP.CATALOG)throw new DeviceError(6,op,{});
  if(op===OP.MAP_GET)return {key:2,kind:3,modifiers:0,value:44,revision:2};
  return {};
 });
 (service as unknown as {session:unknown}).session={command};
 return {service,slot,command};
}
it('does not read mappings from an offline remote',async()=>{
 const h=setup([1]);await expect(h.service.keys(h.slot)).rejects.toThrow('唤醒');
 expect(h.command.mock.calls.map(c=>c[0])).toEqual([OP.SLOT]);
});
it('rejects a disconnect during configuration reads',async()=>{
 const h=setup([5,1]);await expect(h.service.keys(h.slot)).rejects.toThrow('连接已变化');
});
it('does not overwrite a newer mapping revision',async()=>{
 const h=setup([5]);await expect(h.service.saveMap(h.slot,{key:2,kind:3,modifiers:0,value:44,revision:1} as Mapping)).rejects.toThrow('已变化');
 expect(h.command.mock.calls.some(c=>c[0]===OP.MAP_SET)).toBe(false);
 expect(h.service.snapshot.busy).toBe(false);
});
