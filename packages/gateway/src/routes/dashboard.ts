import { UndoEventParamsSchema, USER_CLEARABLE_PAUSE_REASONS, type InboxItem, type Overview, type OverviewRow } from '@sctech/profilevault-contract';
import { DetectSuiteRepo } from '@sctech/profilevault-db';
import type { FastifyInstance } from 'fastify';
import { NoRunner, type GatewayDeps } from '../deps.js';
import { parse } from '../security.js';


/** Endpoint tổng hợp cho dashboard (giả định G32): tổng quan, Chờ bạn, hoàn tác. */
export function registerDashboardRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { health } = deps;
  const runner = deps.runner ?? new NoRunner();
  const detect = new DetectSuiteRepo(deps.database.db);

  app.get('/internal/overview', async (): Promise<Overview> => {
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
  });

  app.get('/internal/inbox', async (): Promise<{ items: InboxItem[] }> => {
    const items: InboxItem[] = [];
    const bindings = health.listBindings();
    const name = (id: string | null) => (id ? (bindings.find((b) => b.id === id)?.displayName ?? null) : null);
    for (const run of runner.listNeedsUser()) {
      items.push({ kind: 'run', bindingId: run.bindingId, bindingName: name(run.bindingId), title: `${run.flowId}: chờ bạn`, message: run.needsUser?.message ?? 'Run đang chờ người xử lý', at: run.needsUser?.since ?? run.queuedAt, data: { runId: run.id, reason: run.needsUser?.reason ?? null }, run });
    }
    for (const b of bindings) {
      for (const p of health.listPauses(b.id, { open: true })) {
        if (!USER_CLEARABLE_PAUSE_REASONS.includes(p.reason)) continue;
        items.push({ kind: 'pause', bindingId: b.id, bindingName: b.displayName, title: 'Dừng chờ gỡ', message: `Lý do: ${p.reason}`, at: p.createdAt, data: { pauseId: p.id, reason: p.reason } });
      }
      const exit = health.listProxyChecks(b.id, 20).find((c) => c.ok);
      if (exit && (exit.asnType === null || exit.asnType === 'unknown') && exit.asn !== null && !health.listAsnAttestations().some((a) => a.asn === exit.asn)) {
        items.push({ kind: 'asn_unclassified', bindingId: b.id, bindingName: b.displayName, title: 'ASN chưa phân loại', message: `AS${exit.asn} ${exit.asnOrg ?? ''} — xác nhận loại ASN trong Cài đặt → ASN`, at: exit.checkedAt, data: { asn: exit.asn } });
      }
    }
    for (const s of health.listChecklistExpiring(7)) {
      items.push({ kind: 'checklist_expiring', bindingId: s.bindingId, bindingName: name(s.bindingId), title: 'Checklist sắp hết hạn', message: `Hết hạn ${s.expiresAt ?? ''} — xác nhận lại checklist`, at: s.expiresAt ?? deps.clock.nowIso(), data: {} });
    }
    const version = health.currentFuryVersion();
    if (version && !detect.hasPassed(version)) {
      items.push({ kind: 'fury_no_detect_suite', bindingId: null, bindingName: null, title: `Fury ${version} chưa có kết quả detect-suite`, message: 'Chạy fury-detect gate rồi nhập kết quả trong Cài đặt → Detect-suite', at: deps.clock.nowIso(), data: { furyVersion: version } });
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return { items };
  });

  app.post('/internal/bindings/:id/events/:eventId/undo', async (req, reply) => {
    const { id, eventId } = parse(UndoEventParamsSchema, req.params, 'params');
    return reply.code(201).send(await health.undoManualEvent(id, eventId, 'user'));
  });
}
