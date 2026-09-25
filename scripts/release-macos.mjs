// macOS release: signed .app in out/latest, notarized DMG in out/distribution.
// Shares input preparation (catalog, firmware, build-info) with release.mjs.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { root, variants } from "./release-inputs.mjs";
import { renderUserGuide } from "./render-user-guide.mjs";

if (process.platform !== "darwin") throw Error("macOS packaging runs on macOS");
process.chdir(root);
const args = process.argv.slice(2);
const notarize = !args.includes("--no-notarize");
const identity = process.env.BUDDY_MAC_SIGN_IDENTITY;
const profile = process.env.BUDDY_NOTARY_PROFILE;
if (!identity) throw Error("Set BUDDY_MAC_SIGN_IDENTITY to a Developer ID Application identity");
if (notarize && !profile) throw Error("Set BUDDY_NOTARY_PROFILE to a notarytool keychain profile, or pass --no-notarize");

const run = (program, a, opts = {}) =>
  execFileSync(program, a, { cwd: root, stdio: "inherit", ...opts });
const read = (program, a) => execFileSync(program, a, { cwd: root, encoding: "utf8" }).trim();
const sha256 = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const arch = { arm64: "arm64", x64: "x64" }[process.arch];

// 1. Catalog, firmware and build identity, exactly as the Windows release.
run(process.execPath, ["scripts/release.mjs", "--prepare-only", ...(args.includes("--offline") ? ["--offline"] : [])]);
const prepared = path.join(root, "build/release-inputs");
const buildInfoPath = path.join(prepared, "build-info.json");
const info = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
const catalogDir = path.join(prepared, "catalog");
const firmwareDir = path.join(prepared, "firmware");

// 2. Receiver setup helper (esptool) as a PyInstaller onedir for this Mac.
const helperWork = path.join(root, "build/setup-helper-macos");
const helperSource = path.join(root, "tools/receiver_setup");
const py = path.join(helperWork, "venv/bin/python");
if (!fs.existsSync(py)) run(process.env.PYTHON || "python3", ["-m", "venv", path.join(helperWork, "venv")]);
run(py, ["-m", "pip", "install", "-q", "-r", path.join(helperSource, "requirements.txt")]);
fs.rmSync(path.join(helperWork, "dist"), { recursive: true, force: true });
// One file: Tauri resource copying dereferences the onedir Python.framework
// symlinks, which breaks that framework's signature.
run(py, ["-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--name", "receiver-setup",
  "--collect-all", "esptool", "--collect-all", "esptool.targets",
  "--distpath", path.join(helperWork, "dist"), "--workpath", path.join(helperWork, "pyinstaller"),
  "--specpath", helperWork, path.join(helperSource, "helper.py")]);
fs.rmSync(path.join(helperWork, "sources"), { recursive: true, force: true });
run(py, ["-m", "pip", "download", "-q", "--no-deps", "--no-binary", ":all:", "--dest", path.join(helperWork, "sources"), "esptool==4.12.0"]);
const helperExeBuilt = path.join(helperWork, "dist/receiver-setup");
const licenseDir = path.join(helperWork, "dist/licenses");
fs.mkdirSync(licenseDir, { recursive: true });
const site = read(py, ["-c", "import sysconfig;print(sysconfig.get_paths()['purelib'])"]);
for (const d of fs.readdirSync(site).filter((n) => n.endsWith(".dist-info"))) {
  const dest = path.join(licenseDir, d);
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(path.join(site, d)))
    if (/^(license|copying|notice|metadata)/i.test(item))
      fs.cpSync(path.join(site, d, item), path.join(dest, item), { recursive: true });
}

// 3. Bundle resources: editable models, synced catalog, installer package.
const resources = path.join(prepared, "macos-resources");
fs.rmSync(resources, { recursive: true, force: true });
fs.cpSync("resources", resources, { recursive: true });
fs.rmSync(path.join(resources, "catalog"), { recursive: true, force: true });
fs.cpSync(catalogDir, path.join(resources, "catalog"), { recursive: true });
const installer = path.join(resources, "installer");
fs.mkdirSync(installer);
fs.copyFileSync(helperExeBuilt, path.join(installer, "receiver-setup"));
fs.chmodSync(path.join(installer, "receiver-setup"), 0o755);
fs.cpSync(licenseDir, path.join(installer, "licenses"), { recursive: true });
fs.cpSync(helperSource, path.join(installer, "source"), {
  recursive: true,
  filter: (p) => !p.includes("__pycache__") && !p.endsWith(".pyc"),
});
fs.cpSync(path.join(helperWork, "sources"), path.join(installer, "source/esptool"), { recursive: true });
fs.copyFileSync(path.join(firmwareDir, "catalog.json"), path.join(installer, "catalog.json"));
for (const variant of variants) {
  fs.mkdirSync(path.join(installer, variant));
  for (const f of ["install.json", "receiver.bin", "bootloader.bin", "partition-table.bin", "ota_data_initial.bin", "factory-nvs.bin", "catalog.bin"])
    fs.copyFileSync(path.join(firmwareDir, variant, f), path.join(installer, variant, f));
}
const docs = path.join(resources, "docs");
fs.mkdirSync(docs);
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) fs.copyFileSync(name, path.join(docs, name));
fs.copyFileSync("receiver-firmware/NOTICES.md", path.join(docs, "FIRMWARE-NOTICES.md"));
fs.cpSync("receiver-firmware/licenses", path.join(docs, "firmware-licenses"), { recursive: true });
fs.copyFileSync("docs/remote-models.md", path.join(docs, "REMOTE-MODELS.md"));
fs.copyFileSync("docs/remote-probe.md", path.join(docs, "REMOTE-PROBE.md"));
renderUserGuide(docs);

