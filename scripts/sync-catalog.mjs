import fs from "node:fs";
import path from "node:path";
import { root, loadCatalog, writeJson } from "./release-inputs.mjs";
export async function syncCatalog(destination) {
  const repo = "kxn/vibe-remote-buddy-models";
  const get = async (url) => {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "VibeRemoteBuddy-build",
        // Authenticate only the fixed GitHub API host, never raw asset hosts.
        ...(new URL(url).hostname === "api.github.com" && process.env.GH_TOKEN
          ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error(`${response.status}: ${url}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const commit = JSON.parse(
    await get(`https://api.github.com/repos/${repo}/commits/main`),
  ).sha;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error("Invalid catalog commit");
  const base = `https://raw.githubusercontent.com/${repo}/${commit}/`;
  const raw = await get(base + "catalog.json"),
    index = JSON.parse(raw);
  if (!Array.isArray(index.resources) || index.resources.length > 32768)
    throw Error("Invalid catalog index");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "catalog.json"), raw);
  for (const entry of index.resources) {
    if (
      !/^(protocols|keymaps|layouts|defaults|models|fingerprints)\/[a-z0-9/-]+\.json$/.test(
        entry.path,
      ) ||
      entry.path.includes("..")
    )
      throw Error("Unsafe catalog resource");
    const file = path.join(destination, entry.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await get(base + entry.path));
  }
  fs.writeFileSync(
    path.join(destination, "LICENSE"),
    await get(base + "LICENSE"),
  );
  writeJson(path.join(destination, "provenance.json"), {
    repository: repo,
    commit,
  });
  return loadCatalog(destination);
}
