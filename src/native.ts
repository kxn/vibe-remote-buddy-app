import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Transport } from "./core/session";
export const native = isTauri();
export const call = <T>(name: string, args?: Record<string, unknown>) =>
  invoke<T>(name, args);
export class SerialTransport implements Transport {
  open(path: string) {
    return call<void>("serial_open", { path });
  }
  close() {
    return call<void>("serial_close");
  }
  async read() {
    return Uint8Array.from(await call<number[]>("serial_read"));
  }
  write(data: Uint8Array) {
    return call<void>("serial_write", { data: Array.from(data) });
  }
}
