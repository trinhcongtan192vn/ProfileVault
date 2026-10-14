import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  BindingIdParamsSchema,
  ChecklistInputSchema,
  ConsistencyRunBodySchema,
  CreateBindingInputSchema,
  DetectSuiteInputSchema,
  AsnAttestationInputSchema,
  EventsQuerySchema,
  FuryTokenInputSchema,
  ManualEventBodySchema,
  PauseBodySchema,
  PauseIdParamsSchema,
  ProbeJsonBodySchema,
  PvError,
  UpdateBindingInputSchema,
  type FuryInstallStatus,
  type FuryProfileListItem,
  type FuryStatus,
} from '@sctech/profilevault-contract';
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from '../deps.js';
import { parse } from '../security.js';

/** Nhóm Fury, Binding, Mức, Dừng, Sự kiện, Probe, Checklist, Nhất quán, Detect-suite, ASN (SPEC-05 §7). */
export function registerCoreRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const { health } = deps;

  // ---- Fury ----
  const installStatus = (): FuryInstallStatus =>
    deps.furyInstall?.status() ?? { state: 'disabled', step: null, pinnedVersion: '', appVersion: null, coreVersion: null, progress: null, error: null, updatedAt: deps.clock.nowIso() };
  app.get('/internal/fury/install', async () => installStatus());
  /** Thử cài lại (nút trên dashboard); chạy nền, trả trạng thái ngay. */
  app.post('/internal/fury/install', async (_req, reply) => {
    const inst = deps.furyInstall;
    if (!inst || inst.status().state === 'disabled') throw new PvError('FORBIDDEN_ACTION', 'Tự cài Fury đang tắt (config fury.autoInstall = false)', { reason: 'auto_install_disabled' });
    if (inst.status().state === 'unsupported') throw new PvError('FORBIDDEN_ACTION', 'Tự cài Fury chỉ hỗ trợ Windows', { reason: 'platform_unsupported' });
    void inst.ensure().then((s) => {
      if (s.state === 'ready') void deps.poller.tickHealth().catch(() => undefined);
    });
    deps.audit.append({ actorType: 'user', action: 'fury.install_requested' });
    return reply.code(202).send(installStatus());
  });
  app.get('/internal/fury', async (): Promise<FuryStatus> => {
    const h = deps.poller.lastHealth ?? (await deps.fury.health());
    let capabilities = null;
    try {
      capabilities = await deps.fury.capabilities();
    } catch {
      /* missing */
    }
    return { health: h, capabilities, currentVersion: health.currentFuryVersion() ?? null, apiBaseUrl: deps.config.fury.apiBaseUrl, supportedVersions: deps.config.fury.supportedVersions, hasToken: (await deps.secrets.get('fury.token')) !== undefined || (deps.furyTokenFile !== undefined && existsSync(deps.furyTokenFile)) };
  });
  app.put('/internal/fury/token', async (req, reply) => {
    const { token } = parse(FuryTokenInputSchema, req.body);
    await deps.secrets.set('fury.token', token);
    deps.audit.append({ actorType: 'user', action: 'fury.token.set' });
    await deps.poller.tickHealth().catch(() => undefined);
    return reply.code(204).send();
  });
  app.get('/internal/fury/profiles', async (): Promise<{ profiles: FuryProfileListItem[] }> => {
    const profiles = await deps.fury.listProfiles();
    const bound = new Map(health.listBindings().map((b) => [b.furyProfileId, b.id]));
    return { profiles: profiles.map((p) => ({ ...p, bound: bound.has(p.id), bindingId: bound.get(p.id) ?? null })) };
  });

  // ---- Binding ----
  app.get('/internal/bindings', async (req) => {
    const q = (req.query ?? {}) as { includeArchived?: string };
    return { bindings: health.listBindings({ includeArchived: q.includeArchived === 'true' }) };
  });
  app.post('/internal/bindings', async (req, reply) => {
    const input = parse(CreateBindingInputSchema, req.body);
    const b = await health.createBinding(input, 'user');
    return reply.code(201).send(b);
  });
  app.get('/internal/bindings/:id', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    const b = health.getBinding(id);
    if (!b) throw new PvError('ACCOUNT_NOT_BOUND', 'Không có binding', { bindingId: id });
    return b;
  });
  app.patch('/internal/bindings/:id', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    return health.updateBinding(id, parse(UpdateBindingInputSchema, req.body), 'user');
  });
  app.delete('/internal/bindings/:id', async (req, reply) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    await health.archiveBinding(id, 'user');
    return reply.code(204).send();
  });

  // ---- Mức ----
  app.get('/internal/bindings/:id/readiness', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    const q = (req.query ?? {}) as { fresh?: string };
    return health.evaluateReadiness(id, { fresh: q.fresh === 'true' });
  });
  app.post('/internal/bindings/:id/promote', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    return health.promote(id, 'user');
  });

  // ---- Dừng ----
  app.post('/internal/bindings/:id/pause', async (req, reply) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    const { note } = parse(PauseBodySchema, req.body ?? {});
    return reply.code(201).send(await health.pause(id, 'user', note));
  });
  app.get('/internal/bindings/:id/pauses', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    const q = (req.query ?? {}) as { open?: string };
    return { pauses: health.listPauses(id, { open: q.open === 'true' }) };
  });
  app.post('/internal/pauses/:id/clear', async (req, reply) => {
    const { id } = parse(PauseIdParamsSchema, req.params, 'params');
    await health.clearPause(id, 'user');
    return reply.code(204).send();
  });
  app.get('/internal/bindings/:id/level-changes', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    return { levelChanges: health.listLevelChanges(id) };
  });

  // ---- Sự kiện ----
  app.post('/internal/bindings/:id/events', async (req, reply) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    const body = parse(ManualEventBodySchema, req.body);
    const ev = await health.recordManualEvent(id, body.type, body.occurredAt, body.note, 'user');
    return reply.code(201).send(ev);
  });
  app.get('/internal/bindings/:id/events', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    const q = parse(EventsQuerySchema, req.query ?? {}, 'query');
    return { events: health.listEvents(id, { types: q.types, since: q.since, until: q.until, limit: q.limit, order: q.order }) };
  });
  app.get('/internal/events', async (req) => {
    const q = parse(EventsQuerySchema, req.query ?? {}, 'query');
    return { events: health.listEvents(undefined, { types: q.types, since: q.since, until: q.until, limit: q.limit, order: q.order }) };
  });

  // ---- Proxy ----
  app.post('/internal/bindings/:id/proxy-check', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    return health.runProxyCheckNow(id);
  });
  app.get('/internal/bindings/:id/proxy-checks', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    return { proxyChecks: health.listProxyChecks(id) };
  });

  // ---- Probe ----
  app.post('/internal/bindings/:id/probes', async (req, reply) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) throw new PvError('INPUT_INVALID', 'Thiếu trường file', { field: 'file' });
      const incoming = path.join(deps.paths.probesDir, 'incoming');
      mkdirSync(incoming, { recursive: true });
      const tmp = path.join(incoming, `${Date.now()}-${path.basename(file.filename).replace(/[^A-Za-z0-9._-]/g, '_')}`);
      await pipeline(file.file, createWriteStream(tmp));
      try {
        const pr = await health.importProbe(id, { filePath: tmp }, 'manual_import', 'user');
        return reply.code(201).send(pr);
      } finally {
        rmSync(tmp, { force: true });
      }
    }
    const { raw } = parse(ProbeJsonBodySchema, req.body);
    return reply.code(201).send(await health.importProbe(id, { raw }, 'manual_import', 'user'));
  });
  app.get('/internal/bindings/:id/probes', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    const probes = health.listProbes(id);
    const cmp = health.compareLatestProbes(id);
    return { probes: probes.map((p) => ({ id: p.id, furyVersion: p.furyVersion, source: p.source, capturedAt: p.capturedAt, createdAt: p.createdAt })), comparison: cmp ? { latestId: cmp.latest.id, previousId: cmp.previous.id, changes: cmp.changes } : null };
  });

  // ---- Checklist ----
  app.get('/internal/bindings/:id/checklist', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    if (!health.getBinding(id)) throw new PvError('ACCOUNT_NOT_BOUND', 'Không có binding', { bindingId: id });
    return health.getChecklist(id);
  });
  app.put('/internal/bindings/:id/checklist', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    return health.upsertChecklist(id, parse(ChecklistInputSchema, req.body), 'user');
  });
  app.post('/internal/bindings/:id/checklist/confirm', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    return health.confirmChecklist(id, 'user');
  });

  // ---- Nhất quán ----
  app.post('/internal/consistency/run', async (req) => {
    const body = parse(ConsistencyRunBodySchema, req.body ?? {});
    return health.runConsistency(body.bindingId ? { bindingId: body.bindingId } : {}, 'manual', 'user');
  });
  app.get('/internal/bindings/:id/consistency', async (req) => {
    const { id } = parse(BindingIdParamsSchema, req.params, 'params');
    if (!health.getBinding(id)) throw new PvError('ACCOUNT_NOT_BOUND', 'Không có binding', { bindingId: id });
    return health.getConsistency(id) ?? { bindingId: id, runId: null, trigger: null, finishedAt: null, score: null, results: [] };
  });
  app.get('/internal/consistency/matrix', async () => health.getCrossMatrix());

  // ---- Detect-suite, ASN ----
  app.post('/internal/detect-suite', async (req, reply) => {
    await health.recordDetectSuite(parse(DetectSuiteInputSchema, req.body), 'user');
    return reply.code(204).send();
  });
  app.post('/internal/asn-attestations', async (req, reply) => {
    await health.attestAsn(parse(AsnAttestationInputSchema, req.body), 'user');
    return reply.code(204).send();
  });
  app.get('/internal/asn-attestations', async () => ({ attestations: health.listAsnAttestations() }));

  // ---- Host ----
  app.get('/internal/host', async () => health.latestHost() ?? null);
  app.post('/internal/host/capture', async () => health.captureHost());

  // dọn thư mục incoming nếu còn sót
  const incoming = path.join(deps.paths.probesDir, 'incoming');
  if (existsSync(incoming)) rmSync(incoming, { recursive: true, force: true });
}
