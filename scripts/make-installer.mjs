import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root, sha256 } from "./release-inputs.mjs";
import { uninstallCommands } from "./installer-uninstall.mjs";

// Build the Windows NSIS installer from the verified clean distribution
// (out/distribution/files). Only files recorded in build-info.json are
// packaged, and each is re-checked against the recorded SHA256 first, so
// locally added models or edited files never end up in the installer.
const distribution = path.join(root, "out/distribution");
const source = path.join(distribution, "files");
const info = json(path.join(source, "build-info.json"));
if (!info.commit || !info.catalog || !info.firmware)
  throw Error("Package lacks release provenance; run npm run release first");

const makensis = findMakensis();
const version4 = (String(info.version).match(/^(\d+\.\d+\.\d+)/) || [])[1];
if (!version4) throw Error(`Cannot derive numeric version from ${info.version}`);
const name = `vibe-remote-buddy-app-${info.version}-${info.short_hash}-${info.channel}${info.dirty ? "-dirty" : ""}-windows-x64-setup.exe`;
const outFile = path.join(distribution, name);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-installer-"));
try {
  for (const [rel, digest] of Object.entries(info.sha256)) {
    if (rel.includes("..") || path.isAbsolute(rel)) throw Error("Invalid package path");
    const bytes = fs.readFileSync(path.join(source, rel));
    if (sha256(bytes) !== digest) throw Error("Installed package was edited: " + rel);
    const target = path.join(stage, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  fs.copyFileSync(
    path.join(source, "build-info.json"),
    path.join(stage, "build-info.json"),
  );
  if (!fs.existsSync(path.join(stage, "Vibe Remote Buddy.exe")))
    throw Error("Incomplete portable package");

  // Generated file so quoted define values may contain spaces (makensis /D
  // cannot take values with spaces in the middle of the command line).
  fs.mkdirSync(path.join(root, "build/installer"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "build/installer/defines.nsh"),
    [
      `!define SRCDIR "${stage}"`,
      `!define OUTFILE "${outFile}"`,
      `!define ICONFILE "${path.join(root, "src-tauri/icons/icon.ico")}"`,
      `!define APP_VERSION "${info.version}"`,
      `!define DISPLAY_VERSION "${info.display_version}"`,
      `!define VERSION4 "${version4}.0"`,
      `!define PUBLISHER "Vibe Remote Buddy Project"`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "build/installer/uninstall-files.nsh"),
    uninstallCommands([...Object.keys(info.sha256), "build-info.json"]),
  );
  execFileSync(makensis, [path.join(root, "installer/app-installer.nsi")], {
    stdio: "inherit",
    cwd: root,
  });
  if (!fs.existsSync(outFile)) throw Error("makensis reported success but no installer was produced");
  fs.writeFileSync(outFile + ".sha256", `${sha256(fs.readFileSync(outFile))}  ${name}\n`);
  console.log(outFile);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function findMakensis() {
  if (process.env.BUDDY_NSIS_EXE) return process.env.BUDDY_NSIS_EXE;
  for (const p of [
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
    "C:\\Program Files\\NSIS\\makensis.exe",
  ])
    if (fs.existsSync(p)) return p;
  try {
    const hit = execFileSync("where", ["makensis"], { encoding: "utf8" })
      .split(/\r?\n/)
      .find((l) => l.trim());
    if (hit) return hit.trim();
  } catch {
    // fall through
  }
  throw Error("NSIS not found; install it with: winget install NSIS.NSIS (or set BUDDY_NSIS_EXE)");
}
