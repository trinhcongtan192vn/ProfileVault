import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ArtifactParamsSchema,
  BusyModeBodySchema,
  ChartNameSchema,
  ChartQuerySchema,
  ClientCreateInputSchema,
  ClientIdParamsSchema,
  ExportDatasetSchema,
  ExportQuerySchema,
  GlobalPauseBodySchema,
  JobsQuerySchema,
  PvError,
  ResolveGateBodySchema,
  RuleIdParamsSchema,
  RulePatchSchema,
  RunIdParamsSchema,
  RunnerSettingsSchema,
  ScheduleIdParamsSchema,
  ScheduleInputSchema,
  ThresholdsSchema,
  type RunnerSettings,
  type SystemInfo,
} from '@sctech/profilevault-contract';
import { ClientsRepo, DetectSuiteRepo, stripHash } from '@sctech/profilevault-db';
import type { FastifyInstance } from 'fastify';
import { DASHBOARD_CLIENT } from '@sctech/profilevault-jobs';
import { z } from 'zod';
import { buildChart } from '../charts.js';
import { createClient, revokeClient } from '../clients.js';
import { exportDataset, toCsv } from '../csv.js';
import { NoRunner, type GatewayDeps } from '../deps.js';
import { parse } from '../security.js';

export const RUNNER_SETTING = 'runner';
/** Trùng `P4_SETTING` của Runner (không import Runner vào gateway). */
export const P4_SETTING = 'spike.p4Passed';
const P4BodySchema = z.object({ passed: z.boolean() });

