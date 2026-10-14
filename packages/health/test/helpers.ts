import { FakeClock, type BusEventMap, type BusEventName, type Config, DEFAULT_CONFIG } from '@sctech/profilevault-contract';
import { EventBus, MemorySecretStore, silentLogger } from '@sctech/profilevault-core';
import path from 'node:path';
import { AuditRepo, openTestDatabase, SettingsRepo, type TestDatabase } from '@sctech/profilevault-db';
import { FakeTimers, HttpFuryClient } from '@sctech/profilevault-fury-client';
import { FakeFury } from '@sctech/profilevault-fury-client/testing';
import { createHealth, thresholdsSeeder, type HealthBundle } from '../src/index.js';

export interface Harness {
  t: TestDatabase;
  clock: FakeClock;
  bus: EventBus;
  busLog: { name: BusEventName; payload: unknown }[];
  fake: FakeFury;
  fury: HttpFuryClient;
  timers: FakeTimers;
  settings: SettingsRepo;
  audit: AuditRepo;
  secrets: MemorySecretStore;
  bundle: HealthBundle;
  config: Config;
  cleanup(): Promise<void>;
}

export async function makeHarness(opts: { fakeVersion?: string; timezone?: string } = {}): Promise<Harness> {
  const t = openTestDatabase();
  const clock = new FakeClock('2026-10-14T03:00:00.000Z'); // 10:00 Asia/Bangkok
  const bus = new EventBus({ onListenerError: () => undefined });
  const busLog: { name: BusEventName; payload: unknown }[] = [];
  for (const name of ['health.event_recorded', 'binding.level_changed', 'binding.pause_changed', 'fury.status_changed'] as const) {
    bus.on(name, (p: BusEventMap[typeof name]) => void busLog.push({ name, payload: p }));
  }
  const fake = new FakeFury({ version: opts.fakeVersion ?? '0.2.23' });
  await fake.start();
  const timers = new FakeTimers();
  const fury = new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, clock, maxRetries: 0 });
  const settings = new SettingsRepo(t.database.db, clock);
  const audit = new AuditRepo(t.database.db, clock);
  const config: Config = { ...DEFAULT_CONFIG, ui: { ...DEFAULT_CONFIG.ui, timezone: opts.timezone ?? 'Asia/Bangkok' } };
  const secrets = new MemorySecretStore({ 'hmac.key': Buffer.alloc(32, 7).toString('base64') });
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
    captureHost: async () => ({ os: 'windows', osVersion: '10.0.19045', gpus: [{ name: 'NVIDIA GeForce RTX 5060 Ti' }], displays: [{ width: 2560, height: 1440, primary: true }], ramMb: 32768, capturedAt: clock.nowIso() }),
    schedulerSeed: 42,
  });
  await thresholdsSeeder({ database: t.database, settings, clock, logger: silentLogger });
  await bundle.rulesSeeder({ database: t.database, settings, clock, logger: silentLogger });
  bundle.policy.setCurrentFuryVersion(opts.fakeVersion ?? '0.2.23');
  return {
    t,
    clock,
    bus,
    busLog,
    fake,
    fury,
    timers,
    settings,
    audit,
    secrets,
    bundle,
    config,
    async cleanup() {
      bundle.health.stop();
      await fake.stop();
      t.cleanup();
    },
  };
}

/** Tạo binding kèm checklist đầy đủ đã xác nhận (để C3 không mở `consistency_block`); `withChecklist: false` để bỏ. */
export async function addBinding(h: Harness, n: number, extra: Partial<{ marketCountry: string; level: 0 | 1 | 2 | 3; withChecklist: boolean }> = {}) {
  const id = `p${n}`;
  h.fake.upsertProfile({ id, name: `Kênh ${n}`, personaId: `persona-${n}`, os: 'windows' });
  const b = await h.bundle.health.createBinding({ platform: 'youtube', accountId: `UC${n}`, displayName: `Kênh ${n}`, furyProfileId: id, marketCountry: extra.marketCountry ?? 'DE' });
  if (extra.withChecklist !== false) {
    await h.bundle.health.upsertChecklist(b.id, {
      accountRegion: extra.marketCountry ?? 'DE',
      channelCountry: extra.marketCountry ?? 'DE',
      accountLanguage: 'de-DE',
      recoveryEmail: `kenh${n}@example.com`,
      recoveryPhone: `+49151${String(1000000 + n)}`,
      twofaEnabled: true,
      exclusiveLoginConfirmed: true,
      studioLanguageSet: true,
    });
    await h.bundle.health.confirmChecklist(b.id, 'user');
  }
  if (extra.level !== undefined && extra.level > 0) {
    h.bundle.repos.bindings.setLevel(b.id, extra.level, h.clock.nowIso());
    h.bundle.readiness.invalidate(b.id);
    return h.bundle.repos.bindings.get(b.id)!;
  }
  return b;
}
