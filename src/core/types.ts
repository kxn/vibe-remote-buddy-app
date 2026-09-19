export interface Port {
  path: string;
  serial: string;
  name: string;
}
export interface Info {
  catalog_api?: number;
  catalog_available?: boolean;
  catalog_generation?: number;
  catalog_count?: number;
  catalog_bytes?: number;
  catalog_max_count?: number;
  catalog_max_bytes?: number;
  lifecycle_api?: number;
  probe_api?: number;
  probe_voice_api?: number;
  model_api?: number;
  model_capacity?: number;
  update_api?: number;
  target?: string;
  schema?: number;
  bank?: number;
  confirmed?: boolean;
  flash_bytes?: number;
  psram_bytes?: number;
  voice_presets?: number;
  host_os?: number;
  firmware: string;
  slots: number;
  voice_owner: number;
  manual_pairing: boolean;
  scanning: boolean;
  scan_epoch: number;
  free_slot: number;
}
export interface Slot {
  slot: number;
  peer_id: number;
  generation: number;
  state: number;
  name: string;
  model: string;
  battery: number;
  voice_state: number;
  voice_down: boolean;
  voice_rejected: boolean;
  map_revision: number;
  error: unknown;
}
export interface Mapping {
  default?: { key: number; kind: number; modifiers: number; value: number };
  overridden?: boolean;
  key: number;
  kind: number;
  modifiers: number;
  value: number;
  revision: number;
}
export interface Catalog {
  snapshot_name?: boolean;
  key: number;
  name: string;
  model: string;
  count: number;
  kind: number;
  modifiers: number;
  value: number;
  layout: string | null;
  x?: number;
  y?: number;
}
export interface KeyEntry {
  catalog: Catalog;
  map: Mapping;
}
export interface Candidate {
  connectable: boolean;
  candidate_id: number;
  scan_epoch: number;
  name: string;
  rssi: number;
  known: boolean;
  bound_slot: number;
  age_ms: number;
  seen: number;
}
export interface Operation {
  model_error?: number;
  operation_id: number;
  kind: number;
  pending: boolean;
  slot: number;
  peer_id: number;
  result: number;
  uncertain: boolean;
}
export interface Action {
  kind: "app" | "web" | "input" | "command";
  target: string;
  label: string;
  profile?: string;
}
export interface Settings {
  schema: 1;
  background: boolean;
  boards: Record<
    string,
    {
      bindings?: { peer_id: number; model: string; hex: string }[];
      aliases: Record<string, string>;
      actions: Record<string, Action>;
      authorizations: Record<string, number>;
      shared: Record<string, Omit<Mapping, "revision">>;
      followers: Record<string, number[]>;
    }
  >;
}
export interface Snapshot {
  status: "disconnected" | "connecting" | "connected";
  ports: Port[];
  board?: Port;
  info?: Info;
  slots: Slot[];
  error: string;
  logs: string[];
  busy: boolean;
  firmwareProgress?: { phase: string; percent: number; active: boolean };
}