// Every Mach-O inside the bundle needs its own hardened-runtime signature.
const machO = (p) => {
  const fd = fs.openSync(p, "r");
  const b = Buffer.alloc(4);
  fs.readSync(fd, b, 0, 4, 0);
  fs.closeSync(fd);
  return ["cffaedfe", "cafebabe", "feedfacf"].includes(b.toString("hex"));
};
const sign = (p, entitlements) =>
  run("codesign", ["--force", "--timestamp", "--options", "runtime", "--sign", identity,
    ...(entitlements ? ["--entitlements", entitlements] : []), p]);
const nested = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(p);
    else if (machO(p)) nested.push(p);
  }
})(installer);
const helperExe = path.join(installer, "receiver-setup");
for (const p of nested.filter((p) => p !== helperExe)) sign(p);
sign(helperExe, "src-tauri/macos/helper.entitlements");

// 4. Tauri application bundle with embedded frontend.
const overlay = path.join(prepared, "tauri-macos.json");
fs.writeFileSync(overlay, JSON.stringify({
  version: info.version,
  bundle: {
    active: true,
    targets: ["app"],
    resources: { "../resources/": null, [resources + "/"]: "resources/" },
    macOS: { minimumSystemVersion: "12.0", signingIdentity: null, hardenedRuntime: true },
  },
}, null, 2));
const env = {
  ...process.env,
  BUDDY_FIRMWARE_DIR: firmwareDir,
  BUDDY_CATALOG_DIR: catalogDir,
  BUDDY_BUILD_INFO: buildInfoPath,
  // Stripped release proc-macro dylibs fail to load with recent macOS dyld
  // ("mis-aligned LINKEDIT string pool"); keep build-time crates unstripped.
  CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP: "false",
};
run(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "build", "--bundles", "app",
  "--features", "custom-protocol", "--config", overlay], { env });
const built = path.join(root, "src-tauri/target/release/bundle/macos/Vibe Remote Buddy.app");
sign(built, "src-tauri/macos/app.entitlements");
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", built]);

// 5. DMG, notarization, then the fixed latest application path.
const out = path.join(root, "out");
const distribution = path.join(out, "distribution");
fs.mkdirSync(distribution, { recursive: true });
const name = `vibe-remote-buddy-app-${info.version}-${info.short_hash}-${info.channel}${info.dirty ? "-dirty" : ""}-macos-${arch}.dmg`;
const dmg = path.join(distribution, name);
const dmgRoot = path.join(prepared, "dmg-root");
fs.rmSync(dmgRoot, { recursive: true, force: true });
fs.mkdirSync(dmgRoot);
run("ditto", [built, path.join(dmgRoot, "Vibe Remote Buddy.app")]);
fs.symlinkSync("/Applications", path.join(dmgRoot, "Applications"));
fs.rmSync(dmg, { force: true });
run("hdiutil", ["create", "-volname", "Vibe Remote Buddy", "-srcfolder", dmgRoot, "-fs", "HFS+", "-format", "UDZO", "-ov", dmg]);
sign(dmg);
if (notarize) {
  run("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", profile, "--wait"]);
  run("xcrun", ["stapler", "staple", dmg]);
  run("xcrun", ["stapler", "validate", dmg]);
  // The ticket covers the same app signature, so staple the latest copy too.
  run("xcrun", ["stapler", "staple", built]);
  run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", built]);
}
fs.writeFileSync(dmg + ".sha256", `${sha256(dmg)}  ${name}\n`);

const latest = path.join(out, "latest");
const stage = path.join(out, ".staging");
if (fs.existsSync(stage)) throw Error("Resolve out/.staging from the interrupted packaging first");
fs.mkdirSync(stage, { recursive: true });
run("ditto", [built, path.join(stage, "Vibe Remote Buddy.app")]);
const hashes = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(p);
    else hashes[path.relative(stage, p)] = sha256(p);
  }
})(stage);
const packaged = {
  ...info,
  packaged_at: new Date().toISOString(),
  platform: "macos",
  arch,
  signing_identity: identity,
  notarized: notarize,
  disk_image: { name, sha256: sha256(dmg) },
  origin: "node scripts/release-macos.mjs",
  sha256: hashes,
};
fs.writeFileSync(path.join(stage, "build-info.json"), JSON.stringify(packaged, null, 2) + "\n");
// out/latest is a fixed generated path inside this repository.
fs.rmSync(latest, { recursive: true, force: true });
fs.renameSync(stage, latest);
console.log(`Application: ${path.join(latest, "Vibe Remote Buddy.app")}`);
console.log(`Disk image: ${dmg}${notarize ? " (notarized)" : " (not notarized)"}`);
