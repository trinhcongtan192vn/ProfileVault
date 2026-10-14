import { createServer } from 'node:net';
import path from 'node:path';
import { DEFAULT_CONFIG, FakeClock, type Config, type FlowInfo, type JobRecord, type RunRecord, type Schedule } from '@sctech/profilevault-contract';
import { EventBus, MemorySecretStore, silentLogger } from '@sctech/profilevault-core';
import { AuditRepo, openTestDatabase, SettingsRepo, type TestDatabase } from '@sctech/profilevault-db';
import { FakeTimers, FuryStatusPoller, HttpFuryClient } from '@sctech/profilevault-fury-client';
import { FakeFury, TEST_ENDPOINT_MAP } from '@sctech/profilevault-fury-client/testing';
import { createHealth, type HealthBundle } from '@sctech/profilevault-health';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { createGateway, CSRF_HEADER, SESSION_COOKIE, type Gateway, type RunnerFacade } from '../src/index.js';

export interface GwHarness {
  gw: Gateway;
  t: TestDatabase;
  clock: FakeClock;
  bus: EventBus;
  fake: FakeFury;
  timers: FakeTimers;
  settings: SettingsRepo;
  audit: AuditRepo;
  secrets: MemorySecretStore;
  bundle: HealthBundle;
  config: Config;
  port: number;
  /** Lấy phiên hợp lệ: cookie + csrf. */
  login(): Promise<{ cookie: string; csrf: string }>;
  /** inject với phiên; tự thêm Host, cookie, CSRF cho phương thức ghi. */
  api(opts: InjectOptions & { noAuth?: boolean; noCsrf?: boolean }): Promise<LightMyRequestResponse>;
  cleanup(): Promise<void>;
}

export class FakeRunner implements RunnerFacade {
  jobs: JobRecord[] = [];
  runs = new Map<string, RunRecord>();
  cancelled: string[] = [];
  resolved: { runId: string; choice: string }[] = [];
  globalPause = false;
  busyMode = false;
  scheduleList: Schedule[] = [];
  listJobs(f: { status?: string; bindingId?: string; limit?: number }) {
    return this.jobs.filter((j) => (!f.status || j.status === f.status) && (!f.bindingId || j.bindingId === f.bindingId)).slice(0, f.limit ?? 50);
  }
  getRun(id: string) {
    return this.runs.get(id);
  }
  listNeedsUser() {
    return [...this.runs.values()].filter((r) => r.status === 'needs_user');
  }
  async cancelRun(id: string) {
    this.cancelled.push(id);
  }
  async resolveGate(id: string, r: { choice: string }) {
    this.resolved.push({ runId: id, choice: r.choice });
  }
  artifactPath() {
    return undefined;
  }
  listFlows(): FlowInfo[] {
    return [{ id: 'youtube/session-check', version: '1.0.0', minLevel: 1, modes: [], status: 'enabled' }];
  }
  systemInfo() {
    return { queue: { queued: 1, running: 0, needsUser: 2 }, runningProfiles: 0, busyMode: this.busyMode, globalPause: this.globalPause, packs: [{ id: 'youtube', version: '1.0.0', status: 'enabled' as const, flows: ['session-check'] }] };
  }
  setGlobalPause(p: boolean) {
    this.globalPause = p;
  }
  setBusyMode(b: boolean) {
    this.busyMode = b;
  }
  schedules = {
    list: () => this.scheduleList,
    create: (input: Parameters<RunnerFacade['schedules']['create']>[0]): Schedule => {
      const s: Schedule = { ...input, params: input.params ?? {}, enabled: input.enabled ?? true, id: 'sc_01JAAAAAAAAAAAAAAAAAAAAAAA', nextRunAt: null, lastRunAt: null, createdAt: '2026-10-14T00:00:00.000Z' };
      this.scheduleList.push(s);
      return s;
    },
    update: (id: string, patch: Partial<Parameters<RunnerFacade['schedules']['create']>[0]>): Schedule => {
      const s = this.scheduleList.find((x) => x.id === id)!;
      Object.assign(s, patch);
      return s;
    },
    remove: (id: string) => {
      this.scheduleList = this.scheduleList.filter((x) => x.id !== id);
    },
  };
}

