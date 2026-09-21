import {it,expect,vi} from "vitest";
import {validatePackage,isNewer,transferFirmware,UPDATE,type FirmwarePackage,type Commands} from "../src/core/firmware";
import type {Info} from "../src/core/types";
const info={update_api:1,target:"s3-o8-ab1",schema:1,bank:0,confirmed:true,flash_bytes:16777216,psram_bytes:8388608} as Info;
async function fixture():Promise<FirmwarePackage>{
 const image=new Uint8Array(384),view=new DataView(image.buffer);image[0]=0xe9;view.setUint16(12,9,true);view.setUint32(32,0xabcd5432,true);
 image.set(new TextEncoder().encode("0.5.1"),48);image.set(new TextEncoder().encode("buddy_s3_o8_ab1"),80);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",image))).map(v=>v.toString(16).padStart(2,"0")).join("");
 return {manifest:{format:1,target:info.target!,version:"0.5.1",size:384,sha256,data_min:1,data_max:1,notes:""},image:Array.from(image)};
}
it("validates bundled image and rejects wrong chip, corrupt hash and schema",async()=>{
 const p=await fixture();expect((await validatePackage(p,info)).length).toBe(384);
 await expect(validatePackage(p,{...info,target:"c6"})).rejects.toThrow("不匹配");
 await expect(validatePackage(p,{...info,schema:2})).rejects.toThrow("不兼容");
 await expect(validatePackage(p,{...info,flash_bytes:undefined})).rejects.toThrow("硬件");
 p.image[300]^=1;await expect(validatePackage(p,info)).rejects.toThrow("校验");p.image[12]=13;await expect(validatePackage(p,info)).rejects.toThrow("S3");
});
it("never offers an automatic downgrade or compares versions lexically",()=>{
 expect(isNewer("0.10.0","buddy-0.9.0")).toBe(true);
 expect(isNewer("0.5.0","buddy-0.5.0")).toBe(false);
 expect(isNewer("0.4.0","buddy-0.5.0")).toBe(false);
 expect(isNewer("bad","buddy-0.5.0")).toBe(false);
});
it("finishes and activates only after all bytes acknowledged",async()=>{
 const p=await fixture(),calls:number[]=[];
 const command=vi.fn(async(op:number,q:any)=>{calls.push(op);if(op===UPDATE.BEGIN)return {chunk:192};if(op===UPDATE.STATUS)return {state:3};if(op===UPDATE.DATA)return {offset:q.offset+q.hex.length/2};return {};});
 await transferFirmware({command} as Commands,p,Uint8Array.from(p.image),()=>{},()=>false);
 expect(calls).toEqual([UPDATE.BEGIN,UPDATE.STATUS,UPDATE.DATA,UPDATE.DATA,UPDATE.FINISH,UPDATE.ACTIVATE]);
});
it("cancels without switching boot partition",async()=>{
 const p=await fixture(),command=vi.fn(async()=>({chunk:192}));
 await expect(transferFirmware({command} as unknown as Commands,p,Uint8Array.from(p.image),()=>{},()=>true)).rejects.toThrow("取消");
 expect(command.mock.calls.length).toBe(2);
});
it("rejects wrong offsets and aborts the incomplete upload",async()=>{
 const p=await fixture(),calls:number[]=[];
 const command=vi.fn(async(op:number)=>{calls.push(op);return op===UPDATE.BEGIN?{chunk:192}:op===UPDATE.STATUS?{state:3}:{offset:1};});
 await expect(transferFirmware({command} as Commands,p,Uint8Array.from(p.image),()=>{},()=>false)).rejects.toThrow("位置");
 expect(calls).not.toContain(UPDATE.ACTIVATE);expect(calls.at(-1)).toBe(UPDATE.ABORT);
});
it("lost activation response requires reconnect verification, not blind abort",async()=>{
 const p=await fixture(),calls:number[]=[];
 const command=vi.fn(async(op:number,q:any)=>{calls.push(op);if(op===UPDATE.ACTIVATE)throw Error("disconnected");return op===UPDATE.BEGIN?{chunk:192}:op===UPDATE.STATUS?{state:3}:op===UPDATE.DATA?{offset:q.offset+q.hex.length/2}:{};});
 await transferFirmware({command} as Commands,p,Uint8Array.from(p.image),()=>{},()=>false);expect(calls.at(-1)).toBe(UPDATE.ACTIVATE);
});

it("accepts 8MB Flash quad PSRAM but rejects relabelled octal images",async()=>{
 const p=await fixture();p.manifest.target="s3-q2-ab1";
 const q={...info,target:"s3-q2-ab1",flash_bytes:8388608,psram_bytes:2097152};
 await expect(validatePackage(p,q)).rejects.toThrow("布局");
 const image=Uint8Array.from(p.image);image.fill(0,80,112);image.set(new TextEncoder().encode("buddy_s3_q2_ab1"),80);p.image=Array.from(image);
 p.manifest.sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",image))).map(v=>v.toString(16).padStart(2,"0")).join("");
 expect((await validatePackage(p,q)).length).toBe(384);
 await expect(validatePackage(p,{...q,flash_bytes:4194304})).rejects.toThrow("硬件");
 await expect(validatePackage(p,{...q,psram_bytes:0})).rejects.toThrow("硬件");
});

it("validates the 4 MB target independently from 8 MB q2",async()=>{
 const p=await fixture();p.manifest.target="s3-q2-f4-ab2";p.image.fill(0,80,112);for(const [i,b] of new TextEncoder().encode("buddy_s3_q2_f4_ab2").entries())p.image[80+i]=b;
 const image=Uint8Array.from(p.image);p.manifest.size=image.length;p.manifest.sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",image))).map(v=>v.toString(16).padStart(2,"0")).join("");
 const small={...info,target:p.manifest.target,flash_bytes:4194304,psram_bytes:2097152};
 expect((await validatePackage(p,small)).length).toBe(image.length);
 await expect(validatePackage(p,{...small,target:"s3-q2-ab1"})).rejects.toThrow("不匹配");
 await expect(validatePackage(p,{...small,flash_bytes:2097152})).rejects.toThrow("硬件");
 p.manifest.size=0x140001;await expect(validatePackage(p,small)).rejects.toThrow("不完整");
});
