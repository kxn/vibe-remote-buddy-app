import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root, json, sha256, writeJson } from "./release-inputs.mjs";
const latest = path.join(root, "out/distribution/files"),
  info = json(path.join(latest, "build-info.json"));
if (!info.commit || !info.catalog || !info.firmware)
  throw Error("Package lacks release provenance");
const out = path.join(root, "out/distribution"),
  stage = path.join(out, "archive-files");
fs.mkdirSync(out, { recursive: true });
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage);
// Only package the verified build manifest, never locally added remote definitions.
for (const [rel, digest] of Object.entries(info.sha256)) {
  if (rel.includes("..") || path.isAbsolute(rel))
    throw Error("Invalid package path");
  const bytes = fs.readFileSync(path.join(latest, rel));
  if (sha256(bytes) !== digest)
    throw Error("Installed package was edited: " + rel);
  const target = path.join(stage, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
fs.copyFileSync(
  path.join(latest, "build-info.json"),
  path.join(stage, "build-info.json"),
);
const name = `vibe-remote-buddy-app-${info.version}-${info.short_hash}-${info.channel}${info.dirty ? "-dirty" : ""}-windows-x64.zip`,
  zip = path.join(out, name);
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Compress-Archive -Path (Join-Path $env:BUDDY_ZIP_SOURCE '*') -DestinationPath $env:BUDDY_ZIP_TARGET -Force",
  ],
  {
    env: { ...process.env, BUDDY_ZIP_SOURCE: stage, BUDDY_ZIP_TARGET: zip },
    stdio: "inherit",
  },
);
fs.writeFileSync(zip + ".sha256", `${sha256(fs.readFileSync(zip))}  ${name}\n`);
fs.rmSync(stage, { recursive: true, force: true });
const notes = `App: ${info.display_version}\n\nModel catalog: ${info.catalog.version} (${info.catalog.commit})\n\nFirmware: ${Object.entries(
  info.firmware,
)
  .map(([v, f]) => `${v} ${f.version}`)
  .join(
    ", ",
  )}\n\nWindows x64: use the setup EXE for an installed copy, or extract the complete portable ZIP before running Vibe Remote Buddy.exe.\n`;
fs.writeFileSync(path.join(out, "release-notes.md"), notes);
writeJson(path.join(out, "release.json"), {
  version: info.version,
  display_version: info.display_version,
  zip,
  checksum: zip + ".sha256",
  notes: path.join(out, "release-notes.md"),
});
console.log(zip);
