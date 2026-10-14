import type { Overview, OverviewRow } from '@sctech/profilevault-contract';
import { DetectSuiteRepo } from '@sctech/profilevault-db';
import type { GatewayDeps } from './deps.js';

/** Bảng tổng quan (SPEC-07 §4.1) — dùng chung cho dashboard và tool MCP `pv_readiness_overview`. */
export async function buildOverview(deps: Pick<GatewayDeps, 'health' | 'clock' | 'config' | 'database'>, detect = new DetectSuiteRepo(deps.database.db)): Promise<Overview> {
  const { health } = deps;
  const version = health.currentFuryVersion() ?? null;
  const now = deps.clock.nowMs();
  const rows: OverviewRow[] = [];
  for (const b of health.listBindings()) {
    const r = await health.evaluateReadiness(b.id);
    const red = health.listEvents(b.id, { limit: 500 }).find((e) => e.severity === 'red');
    const c = health.getConsistency(b.id);
    const exit = health.listProxyChecks(b.id, 20).find((p) => p.ok);
    rows.push({
      binding: b,
      daysAtLevel: Math.floor((now - Date.parse(b.levelSince)) / 86_400_000),
      readiness: { nextLevel: r.nextLevel, progress: r.progress, canPromote: r.canPromote, missing: r.conditions.filter((x) => !x.met).map((x) => x.condition.kind) },
      openPauses: r.openPauses,
      lastRed: red ? { type: red.type, at: red.occurredAt } : null,
      consistency: c ? { passed: c.score.passed, total: c.score.total, blockFailing: c.score.blockFailing, blockUnknown: c.score.blockUnknown, at: c.finishedAt } : null,
      exit: exit ? { country: exit.country, asn: exit.asn, ip: exit.exitIp, checkedAt: exit.checkedAt } : null,
      fury: { version, detectSuitePassed: version ? detect.hasPassed(version, b.id) : false },
    });
  }
  return { rows, timezone: deps.config.ui.timezone, now: deps.clock.nowIso() };
}
