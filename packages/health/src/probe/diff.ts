import type { NormalizedProbe } from '@sctech/profilevault-contract';

/** Đường dẫn được phép đổi sau khi nâng Fury (SPEC-02 §6.4 E3). */
export const ALLOWED_VERSION_CHANGE_PATHS = ['furyVersion', 'capturedAt', 'userAgent', 'uaData.brands', 'uaData.fullVersionList', 'uaData.platformVersion', 'contextsConsistent'] as const;

export interface ProbeChange {
  path: string;
  before: unknown;
  after: unknown;
}

function flatten(v: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (Array.isArray(v)) {
    out.set(prefix, JSON.stringify(v));
    return out;
  }
  if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out.set(prefix, v);
  return out;
}

/** Mọi trường khác nhau giữa hai probe (trừ `capturedAt`). */
export function probeDiff(a: NormalizedProbe, b: NormalizedProbe): ProbeChange[] {
  const fa = flatten(a);
  const fb = flatten(b);
  const keys = new Set([...fa.keys(), ...fb.keys()]);
  const out: ProbeChange[] = [];
  for (const k of [...keys].sort()) {
    if (k === 'capturedAt') continue;
    const x = fa.get(k);
    const y = fb.get(k);
    if (x !== y) out.push({ path: k, before: x, after: y });
  }
  return out;
}

export function isAllowedVersionChange(path: string): boolean {
  return ALLOWED_VERSION_CHANGE_PATHS.some((p) => path === p || path.startsWith(`${p}.`));
}

/** So sánh UA chỉ đổi phần số phiên bản (Chrome/xxx). */
export function userAgentOnlyVersionChanged(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/\d+(\.\d+)+/g, 'X');
  return strip(a) === strip(b);
}
