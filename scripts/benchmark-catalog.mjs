import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const root=resolve(import.meta.dirname,"..");
async function load(file) {
  const b=await build({entryPoints:[join(root,file)],bundle:true,write:false,format:"esm",platform:"node"});
  return import("data:text/javascript;base64,"+Buffer.from(b.outputFiles[0].contents).toString("base64"));
}
const {resolveCatalog,compileCatalog}=await load("src/core/catalog.ts"),{crc32c}=await load("src/core/wire.ts");
const index=JSON.parse(readFileSync(join(root,"resources/catalog/catalog.json")));
const base=resolveCatalog(index.resources.map(r=>JSON.parse(readFileSync(join(root,"resources/catalog",r.path)))));
for(const scenario of ["captured", "shared-1024", "distinct-map-1024"]) {
  const models=scenario==="captured"?base:Array.from({length:1024},(_,i)=>{
    const m=structuredClone(base[i%base.length]);m.model.id=`scale.model-${i}`;
    if(scenario==="distinct-map-1024") {
      const old=m.fingerprints[0].required.report_map;
      // Synthetic trailing Usage Page differentiates Maps; this is not captured hardware.
      const raw=Buffer.concat([Buffer.from(old.hex,"hex"),Buffer.from([6,i&255,i>>8])]);
      m.fingerprints[0].required.report_map={hex:raw.toString("hex"),length:raw.length,crc32c:crc32c(raw).toString(16).padStart(8,"0"),sha256:createHash("sha256").update(raw).digest("hex")};
    }
    return m;
  });
  const image=compileCatalog(models,1,2);
  if(process.argv[2]) {
    const output=resolve(process.argv[2]);mkdirSync(output,{recursive:true});
    writeFileSync(join(output,`${scenario}.bin`),image.bytes);
  }
  console.log(JSON.stringify({scenario,models:image.count,bytes:image.bytes.length,indexBytes:image.indexBytes,capacity:576*1024}));
  if(image.bytes.length>576*1024)throw Error(`${scenario} exceeds 4 MB target catalog bank`);
}
