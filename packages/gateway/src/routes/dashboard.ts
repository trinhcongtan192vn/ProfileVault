import { UndoEventParamsSchema, USER_CLEARABLE_PAUSE_REASONS, type InboxItem, type Overview } from '@sctech/profilevault-contract';
import { buildOverview } from '../overview.js';
import { DetectSuiteRepo } from '@sctech/profilevault-db';
import type { FastifyInstance } from 'fastify';
import { NoRunner, type GatewayDeps } from '../deps.js';
import { parse } from '../security.js';


/** Endpoint tổng hợp cho dashboard (giả định G32): tổng quan, Chờ bạn, hoàn tác. */
export function registerDashboardRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { health } = deps;
  const runner = deps.runner ?? new NoRunner();
  const detect = new DetectSuiteRepo(deps.database.db);

  app.get('/internal/overview', async (): Promise<Overview> => buildOverview(deps, detect));

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
