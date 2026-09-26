import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
execFileSync(python, ["scripts/build-firmware.py", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit" });
