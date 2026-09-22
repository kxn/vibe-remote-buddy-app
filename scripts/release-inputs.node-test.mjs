import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  root,
  loadCatalog,
  validateFirmware,
  buildIdentity,
  safeFile,
  json,
  writeJson,
  sha256,
} from "./release-inputs.mjs";

function fixture(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-release-test-"));
  fs.cpSync(path.join(root, name), dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("catalog snapshot checks every indexed resource", (t) => {
  const dir = fixture(t, "resources/catalog");
  assert.ok(loadCatalog(dir).resources.length > 0);
  const entry = json(path.join(dir, "catalog.json")).resources[0];
  fs.appendFileSync(path.join(dir, entry.path), " ");
  assert.throws(() => loadCatalog(dir), /checksum/);
});
test("catalog rejects duplicate and escaping paths", (t) => {
  const dir = fixture(t, "resources/catalog"),
    file = path.join(dir, "catalog.json"),
    index = json(file);
  index.resources.push(index.resources[0]);
  writeJson(file, index);
  assert.throws(() => loadCatalog(dir), /Duplicate/);
  for (const name of [
    "../secret",
    "/absolute",
    "a/../../secret",
    "C:/secret",
    "a\\secret",
  ])
    assert.throws(() => safeFile(dir, name));
});
test("all three release targets are complete and correctly identified", () => {
  const firmware = validateFirmware(path.join(root, "receiver-firmware"));
  assert.deepEqual(Object.keys(firmware), ["q2", "o8", "q2-f4"]);
  assert.equal(firmware["q2-f4"].target, "s3-q2-f4-ab2");
});
test("firmware rejects modified binaries even with an unchanged install manifest", (t) => {
  const dir = fixture(t, "receiver-firmware");
  fs.appendFileSync(path.join(dir, "q2/receiver.bin"), Buffer.from([0]));
  assert.throws(() => validateFirmware(dir), /checksum/);
});
test("firmware rejects wrong flash offsets and missing variants", (t) => {
  const dir = fixture(t, "receiver-firmware"),
    file = path.join(dir, "q2-f4/install.json"),
    install = json(file);
  install.files.find((f) => f.name === "catalog.bin").offset = 0x460000;
  writeJson(file, install);
  assert.throws(() => validateFirmware(dir), /layout/);
  writeJson(path.join(dir, "catalog.json"), { format: 1, variants: ["q2"] });
  assert.throws(() => validateFirmware(dir), /variants/);
});
test("firmware identity is verified inside the ESP image", (t) => {
  const dir = fixture(t, "receiver-firmware"),
    file = path.join(dir, "q2/receiver.bin"),
    bytes = fs.readFileSync(file);
  bytes[48] = 0x39;
  fs.writeFileSync(file, bytes);
  const installFile = path.join(dir, "q2/install.json"),
    install = json(installFile);
  install.files.find((f) => f.name === "receiver.bin").sha256 = sha256(bytes);
  writeJson(installFile, install);
  const mf = path.join(dir, "q2/manifest.json"),
    manifest = json(mf);
  manifest.sha256 = sha256(bytes);
  writeJson(mf, manifest);
  assert.throws(() => validateFirmware(dir), /Invalid receiver image/);
});
test("build version includes actual Git hash and supports temporary versions", () => {
  const info = buildIdentity("1.2.3-rc.2");
  assert.match(
    info.display_version,
    /^1\.2\.3-rc\.2\+[0-9a-f]{8}\.(local|ci|release)(\.dirty)?$/,
  );
  assert.equal(info.short_hash, info.commit.slice(0, 8));
  for (const version of ["v1.2.3", "1.2", "1.2.3+madeup", "1.2.3\nINJECT=1"])
    assert.throws(() => buildIdentity(version), /version/);
});
test("only GitHub builds can be marked release; local builds stay local", () => {
  const original = {
    GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
    BUDDY_BUILD_CHANNEL: process.env.BUDDY_BUILD_CHANNEL,
  };
  try {
    delete process.env.GITHUB_ACTIONS;
    process.env.BUDDY_BUILD_CHANNEL = "release";
    assert.equal(buildIdentity().channel, "local");
    process.env.GITHUB_ACTIONS = "true";
    assert.equal(buildIdentity().channel, "release");
    delete process.env.BUDDY_BUILD_CHANNEL;
    assert.equal(buildIdentity().channel, "ci");
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
