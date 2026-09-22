import {transportReady,keyConfirmation} from "./voice-protocols";
import type { CatalogModel } from "./catalog";
import type { RemoteModel } from "./models";
import {
  bytes,
  familyEvidence,
  isUuid,
  decodeProbeKey,
  type ProbeAttribute,
  type ProbeCandidate,
  type ProbeReport,
} from "./probe";

export interface ModelCandidate {
  model: RemoteModel;
  match: "exact" | "compatible";
  confirmKeys: boolean;
  variant: boolean;
}
export function scanKnown(candidate: ProbeCandidate, models: RemoteModel[]) {
  // Scan hints are admission only. Company IDs vary across otherwise identical remotes.
  return models.some((m) =>
    m.matches.some(
      (h) =>
        h.name === candidate.name ||
        (!!h.prefix && candidate.name.startsWith(h.prefix)),
    ),
  );
}
/** Parse input field structure, not descriptor byte similarity. Ignore non-input additions. */
export function inputShapes(hex: string): Map<number, string> {
  const data = bytes(hex),
    result = new Map<number, string[]>(),
    offsets = new Map<number, number>();
  let globals = { page: 0, size: 0, count: 0, id: 0, min: 0, max: 0 },
    locals: string[] = [];
  const stack: (typeof globals)[] = [];
  for (let i = 0; i < data.length;) {
    const prefix = data[i++];
    if (prefix === 254) throw Error("不支持的 HID 长项目");
    const length = [0, 1, 2, 4][prefix & 3];
    if (i + length > data.length) throw Error("HID Map 不完整");
    let value = 0;
    for (let n = 0; n < length; n++) value += data[i++] * 2 ** (n * 8);
    const type = (prefix >> 2) & 3,
      tag = prefix >> 4;
    if (type === 1) {
      if (tag === 0) globals.page = value;
      if (tag === 1) globals.min = value;
      if (tag === 2) globals.max = value;
      if (tag === 7) globals.size = value;
      if (tag === 8) globals.id = value;
      if (tag === 9) globals.count = value;
      if (tag === 10) stack.push({ ...globals });
      if (tag === 11) {
        const saved = stack.pop();
        if (!saved) throw Error("HID Map 栈无效");
        globals = saved;
      }
    } else if (type === 2) locals.push(`${tag}:${value}`);
    else if (type === 0) {
      if (tag === 8) {
        const g = globals,
          offset = offsets.get(g.id) ?? 0;
        if (!g.size || !g.count || g.size * g.count > 65536)
          throw Error("HID 输入长度无效");
        const items = result.get(g.id) ?? [];
        items.push(
          JSON.stringify([
            offset,
            g.page,
            g.size,
            g.count,
            g.min,
            g.max,
            value,
            locals,
          ]),
        );
        result.set(g.id, items);
        offsets.set(g.id, offset + g.size * g.count);
      }
      locals = [];
    }
  }
  return new Map([...result].map(([id, fields]) => [id, fields.join("|")]));
}
export function modelCandidates(
  attrs: ProbeAttribute[],
  catalog: CatalogModel[],
): ModelCandidate[] {
  const maps = attrs.filter((a) => isUuid(a, 0x2a4b));
  if (
    maps.length !== 1 ||
    !maps[0].complete ||
    maps[0].read_error ||
    maps[0].length * 2 !== maps[0].hex.length ||
    !maps[0].length
  )
    throw Error("设备信息未读完整，请重试连接");
  if (
    attrs.some(
      (a) => a.read_error && [0x2a50, 0x2908].some((id) => isUuid(a, id)),
    )
  )
    throw Error("设备信息未读完整，请重试连接");
  const family = familyEvidence(attrs);
  if (!family || !transportReady(attrs, family)) return [];
  const hex = maps[0].hex.toLowerCase();
  let shapes: Map<number, string> | undefined;
  try {
    shapes = inputShapes(hex);
  } catch {
    /* Exact measured descriptors remain valid. */
  }
  return catalog
    .flatMap((entry) => {
      const m = entry.model;
      if (m.family !== family) return [];
      const exact = entry.fingerprints.some(
        (f) => f.required?.report_map?.hex?.toLowerCase() === hex,
      );
      const bindingExact = entry.fingerprints.some((f) => {
        const r = f.required;
        if (r?.report_map?.hex?.toLowerCase() !== hex) return false;
        if (
          r.services?.some(
            (uuid: string) =>
              !attrs.some(
                (a) =>
                  a.kind === 1 && a.uuid.toLowerCase() === uuid.toLowerCase(),
              ),
          )
        )
          return false;
        if (
          r.reports?.some(
            (ref: { id: number; type: number }) =>
              !attrs.some(
                (a) =>
                  isUuid(a, 0x2908) &&
                  a.complete &&
                  a.hex.toLowerCase() ===
                    ref.id.toString(16).padStart(2, "0") +
                      ref.type.toString(16).padStart(2, "0"),
              ),
          )
        )
          return false;
        if (r.pnp) {
          const p = attrs.find(
            (a) => isUuid(a, 0x2a50) && a.complete && a.hex.length === 14,
          );
          if (!p) return false;
          const b = bytes(p.hex),
            values: Record<string, number> = {
              source: b[0],
              vendor: b[1] | (b[2] << 8),
              product: b[3] | (b[4] << 8),
              version: b[5] | (b[6] << 8),
            };
          if (
            Object.entries(r.pnp).some(([key, value]) => values[key] !== value)
          )
            return false;
        }
        return true;
      });
      const compatible =
        !exact &&
        shapes &&
        entry.fingerprints.some((f) => {
          try {
            const expected = inputShapes(f.required.report_map.hex);
            const ids = new Set([
              1,
              ...m.raw.filter((r) => r.report !== 0).map((r) => r.report),
            ]);
            return [...ids].every(
              (id) => expected.has(id) && shapes!.get(id) === expected.get(id),
            );
          } catch {
            return false;
          }
        });
      if (!exact && !compatible) return [];
      return [
        {
          model: m,
          match: exact ? ("exact" as const) : ("compatible" as const),
          variant: !bindingExact,
          confirmKeys:
            !bindingExact ||
            keyConfirmation(m) === "required",
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(a.match !== "exact") - Number(b.match !== "exact") ||
        a.model.title.localeCompare(b.model.title),
    );
}
/** Record physical down/up edges against a template, never count arbitrary presses. */
export class KeyConfirmation {
  readonly verified = new Set<number>();
  readonly proofs = new Map<number, { report: number; usage: number }>();
  private down = new Map<
    number,
    { key: number; report: number; usage: number }
  >();
  constructor(private model: RemoteModel) {}
  accept(
    report: ProbeReport,
    attrs: ProbeAttribute[],
  ): { key?: number; error?: string } {
    if (report.lost) {
      this.down.clear();
      return { error: "按键报告有遗漏，请重按" };
    }
    const voice = decodeProbeKey(report, attrs, 2, this.model.family);
    const normal = decodeProbeKey(report, attrs, 0, this.model.family);
    const decoded =
      report.hex.startsWith("8203") && voice?.report === 248 ? voice : normal;
    if (!decoded) return {};
    if (decoded.usages.length > 1) {
      this.down.delete(report.handle);
      return { error: "请单独按下一个按键" };
    }
    if (decoded.usages.length === 1) {
      const usage = decoded.usages[0];
      const key =
        decoded.report === 248 && usage === 1
          ? 2
          : this.model.raw.find(
              (r) => r.report === decoded.report && r.usage === usage,
            )?.key;
      if (!key) {
        this.down.delete(report.handle);
        return { error: "按键与此机型不符，请返回选择其他机型或适配" };
      }
      this.down.set(report.handle, { key, report: decoded.report, usage });
      return { key };
    }
    const pressed = this.down.get(report.handle);
    this.down.delete(report.handle);
    if (pressed) {
      this.verified.add(pressed.key);
      this.proofs.set(pressed.key, {
        report: pressed.report,
        usage: pressed.usage,
      });
    }
    return { key: pressed?.key };
  }
}
