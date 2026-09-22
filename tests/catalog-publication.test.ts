import {it, expect} from "vitest";
import {BuddyService} from "../src/core/service";
import type {Platform} from "../src/core/service";
import {remoteModels, modelOrigins} from "../src/core/models";
import source from "../resources/remotes/xiaomi.rc003/model.json";

it("failed reload keeps the complete previous catalog visible", async()=>{
 let sources:any[]=[{model:structuredClone(source),source:"good"}];
 let rejectOverrides=false;
 const service=new BuddyService({
  models:async()=>sources,
  overrides:async()=>{if(rejectOverrides)throw Error("override unavailable");return [];},
 } as unknown as Platform);
 await service.reloadModels(false);
 const original=remoteModels.get(source.id);
 const catalog=service.modelCatalog;
 const origins=[...modelOrigins];
 sources=[{model:{...source,id:"invalid",keys:[]},source:"bad"}];
 await expect(service.reloadModels(false)).rejects.toThrow();
 expect(remoteModels.get(source.id)).toBe(original);
 expect(service.modelCatalog).toBe(catalog);
 expect([...modelOrigins]).toEqual(origins);
 sources=[{model:{...source,title:"new title"},source:"new"}];
 rejectOverrides=true;
 await expect(service.reloadModels(false)).rejects.toThrow("override unavailable");
 expect(remoteModels.get(source.id)).toBe(original);
 expect(service.modelCatalog).toBe(catalog);
 rejectOverrides=false;
 await service.reloadModels(false);
 expect(remoteModels.get(source.id)?.title).toBe("new title");
});

