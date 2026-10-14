import { NormalizedProbeSchema, PROBE_REQUIRED_PATHS, PvError, type NormalizedProbe } from '@sctech/profilevault-contract';
import { DEFAULT_PROBE_CONVERTERS, type ProbeConverter } from './converters.js';

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function stripUndefined(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined) out[k] = stripUndefined(x);
    return out;
  }
  return v;
}

/**
 * Chuẩn hóa file probe (SPEC-02 §6.3). Thiếu trường bắt buộc → `INPUT_INVALID` với `detail.missing`.
 * `converters` tiêm được (TODO(SPIKE-P3)).
 */
export function parseFuryCapture(raw: unknown, opts: { now?: string; converters?: ProbeConverter[] } = {}): { probe: NormalizedProbe; converter: string } {
  const now = opts.now ?? new Date().toISOString();
  const converters = opts.converters ?? DEFAULT_PROBE_CONVERTERS;
  const converter = converters.find((c) => c.detect(raw));
  if (!converter) {
    throw new PvError('INPUT_INVALID', 'Không nhận dạng được định dạng file probe', { reason: 'probe_format_unknown', converters: converters.map((c) => c.id) });
  }
  const candidate = stripUndefined(converter.convert(raw, { now }));
  const missing = PROBE_REQUIRED_PATHS.filter((p) => {
    const v = getPath(candidate, p);
    return v === undefined || v === null || (Array.isArray(v) && v.length === 0 && p === 'navigator.languages');
  });
  if (missing.length > 0) {
    throw new PvError('INPUT_INVALID', `File probe thiếu trường bắt buộc: ${missing.join(', ')}`, { reason: 'probe_missing_fields', missing: [...missing], converter: converter.id });
  }
  const r = NormalizedProbeSchema.safeParse(candidate);
  if (!r.success) {
    throw new PvError('INPUT_INVALID', 'File probe sai kiểu dữ liệu', {
      reason: 'probe_invalid',
      converter: converter.id,
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return { probe: r.data, converter: converter.id };
}
