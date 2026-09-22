import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  root,
  variants,
  json,
  writeJson,
  sha256,
  loadCatalog,
  validateFirmware,
  buildIdentity,
  sourceDigest,
} from "./release-inputs.mjs";
import { syncCatalog } from "./sync-catalog.mjs";
process.chdir(root);
const args = process.argv.slice(2),
  identity = buildIdentity();
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== `v${identity.version}`
)
  throw Error("Tag and application version differ");
if (process.env.GITHUB_ACTIONS && identity.dirty)
  throw Error("CI release source must be clean");
const prepared = path.join(root, "build/release-inputs");
// This fixed generated directory contains no user data.
fs.rmSync(prepared, { recursive: true, force: true });
fs.mkdirSync(prepared, { recursive: true });
const catalogDir = path.join(prepared, "catalog"),
  firmwareDir = path.join(prepared, "firmware");
let catalog;
if (args.includes("--offline")) {
  fs.cpSync(path.join(root, "resources/catalog"), catalogDir, {
    recursive: true,
  });
  catalog = loadCatalog(catalogDir);
} else catalog = await syncCatalog(catalogDir);
const source = path.resolve(
  process.env.BUDDY_FIRMWARE_DIR || path.join(root, "receiver-firmware"),
);
validateFirmware(source);
fs.mkdirSync(firmwareDir, { recursive: true });
fs.copyFileSync(
  path.join(source, "catalog.json"),
  path.join(firmwareDir, "catalog.json"),
);
const run = (program, args, env = process.env) =>
  execFileSync(program, args, { cwd: root, env, stdio: "inherit" });
const compiled = path.join(prepared, "catalog.bin");
run(process.execPath, [
  "scripts/compile-catalog.mjs",
  catalogDir,
  compiled,
  "1",
]);
const bytes = fs.readFileSync(compiled);
for (const variant of variants) {
  const destination = path.join(firmwareDir, variant);
  fs.mkdirSync(destination, { recursive: true });
  const install = json(path.join(source, variant, "install.json"));
  for (const name of ["manifest.json", ...install.files.map((f) => f.name)])
    fs.copyFileSync(
      path.join(source, variant, name),
      path.join(destination, name),
    );
  if (bytes.length > (variant === "q2-f4" ? 0x90000 : 0x180000))
    throw Error("Model catalog exceeds firmware partition");
  fs.writeFileSync(path.join(destination, "catalog.bin"), bytes);
  Object.assign(
    install.files.find((f) => f.name === "catalog.bin"),
    { size: bytes.length, sha256: sha256(bytes) },
  );
  writeJson(path.join(destination, "install.json"), install);
}
const firmware = validateFirmware(firmwareDir);
const info = {
  ...identity,
  built_at: new Date().toISOString(),
  source_digest: sourceDigest(),
  catalog: {
    version: catalog.version,
    commit: catalog.commit,
    index_sha256: sha256(
      fs.readFileSync(path.join(catalogDir, "catalog.json")),
    ),
    image_sha256: sha256(bytes),
  },
  firmware,
};
writeJson(path.join(prepared, "build-info.json"), info);
writeJson(path.join(prepared, "tauri-config.json"), {
  version: identity.version,
});
if (args.includes("--prepare-only")) {
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}
const env = {
  ...process.env,
  PYTHONUTF8: "1",
  BUDDY_FIRMWARE_DIR: firmwareDir,
  BUDDY_CATALOG_DIR: catalogDir,
  BUDDY_BUILD_INFO: path.join(prepared, "build-info.json"),
};
run(process.env.PYTHON || "python", ["scripts/build-setup-helper.py"], env);
run(
  process.execPath,
  [
    "node_modules/@tauri-apps/cli/tauri.js",
    "build",
    "--no-bundle",
    "--features",
    "custom-protocol",
    "--config",
    path.join(prepared, "tauri-config.json"),
  ],
  env,
);
info.executable_sha256 = sha256(
  fs.readFileSync(
    path.join(root, "src-tauri/target/release/vibe-remote-buddy.exe"),
  ),
);
writeJson(path.join(prepared, "build-info.json"), info);
run(
  process.execPath,
  ["scripts/package.mjs", ...(args.includes("--archive") ? ["--archive"] : [])],
  env,
);
