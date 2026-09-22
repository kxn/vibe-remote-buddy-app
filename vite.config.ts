import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-ignore Node build tools are also used by the standalone packager.
import { loadCatalog, buildIdentity } from "./scripts/release-inputs.mjs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD__: JSON.stringify(
      process.env.BUDDY_BUILD_INFO
        ? JSON.parse(readFileSync(process.env.BUDDY_BUILD_INFO, "utf8"))
        : buildIdentity(),
    ),
    __BUNDLED_CATALOG__: JSON.stringify(
      loadCatalog(
        process.env.BUDDY_CATALOG_DIR || resolve("resources/catalog"),
      ),
    ),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/out/**", "**/build/**", "**/src-tauri/target/**"] },
  },
  clearScreen: false,
});
