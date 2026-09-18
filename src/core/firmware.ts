import type { Info } from "./types";
import { sleep } from "./session";
export const UPDATE = { STATUS:0x420, BEGIN:0x421, DATA:0x422, FINISH:0x423, ACTIVATE:0x424, ABORT:0x425 };
export interface FirmwarePackage {
 manifest: { format:1; target:string; version:string; size:number; sha256:string; data_min:number; data_max:number; notes:string };
 image:number[];
}
export interface UpdateState { state:number; offset:number; error:number; confirmed:boolean; bank:number }
export type Progress={ phase:string; percent:number; active:boolean };
export interface Commands { command<T=Record<string,unknown>>(opcode:number,body?:Record<string,unknown>):Promise<T> }
const versionParts=(v:string)=>{const m=/^(?:buddy-)?(\d+)\.(\d+)\.(\d+)$/.exec(v);return m?m.slice(1).map(Number):null;};
export function isNewer(next:string,current:string):boolean {
 const a=versionParts(next),b=versionParts(current);if(!a||!b)return false;
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;
}
export async function validatePackage(pkg:FirmwarePackage,info:Info):Promise<Uint8Array> {
 const m=pkg?.manifest;
 if(info.update_api!==1)throw Error("此接收器需要先安装支持更新的固件");
 if(!m||m.format!==1||m.target!==info.target||!versionParts(m.version))throw Error("固件与接收器不匹配");
 if(!Number.isInteger(m.data_min)||!Number.isInteger(m.data_max)||info.schema===undefined||info.schema<m.data_min||info.schema>m.data_max)throw Error("配置版本不兼容");
 if(!info.confirmed||(info.bank!==0&&info.bank!==1)||!Number.isInteger(info.flash_bytes)||!Number.isInteger(info.psram_bytes)||info.flash_bytes!<16*1024*1024||info.psram_bytes!<8*1024*1024)throw Error("接收器尚未就绪或硬件不支持");
 if(!Array.isArray(pkg.image)||!Number.isInteger(m.size)||m.size<288||m.size>2*1024*1024||pkg.image.length!==m.size||pkg.image.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error("固件文件不完整");
 const image=Uint8Array.from(pkg.image),view=new DataView(image.buffer);
 if(image[0]!==0xe9||view.getUint16(12,true)!==9)throw Error("固件不是 ESP32-S3 镜像");
 const text=(start:number,n:number)=>new TextDecoder().decode(image.slice(start,start+n)).split("\0")[0];
 if(view.getUint32(32,true)!==0xabcd5432||text(80,32)!=="buddy_s3_ab1"||text(48,32)!==m.version)throw Error("固件布局或版本不匹配");
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",image))).map(v=>v.toString(16).padStart(2,"0")).join("");
 if(hash!==m.sha256)throw Error("固件校验失败");
 return image;
}
export async function transferFirmware(s:Commands,pkg:FirmwarePackage,image:Uint8Array,progress:(p:Progress)=>void,cancelled:()=>boolean) {
 let activated=false;
 try {
  const m=pkg.manifest;
  const begin=await s.command<{chunk:number}>(UPDATE.BEGIN,{target:m.target,version:m.version,size:m.size,sha256:m.sha256,data_min:m.data_min,data_max:m.data_max});
  if(begin.chunk!==192)throw Error("更新传输参数不支持");
  const deadline=Date.now()+20000;
  while(true) {
   if(cancelled())throw Error("更新已取消");
   const status=await s.command<UpdateState>(UPDATE.STATUS);
   if(status.state===3)break;
   if(status.state===6)throw Error(`接收器准备失败：${status.error}`);
   if(Date.now()>deadline)throw Error("接收器准备超时");
   progress({phase:"正在准备",percent:0,active:true});await sleep(100);
  }
  for(let offset=0;offset<image.length;offset+=192) {
   if(cancelled())throw Error("更新已取消");
   const chunk=image.slice(offset,offset+192),hex=Array.from(chunk).map(v=>v.toString(16).padStart(2,"0")).join("");
   const reply=await s.command<{offset:number}>(UPDATE.DATA,{offset,hex});
   if(reply.offset!==offset+chunk.length)throw Error("固件传输位置不一致");
   progress({phase:"正在写入",percent:Math.floor(reply.offset/image.length*95),active:true});
  }
  progress({phase:"正在校验",percent:96,active:true});
  await s.command(UPDATE.FINISH);
  if(cancelled())throw Error("更新已取消");
  // Activation may reboot before its response arrives. The caller must reconcile
  // by serial/version/bank; never assume a lost response means activation failed.
  activated=true;
  try {await s.command(UPDATE.ACTIVATE);} catch { /* reconcile after reconnect */ }
 } catch(e) {if(!activated)try{await s.command(UPDATE.ABORT);}catch{}throw e;}
}
