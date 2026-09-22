import spec from "../../resources/voice-protocols.json";
import type { ProbeAttribute } from "./probe";
const uuid = (s: string) => s.toLowerCase().replace(/^0x/, "");
function reportMatches(attrs: ProbeAttribute[], id: number, type: number) {
  return attrs.filter(
    (a) =>
      uuid(a.uuid) === "2908" &&
      a.complete &&
      !a.read_error &&
      a.hex.toLowerCase() ===
        id.toString(16).padStart(2, "0") + type.toString(16).padStart(2, "0"),
  );
}
export function familyEvidence(attrs: ProbeAttribute[]): number | undefined {
  const matches = spec.protocols.filter(
    (p) =>
      (p.evidenceServices ?? []).every((s) =>
        attrs.some((a) => a.kind === 1 && uuid(a.uuid) === s),
      ) &&
      (p.evidenceReports ?? []).every((id) => {
        const r = p.reports.find((r) => r.id === id)!;
        return reportMatches(attrs, id, r.type).length === 1;
      }),
  );
  const priority = Math.max(...matches.map((p) => p.priority));
  const best = matches.filter((p) => p.priority === priority);
  return best.length === 1 ? best[0].family : undefined;
}
export function transportReady(attrs: ProbeAttribute[], family: number) {
  const p = spec.protocols.find((p) => p.family === family);
  if (!p) return false;
  const chars = attrs.filter((a) => a.kind === 2);
  return (
    p.services.every((s) =>
      attrs.some((a) => a.kind === 1 && uuid(a.uuid) === s),
    ) &&
    p.reports.every((r) => {
      const refs = reportMatches(attrs, r.id, r.type);
      // Duplicate report IDs are ambiguous even when the extra type differs.
      const ids = attrs.filter(
        (a) =>
          uuid(a.uuid) === "2908" &&
          a.complete &&
          a.hex.length === 4 &&
          parseInt(a.hex.slice(0, 2), 16) === r.id,
      );
      return (
        refs.length === 1 &&
        ids.length === 1 &&
        chars.some(
          (c) =>
            c.handle === refs[0].parent &&
            (c.properties & r.properties) === r.properties,
        )
      );
    }) &&
    p.characteristics.every((r) => {
      const found = chars.filter((c) => uuid(c.uuid) === r.uuid);
      return found.length === 1 && !!(found[0].properties & r.properties);
    })
  );
}
