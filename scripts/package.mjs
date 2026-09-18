import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const invocationDir = process.cwd();
process.chdir(root);
const args = process.argv.slice(2);
const archive = args.includes('--archive');
const legacyIndex = args.indexOf('--import-existing');
const legacy = legacyIndex < 0 ? null : path.resolve(invocationDir, args[legacyIndex + 1]);
if (process.platform !== 'win32') throw new Error('Portable packaging currently validated on Windows only');
const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json'));
const pkg = JSON.parse(fs.readFileSync('package.json'));
if (pkg.version !== config.version) throw new Error('package.json and tauri version differ');
const out = path.join(root, 'out');
const stage = path.join(out, '.staging');
const latest = path.join(out, 'latest');
const previous = path.join(out, '.previous');
fs.mkdirSync(out, { recursive: true });
// Refuse to overwrite an interrupted operation. Never delete arbitrary output paths.
if (fs.existsSync(stage) || fs.existsSync(previous)) throw new Error('Resolve out/.staging or out/.previous from the interrupted packaging first');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
fs.mkdirSync(stage);
try {
  if (legacy) {
    fs.cpSync(legacy, stage, { recursive: true });
  } else {
    fs.copyFileSync('src-tauri/target/release/vibe-remote-buddy.exe', path.join(stage, 'Vibe Remote Buddy.exe'));
    fs.cpSync('resources', path.join(stage, 'resources'), { recursive: true });
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(name, path.join(stage, name));
    fs.copyFileSync('docs/remote-models.md', path.join(stage, 'REMOTE-MODELS.md'));
    fs.copyFileSync('docs/remote-probe.md', path.join(stage, 'REMOTE-PROBE.md'));
  }
  if (!fs.existsSync(path.join(stage, 'Vibe Remote Buddy.exe')) || !fs.existsSync(path.join(stage, 'resources/remotes'))) throw new Error('Incomplete portable package');
  const sha256 = {};
  function hashes(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) hashes(p);
      else if (e.name !== 'build-info.json') sha256[path.relative(stage, p).replaceAll('\\', '/')] = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  }
  hashes(stage);
  const info = { version: legacy ? null : pkg.version, commit: legacy ? null : git('rev-parse', 'HEAD'), dirty: legacy ? null : !!git('status', '--porcelain'), packaged_at: new Date().toISOString(), platform: 'windows', arch: process.arch, origin: legacy ? 'imported-existing-package; original build provenance unknown' : 'npm run release', sha256 };
  fs.writeFileSync(path.join(stage, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
  if (archive) {
    if (legacy) throw new Error('Cannot publish an imported package as a versioned release');
    const stamp = info.packaged_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const name = `vibe-remote-buddy-app-${info.version}-windows-${info.arch}-${stamp}-${info.commit.slice(0, 8)}${info.dirty ? '-dirty' : ''}`;
    const dest = path.join(out, 'releases', name);
    if (fs.existsSync(dest)) throw new Error('Archive already exists');
    fs.cpSync(stage, dest, { recursive: true, errorOnExist: true, force: false });
  }
  if (fs.existsSync(latest)) fs.renameSync(latest, previous);
  try { fs.renameSync(stage, latest); } catch (e) { if (fs.existsSync(previous)) fs.renameSync(previous, latest); throw e; }
  // These fixed paths are absolute children of this repository's out directory.
  fs.rmSync(previous, { recursive: true, force: true });
  console.log(`Portable application: ${path.join(latest, 'Vibe Remote Buddy.exe')}`);
} catch (e) {
  fs.rmSync(stage, { recursive: true, force: true });
  throw e;
}
