import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
export const root = path.resolve(import.meta.dirname, "..");
export const variants = ["q2", "o8", "q2-f4"];
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export const writeJson = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
export const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
export function safeFile(base, rel) {
  if (
    typeof rel !== "string" ||
    !/^[a-zA-Z0-9_./-]+$/.test(rel) ||
    rel.startsWith("/") ||
    rel.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw Error("Unsafe resource path: " + rel);
  const file = path.resolve(base, rel);
  if (
    !fs.realpathSync(file).startsWith(fs.realpathSync(base) + path.sep) ||
    !fs.lstatSync(file).isFile()
  )
    throw Error("Unsafe resource file");
  return file;
}
export function loadCatalog(dir) {
  const index = json(path.join(dir, "catalog.json"));
  if (
    index.format_version !== 2 ||
    index.minimum_catalog_api > 2 ||
    !Array.isArray(index.resources) ||
    index.resources.length > 32768
  )
    throw Error("Unsupported model catalog");
  const seen = new Set();
  const resources = index.resources.map((r) => {
    if (seen.has(r.path)) throw Error("Duplicate catalog path");
    seen.add(r.path);
    const bytes = fs.readFileSync(safeFile(dir, r.path));
    if (bytes.length !== r.size || sha256(bytes) !== r.sha256)
      throw Error("Catalog checksum mismatch: " + r.path);
    const value = JSON.parse(bytes);
    if (
      value.id !== r.id ||
      value.kind !== r.kind ||
      value.revision !== r.revision
    )
      throw Error("Catalog index mismatch");
    return value;
  });
  return {
    commit: fs.existsSync(path.join(dir, "provenance.json"))
      ? json(path.join(dir, "provenance.json")).commit
      : "bundled",
    version: index.catalog_version,
    resources,
  };
}
export function validateFirmware(dir) {
  const index = json(path.join(dir, "catalog.json"));
  if (
    index.format !== 1 ||
    JSON.stringify(index.variants) !== JSON.stringify(variants)
  )
    throw Error("Incomplete firmware variants");
  const result = {};
  for (const variant of variants) {
    const base = path.join(dir, variant),
      manifest = json(path.join(base, "manifest.json")),
      install = json(path.join(base, "install.json"));
    const target = variant === "q2-f4" ? "s3-q2-f4-ab2" : `s3-${variant}-ab1`;
    if (
      manifest.target !== target ||
      install.target !== target ||
      manifest.version !== install.version ||
      manifest.format !== 1 ||
      install.format !== 2
    )
      throw Error("Firmware target/version mismatch");
    const names = [
      "bootloader.bin",
      "partition-table.bin",
      "ota_data_initial.bin",
      "receiver.bin",
      "factory-nvs.bin",
      "catalog.bin",
    ];
    if (
      install.files.length !== names.length ||
      new Set(install.files.map((f) => f.name)).size !== names.length
    )
      throw Error("Incomplete installation manifest");
    for (const entry of install.files) {
      if (!names.includes(entry.name)) throw Error("Unexpected firmware file");
      const bytes = fs.readFileSync(safeFile(base, entry.name));
      if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256)
        throw Error("Firmware checksum mismatch: " + entry.name);
    }
    const app = fs.readFileSync(path.join(base, "receiver.bin"));
    const text = (offset) =>
      app
        .subarray(offset, offset + 32)
        .toString()
        .split("\0")[0];
    if (
      app.length !== manifest.size ||
      sha256(app) !== manifest.sha256 ||
      app[0] !== 0xe9 ||
      app.readUInt16LE(12) !== 9 ||
      app.readUInt32LE(32) !== 0xabcd5432 ||
      text(48) !== manifest.version ||
      text(80) !== `buddy_${target.replaceAll("-", "_")}`
    )
      throw Error("Invalid receiver image");
    const offsets = {
      "bootloader.bin": 0,
      "partition-table.bin": 0x8000,
      "ota_data_initial.bin": 0xf000,
      "receiver.bin": 0x20000,
      "factory-nvs.bin": variant === "q2-f4" ? 0x2a0000 : 0x420000,
      "catalog.bin": variant === "q2-f4" ? 0x2e0000 : 0x460000,
    };
    if (install.files.some((f) => f.offset !== offsets[f.name]))
      throw Error("Unexpected flash layout");
    if (app.length > (variant === "q2-f4" ? 0x140000 : 0x200000))
      throw Error("Firmware exceeds partition");
    if (
      install.files.find((f) => f.name === "catalog.bin").size >
      (variant === "q2-f4" ? 0x90000 : 0x180000)
    )
      throw Error("Catalog exceeds partition");
    result[variant] = {
      version: manifest.version,
      target,
      sha256: manifest.sha256,
      install_sha256: sha256(fs.readFileSync(path.join(base, "install.json"))),
      manifest_sha256: sha256(
        fs.readFileSync(path.join(base, "manifest.json")),
      ),
    };
  }
  return result;
}
export function buildIdentity(
  version = process.env.BUDDY_APP_VERSION ||
    json(path.join(root, "package.json")).version,
) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(
      version,
    )
  )
    throw Error("Invalid application version");
  const commit = git("rev-parse", "HEAD"),
    dirty = !!git("status", "--porcelain"),
    short_hash = commit.slice(0, 8);
  const channel = process.env.GITHUB_ACTIONS
    ? process.env.BUDDY_BUILD_CHANNEL || "ci"
    : "local";
  if (!["release", "ci", "local"].includes(channel))
    throw Error("Invalid build channel");
  return {
    version,
    commit,
    short_hash,
    dirty,
    channel,
    display_version: `${version}+${short_hash}.${channel}${dirty ? ".dirty" : ""}`,
  };
}
export function sourceDigest() {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  const hash = createHash("sha256");
  for (const f of [...new Set(files)].sort()) {
    hash.update(f);
    hash.update("\0");
    const file = path.join(root, f);
    if (f === "firmware") {
      if (fs.existsSync(path.join(file, ".git"))) {
        hash.update(execFileSync("git", ["-C", file, "rev-parse", "HEAD"]));
        hash.update(execFileSync("git", ["-C", file, "diff", "--binary", "HEAD"]));
        const extra = execFileSync("git", ["-C", file, "ls-files", "--others", "--exclude-standard", "-z"])
          .toString().split("\0").filter(Boolean).sort();
        for (const name of extra) {
          hash.update(name);
          hash.update("\0");
          hash.update(fs.readFileSync(path.join(file, name)));
        }
      } else hash.update(execFileSync("git", ["ls-files", "--stage", "--", f], { cwd: root }));
    } else hash.update(fs.existsSync(file) ? fs.readFileSync(file) : "deleted");
    hash.update("\0");
  }
  return hash.digest("hex");
}
