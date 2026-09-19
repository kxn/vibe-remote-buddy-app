import { afterEach, expect, test, vi } from "vitest";
import { ProbeMicrophone } from "../src/core/probe-microphone";
afterEach(()=>vi.unstubAllGlobals());
test("ambiguous receiver inputs never record the default microphone",async()=>{
 const getUserMedia=vi.fn();vi.stubGlobal("navigator",{mediaDevices:{enumerateDevices:async()=>[1,2].map(n=>({kind:"audioinput",label:"Remote USB S3",deviceId:String(n)})),getUserMedia}});
 await expect(new ProbeMicrophone().start()).rejects.toThrow("多只");expect(getUserMedia).not.toHaveBeenCalled();
});
test("cancel during device opening closes the arriving stream",async()=>{
 const stop=vi.fn();let deliver!:(v:unknown)=>void;
 vi.stubGlobal("navigator",{mediaDevices:{enumerateDevices:async()=>[{kind:"audioinput",label:"Remote USB S3",deviceId:"receiver"}],getUserMedia:()=>new Promise(r=>{deliver=r})}});
 const mic=new ProbeMicrophone(),pending=mic.start();await Promise.resolve();mic.cancel();deliver({getTracks:()=>[{stop}]});
 await expect(pending).rejects.toThrow("取消");expect(stop).toHaveBeenCalledOnce();
});