/** Nhóm Job/run, Lịch, Cài đặt, Client, Biểu đồ, Xuất, Hệ thống (SPEC-05 §7). */
export function registerOpsRoutes(app: FastifyInstance, deps: GatewayDeps): void {
  const runner = deps.runner ?? new NoRunner();
  const clientsRepo = new ClientsRepo(deps.database.db);
  const detectRepo = new DetectSuiteRepo(deps.database.db);

  // ---- Job / run ----
  app.get('/internal/jobs', async (req) => {
    const q = parse(JobsQuerySchema, req.query ?? {}, 'query');
    return { jobs: runner.listJobs(q) };
  });
  app.get('/internal/flows', async () => ({ flows: runner.listFlows() }));
  app.get('/internal/runs/:id', async (req) => {
    const { id } = parse(RunIdParamsSchema, req.params, 'params');
    const run = runner.getRun(id);
    if (!run) throw new PvError('FLOW_NOT_FOUND', 'Không có run này', { runId: id });
    return run;
  });
  app.post('/internal/runs/:id/cancel', async (req, reply) => {
    const { id } = parse(RunIdParamsSchema, req.params, 'params');
    await runner.cancelRun(id, 'user');
    return reply.code(204).send();
  });
  app.post('/internal/runs/:id/resolve', async (req, reply) => {
    const { id } = parse(RunIdParamsSchema, req.params, 'params');
    await runner.resolveGate(id, parse(ResolveGateBodySchema, req.body), 'user');
    return reply.code(204).send();
  });
  app.get('/internal/runs/:id/artifacts/:name', async (req, reply) => {
    const { id, name } = parse(ArtifactParamsSchema, req.params, 'params');
    const p = runner.artifactPath(id, name);
    if (!p || !existsSync(p)) throw new PvError('FILE_NOT_FOUND', 'Không có artifact này', { runId: id, name });
    return reply.header('content-disposition', `attachment; filename="${path.basename(p)}"`).send(await import('node:fs').then((fs) => fs.createReadStream(p)));
  });

  // ---- Gửi job từ dashboard (client đặc biệt `dashboard`, SPEC-06 §2) ----
  app.post('/internal/jobs', async (req, reply) => {
    if (!deps.jobs) throw new PvError('FLOW_DISABLED', 'Job service chưa sẵn sàng');
    const { job, duplicate } = await deps.jobs.submit(req.body as never, DASHBOARD_CLIENT);
    return reply.code(duplicate ? 200 : 201).send(job);
  });

  // ---- Spike P4: chỉ người xác nhận (mở khóa flow có chế độ L2/L3) ----
  app.get('/internal/settings/p4', async () => ({ passed: deps.settings.get<boolean>(P4_SETTING) === true }));
  app.put('/internal/settings/p4', async (req) => {
    const { passed } = parse(P4BodySchema, req.body);
    deps.settings.set(P4_SETTING, passed, 'user');
    deps.audit.append({ actorType: 'user', action: 'spike.p4', detail: { passed } });
    return { passed };
  });

  // ---- Lịch ----
  app.get('/internal/schedules', async () => ({ schedules: runner.schedules.list() }));
  app.post('/internal/schedules', async (req, reply) => reply.code(201).send(runner.schedules.create(parse(ScheduleInputSchema, req.body), 'user')));
  app.patch('/internal/schedules/:id', async (req) => {
    const { id } = parse(ScheduleIdParamsSchema, req.params, 'params');
    return runner.schedules.update(id, parse(ScheduleInputSchema.partial(), req.body), 'user');
  });
  app.delete('/internal/schedules/:id', async (req, reply) => {
    const { id } = parse(ScheduleIdParamsSchema, req.params, 'params');
    runner.schedules.remove(id, 'user');
    return reply.code(204).send();
  });

  // ---- Cài đặt ----
  app.get('/internal/settings/thresholds', async () => ({ thresholds: deps.health.getThresholds(), history: deps.settings.history('thresholds', 50) }));
  app.put('/internal/settings/thresholds', async (req) => {
    deps.health.setThresholds(parse(ThresholdsSchema, req.body), 'user');
    return { thresholds: deps.health.getThresholds() };
  });
  app.get('/internal/rules', async () => ({ rules: deps.health.getRules() }));
  app.patch('/internal/rules/:id', async (req) => {
    const { id } = parse(RuleIdParamsSchema, req.params, 'params');
    return deps.health.setRule(id, parse(RulePatchSchema, req.body), 'user');
  });
  const effectiveRunnerSettings = (): RunnerSettings => {
    const stored = deps.settings.get<Partial<RunnerSettings>>(RUNNER_SETTING) ?? {};
    const merged = {
      maxConcurrentIdle: deps.config.runner.maxConcurrentIdle,
      maxConcurrentBusy: deps.config.runner.maxConcurrentBusy,
      ramPerProfileMb: deps.config.runner.ramPerProfileMb,
      profileBusyTimeoutMinutes: deps.config.runner.profileBusyTimeoutMinutes,
      humanGateTimeoutHours: deps.config.runner.humanGateTimeoutHours,
      uploadsPerAccountPerDay: deps.config.limits.uploadsPerAccountPerDay,
      ...stored,
    };
    return RunnerSettingsSchema.parse(merged);
  };
  app.get('/internal/settings/runner', async () => ({ runner: effectiveRunnerSettings(), history: deps.settings.history(RUNNER_SETTING, 50) }));
  app.put('/internal/settings/runner', async (req) => {
    const v = parse(RunnerSettingsSchema, req.body);
    deps.settings.set(RUNNER_SETTING, v, 'user');
    deps.audit.append({ actorType: 'user', action: 'settings.runner', detail: { keys: Object.keys(v) } });
    return { runner: effectiveRunnerSettings() };
  });

  // ---- Client ----
  app.get('/internal/clients', async () => ({ clients: clientsRepo.list().map(stripHash) }));
  app.post('/internal/clients', async (req, reply) => {
    const input = parse(ClientCreateInputSchema, req.body);
    return reply.code(201).send(await createClient(clientsRepo, deps.audit, deps.clock, input, deps.random));
  });
  app.post('/internal/clients/:id/revoke', async (req) => {
    const { id } = parse(ClientIdParamsSchema, req.params, 'params');
    return revokeClient(clientsRepo, deps.audit, deps.clock, id);
  });

  // ---- Biểu đồ ----
  app.get('/internal/charts/:name', async (req) => {
    const name = parse(ChartNameSchema, (req.params as { name: string }).name, 'params');
    const q = parse(ChartQuerySchema, req.query ?? {}, 'query');
    return buildChart(
      name,
      q,
      {
        events: (f) => deps.health.listEvents(f.bindingId, { types: f.types, since: f.since, until: f.until, limit: 10_000, order: 'asc' }),
        proxyChecks: (id) => deps.health.listProxyChecks(id, 10_000),
        detectSuite: () => detectRepo.list(1000),
        consistencyRuns: (id) => {
          const latest = deps.health.getConsistency(id);
          return latest ? [{ finishedAt: latest.finishedAt, startedAt: latest.finishedAt ?? deps.clock.nowIso(), ratio: latest.score.ratio, blockFailing: latest.score.blockFailing }] : [];
        },
        binding: (id) => deps.health.getBinding(id),
      },
      deps.config.ui.timezone,
      deps.clock.now(),
    );
  });

  // ---- Xuất CSV ----
  app.get('/internal/export/:dataset', async (req, reply) => {
    const raw = (req.params as { dataset: string }).dataset;
    if (!raw.endsWith('.csv')) throw new PvError('FLOW_NOT_FOUND', 'Chỉ hỗ trợ .csv', { dataset: raw });
    const dataset = parse(ExportDatasetSchema, raw.slice(0, -4), 'params');
    const q = parse(ExportQuerySchema, req.query ?? {}, 'query');
    const { columns, rows } = exportDataset(deps.database.db, dataset, q);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${dataset}-${deps.clock.nowIso().slice(0, 10)}.csv"`)
      .send(toCsv(rows, columns));
  });

  // ---- Hệ thống ----
  app.get('/internal/system', async (): Promise<SystemInfo> => {
    const info = runner.systemInfo();
    const bindings = deps.health.listBindings();
    const openPauses = bindings.reduce((n, b) => n + deps.health.listPauses(b.id, { open: true }).length, 0);
    return {
      service: { version: deps.serviceVersion ?? '0.0.0', startedAt: deps.startedAt ?? deps.clock.nowIso(), now: deps.clock.nowIso() },
      fury: deps.poller.lastHealth,
      queue: info.queue,
      runningProfiles: info.runningProfiles,
      ramFreeMb: Math.round(os.freemem() / 1048576),
      ramTotalMb: Math.round(os.totalmem() / 1048576),
      busyMode: info.busyMode,
      globalPause: info.globalPause,
      packs: info.packs,
      bindings: bindings.length,
      openPauses,
      waitingForUser: info.queue.needsUser,
    };
  });
  app.post('/internal/system/global-pause', async (req) => {
    const { paused } = parse(GlobalPauseBodySchema, req.body);
    runner.setGlobalPause(paused);
    deps.audit.append({ actorType: 'user', action: 'system.global_pause', detail: { paused } });
    return { globalPause: paused };
  });
  app.post('/internal/system/busy-mode', async (req) => {
    const { busy } = parse(BusyModeBodySchema, req.body);
    runner.setBusyMode(busy);
    deps.audit.append({ actorType: 'user', action: 'system.busy_mode', detail: { busy } });
    return { busyMode: busy };
  });
}
