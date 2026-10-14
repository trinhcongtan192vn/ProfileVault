import type { Binding, ChartName, ChartResponse, HealthEventRecord, ProxyCheck } from '@sctech/profilevault-contract';
import type { DetectSuiteRow } from '@sctech/profilevault-db';
import { localDateKey, localParts, fromLocal } from '@sctech/profilevault-health';

export interface ChartSources {
  events(filter: { bindingId?: string; types?: string[]; since?: string; until?: string }): HealthEventRecord[];
  proxyChecks(bindingId: string): ProxyCheck[];
  detectSuite(): DetectSuiteRow[];
  consistencyRuns(bindingId: string): { finishedAt: string | null; startedAt: string; ratio: number | null; blockFailing: number }[];
  binding(id: string): Binding | undefined;
}

export interface ChartQuery {
  bindingId?: string;
  from?: string;
  to?: string;
  bucket: 'day' | 'week';
}

function weekStart(dateKey: string, timezone: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const date = fromLocal(timezone, y, m, d, 12, 0);
  const dow = (new Date(date).getUTCDay() + 6) % 7; // Thứ Hai = 0 (xấp xỉ theo UTC trưa địa phương)
  const monday = new Date(date.getTime() - dow * 86_400_000);
  return localDateKey(monday, timezone);
}

export function bucketOf(iso: string, bucket: 'day' | 'week', timezone: string): string {
  const day = localDateKey(new Date(iso), bucket === 'day' ? timezone : timezone);
  return bucket === 'day' ? day : weekStart(day, timezone);
}

function add(map: Map<string, Record<string, number>>, bucket: string, key: string, n = 1): void {
  const s = map.get(bucket) ?? {};
  s[key] = (s[key] ?? 0) + n;
  map.set(bucket, s);
}

function points(map: Map<string, Record<string, number>>): ChartResponse['points'] {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, series]) => ({ bucket, series }));
}

/** Biểu đồ SPEC-07 §8 (dữ liệu từ bảng SPEC-00 §8). */
export function buildChart(name: ChartName, q: ChartQuery, src: ChartSources, timezone: string, now: Date): ChartResponse {
  const to = q.to ?? now.toISOString();
  const from = q.from ?? new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
  const range = { since: from, until: to };
  const base = { name, bucket: q.bucket } as const;

  switch (name) {
    case 'uploads_by_mode': {
      const map = new Map<string, Record<string, number>>();
      for (const e of src.events({ bindingId: q.bindingId, types: ['manual.upload', 'run.done'], ...range })) {
        if (e.type === 'manual.upload') add(map, bucketOf(e.occurredAt, q.bucket, timezone), 'manual');
        else if (typeof e.payload.flowId === 'string' && e.payload.flowId.endsWith('/upload') && (e.payload.mode === 'L2' || e.payload.mode === 'L3')) add(map, bucketOf(e.occurredAt, q.bucket, timezone), e.payload.mode);
      }
      return { ...base, kind: 'series', points: points(map) };
    }
    case 'success_rates': {
      const ok = new Map<string, Record<string, number>>();
      const total = new Map<string, Record<string, number>>();
      for (const e of src.events({ bindingId: q.bindingId, types: ['session_check.ok', 'session_check.logged_out', 'session_check.wrong_account', 'session_check.failed', 'run.done', 'run.failed'], ...range })) {
        const b = bucketOf(e.occurredAt, q.bucket, timezone);
        const key = e.type.startsWith('session_check') ? 'session_check' : 'flow';
        add(total, b, key);
        if (e.type === 'session_check.ok' || e.type === 'run.done') add(ok, b, key);
      }
      const map = new Map<string, Record<string, number>>();
      for (const [b, t] of total) {
        const o = ok.get(b) ?? {};
        const series: Record<string, number> = {};
        for (const k of Object.keys(t)) series[k] = Number(((o[k] ?? 0) / (t[k] ?? 1)).toFixed(3));
        map.set(b, series);
      }
      return { ...base, kind: 'series', points: points(map) };
    }
    case 'needs_user_by_reason': {
      const map = new Map<string, Record<string, number>>();
      for (const e of src.events({ bindingId: q.bindingId, types: ['run.needs_user'], ...range })) {
        const reason = typeof e.payload.reason === 'string' ? e.payload.reason : typeof e.payload.step === 'string' ? e.payload.step : 'unknown';
        add(map, bucketOf(e.occurredAt, q.bucket, timezone), reason);
      }
      return { ...base, kind: 'series', points: points(map) };
    }
    case 'session_age': {
      const map = new Map<string, Record<string, number>>();
      if (!q.bindingId) return { ...base, kind: 'series', points: [] };
      const binding = src.binding(q.bindingId);
      if (!binding) return { ...base, kind: 'series', points: [] };
      const reds = src.events({ bindingId: q.bindingId, types: ['manual.logged_out', 'session_check.logged_out'] }).map((e) => Date.parse(e.occurredAt)).sort((a, b) => a - b);
      const start = Date.parse(binding.createdAt);
      const stepMs = q.bucket === 'day' ? 86_400_000 : 7 * 86_400_000;
      for (let t = Date.parse(from); t <= Date.parse(to); t += stepMs) {
        const lastRed = reds.filter((r) => r <= t).at(-1);
        const anchor = lastRed ?? start;
        if (t < anchor) continue;
        map.set(bucketOf(new Date(t).toISOString(), q.bucket, timezone), { days: Math.floor((t - anchor) / 86_400_000) });
      }
      return { ...base, kind: 'series', points: points(map) };
    }
    case 'exit_timeline': {
      if (!q.bindingId) return { ...base, kind: 'spans', spans: [] };
      const checks = src
        .proxyChecks(q.bindingId)
        .filter((c) => c.ok && c.checkedAt >= from && c.checkedAt <= to)
        .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
      const spans: NonNullable<ChartResponse['spans']> = [];
      for (const c of checks) {
        const label = `${c.country ?? '?'}/AS${c.asn ?? '?'}`;
        const last = spans.at(-1);
        if (last && last.label === label && last.value === (c.exitIp ?? '')) last.to = c.checkedAt;
        else spans.push({ from: c.checkedAt, to: c.checkedAt, label, value: c.exitIp ?? '', ok: true });
      }
      return { ...base, kind: 'spans', spans };
    }
    case 'detect_suite_timeline': {
      const rows = src
        .detectSuite()
        .filter((r) => r.bindingId === null || r.bindingId === q.bindingId)
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      const spans: NonNullable<ChartResponse['spans']> = rows.map((r, i) => ({ from: r.recordedAt, to: rows[i + 1]?.recordedAt ?? to, label: r.furyVersion, ok: r.passed }));
      return { ...base, kind: 'spans', spans };
    }
    case 'consistency_score': {
      if (!q.bindingId) return { ...base, kind: 'series', points: [] };
      const map = new Map<string, Record<string, number>>();
      for (const r of src.consistencyRuns(q.bindingId)) {
        const at = r.finishedAt ?? r.startedAt;
        if (at < from || at > to) continue;
        map.set(bucketOf(at, q.bucket, timezone), { score: r.ratio === null ? 0 : Number(r.ratio.toFixed(3)), blockFailing: r.blockFailing });
      }
      return { ...base, kind: 'series', points: points(map) };
    }
  }
}

export { localParts };