/** Cổng trống trên loopback (test listen thật mà không đụng ProfileVault đang chạy ở 50410). */
export async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = (srv.address() as { port: number }).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

export async function makeGateway(opts: { runner?: RunnerFacade; staticDir?: string; port?: number; host?: string } = {}): Promise<GwHarness> {
  const t = openTestDatabase();
  const clock = new FakeClock('2026-10-14T03:00:00.000Z');
  const bus = new EventBus({ onListenerError: () => undefined });
  const fake = new FakeFury({ version: '0.2.23' });
  await fake.start();
  const timers = new FakeTimers();
  const fury = new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, clock, maxRetries: 0, endpoints: TEST_ENDPOINT_MAP });
  const settings = new SettingsRepo(t.database.db, clock);
  const audit = new AuditRepo(t.database.db, clock);
  const secrets = new MemorySecretStore({ 'hmac.key': Buffer.alloc(32, 9).toString('base64') });
  const port = opts.port ?? 50410;
  const config: Config = { ...DEFAULT_CONFIG, gateway: { host: opts.host ?? '127.0.0.1', port } };
  const poller = new FuryStatusPoller({ client: fury, bus, clock, timers, listBoundProfileIds: () => [] });
  const bundle = createHealth({
    database: t.database,
    bus,
    clock,
    timers,
    fury,
    logger: silentLogger,
    config,
    audit,
    settings,
    secrets,
    probesDir: path.join(t.dir, 'probes'),
    captureHost: async () => ({ os: 'windows', osVersion: '10', gpus: [], displays: [], ramMb: 1, capturedAt: clock.nowIso() }),
    schedulerSeed: 1,
  });
  await bundle.thresholdsSeeder({ database: t.database, settings, clock, logger: silentLogger });
  await bundle.rulesSeeder({ database: t.database, settings, clock, logger: silentLogger });
  bundle.policy.setCurrentFuryVersion('0.2.23');
  await poller.tickHealth();
  const gw = await createGateway({
    config,
    clock,
    timers,
    bus,
    logger: silentLogger,
    health: bundle.health,
    fury,
    poller,
    secrets,
    audit,
    settings,
    database: t.database,
    paths: { probesDir: path.join(t.dir, 'probes') },
    runner: opts.runner,
    staticDir: opts.staticDir,
    serviceVersion: '0.1.0-test',
    startedAt: clock.nowIso(),
  });
  const host = `127.0.0.1:${port}`;
  let session: { cookie: string; csrf: string } | null = null;
  const login = async () => {
    const url = new URL(gw.createOpenUrl());
    const res = await gw.app.inject({ method: 'GET', url: url.pathname + url.search, headers: { host } });
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
    const cookie = raw.split(';')[0]!;
    const s = await gw.app.inject({ method: 'GET', url: '/internal/session', headers: { host, cookie } });
    const csrf = (s.json() as { csrfToken: string }).csrfToken;
    session = { cookie, csrf };
    return session;
  };
  return {
    gw,
    t,
    clock,
    bus,
    fake,
    timers,
    settings,
    audit,
    secrets,
    bundle,
    config,
    port,
    login,
    async api(o) {
      const { noAuth, noCsrf, ...rest } = o;
      if (!noAuth && !session) await login();
      const headers: Record<string, string> = { host, ...((rest.headers as Record<string, string>) ?? {}) };
      if (!noAuth && session) {
        headers.cookie = session.cookie;
        if (!noCsrf) headers[CSRF_HEADER] = session.csrf;
      }
      return gw.app.inject({ ...rest, headers });
    },
    async cleanup() {
      await gw.close();
      bundle.health.stop();
      await fake.stop();
      t.cleanup();
    },
  };
}

export { SESSION_COOKIE, CSRF_HEADER };
