/// <reference types="vite/client" />

declare const __APP_BUILD__: {
  version: string;
  commit: string;
  short_hash: string;
  dirty: boolean;
  channel: "local" | "ci" | "release";
  display_version: string;
};
declare const __BUNDLED_CATALOG__: import("./core/catalog").CatalogSnapshot;
