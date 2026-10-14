import { PvError, systemClock, type Clock, type Config } from '@sctech/profilevault-contract';
import {
  acquireInstanceLock,
  createLogger,
  DpapiSecretStore,
  ensureDirs,
  ensureHmacKey,
  EventBus,
  loadConfig,
  resolvePaths,
  SeederRegistry,
  type InstanceLock,
  type Logger,
  type Paths,
  type SecretStore,
} from '@sctech/profilevault-core';
import { AuditRepo, openDatabase, SettingsRepo, type Database } from '@sctech/profilevault-db';
import { FURY_API_DEFAULT_PORT, furyTokenFile, furyTokenSource, FuryInstaller, FuryStatusPoller, HttpFuryClient, type FuryClient, type Timers } from '@sctech/profilevault-fury-client';
import { createHealth, type HealthBundle, type HealthService } from '@sctech/profilevault-health';
import { createGateway, type Gateway, type RunnerFacade } from '@sctech/profilevault-gateway';
import { PackLoader, Runner } from '@sctech/profilevault-runner';
import { captureHostSnapshot } from '@sctech/profilevault-host-info';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, existsSync } from 'node:fs';

export const SERVICE_VERSION = '0.1.0';

export interface BootstrapOptions {
  env?: NodeJS.ProcessEnv;
  /** Mặc định `DpapiSecretStore` (chỉ Windows). Test truyền `MemorySecretStore`. */
  secretStore?: SecretStore;
  clock?: Clock;
  timers?: Timers;
  seeders?: SeederRegistry;
  /** Ghi log ra stdout (dev). */
  logToStdout?: boolean;
  /** Tiêm cho test khóa. */
  pidAlive?: (pid: number) => boolean;
  /** Tiêm cho test khóa (giả lập tiến trình khác). */
  pid?: number;
  /** Tiêm FuryClient (test); mặc định `HttpFuryClient` từ config. */
  fury?: FuryClient;
  /** Khởi động poller + lịch nền (mặc định true; test đặt false). */
  startBackground?: boolean;
  /** Gateway lắng nghe cổng (mặc định = startBackground). */
  listen?: boolean;
  /** Runner facade tiêm cho test; mặc định Runner thật. */
  runner?: RunnerFacade;
  /** Thư mục SPA đã build; mặc định apps/dashboard/dist cạnh service. */
  staticDir?: string;
  /** Tiêm bộ tự cài Fury (test); mặc định `FuryInstaller` thật. */
  furyInstaller?: FuryInstaller;
}

export interface ServiceContext {
  paths: Paths;
  config: Config;
  database: Database;
  settings: SettingsRepo;
  audit: AuditRepo;
  bus: EventBus;
  logger: Logger;
  secrets: SecretStore;
  clock: Clock;
  fury: FuryClient;
  poller: FuryStatusPoller;
  health: HealthService;
  healthBundle: HealthBundle;
  gateway: Gateway;
  runner: RunnerFacade;
  furyInstaller: FuryInstaller;
  /** URL gateway khi đã listen. */
  gatewayUrl: string | null;
  firstRun: boolean;
  seeded: string[];
  shutdown(): Promise<void>;
}

/** Cài đặt mặc định do 001 seed (data-model.md). Ngưỡng/luật do 003/004 seed. */
export const DEFAULT_RUNNER_SETTINGS = {
  humanize: { actionDelayMs: [300, 1200], typingDelayMs: [40, 140] },
  traceAlways: false,
} as const;

/**
 * Khởi động theo thứ tự SPEC-00 §11 / spec 001 US5:
 * khóa → thư mục → cấu hình → bí mật (HMAC) → CSDL + migration → bus → Fury/Health → seed → audit → nền.
 */
export async function bootstrap(opts: BootstrapOptions = {}): Promise<ServiceContext> {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? systemClock;
  const paths = resolvePaths(env);

  // 1. Khóa một phiên bản (trước mọi thứ để hai tiến trình không cùng tạo thư mục/CSDL)
  ensureDirs(paths);
  const lock: InstanceLock = acquireInstanceLock(paths.lockFile, { startedAt: clock.nowIso(), pidAlive: opts.pidAlive, pid: opts.pid });

  let database: Database | undefined;
  let logger: Logger | undefined;
  let poller: FuryStatusPoller | undefined;
  let healthBundle: HealthBundle | undefined;
  let gateway: Gateway | undefined;
  let ownedRunner: Runner | undefined;
  try {
    // 2. Cấu hình
    // Thiếu FURY_API_PORT (vd service khởi từ cửa sổ có môi trường cũ) → cổng quy ước của Fury
    const loaded = loadConfig(paths, { ...env, FURY_API_PORT: env.FURY_API_PORT ?? String(FURY_API_DEFAULT_PORT) });
    const tokenFile = furyTokenFile(env, loaded.config.fury.dataDir);

    // 3. Bí mật
    const secrets = opts.secretStore ?? defaultSecretStore(paths.secretsFile);
    const secretValuesCache: string[] = [];
    const refreshSecretCache = async () => {
      secretValuesCache.splice(0, secretValuesCache.length, ...(await secrets.values()));
    };
    const hmac = await ensureHmacKey(secrets);
    await refreshSecretCache();

    // 4. Log (che bí mật)
    logger = createLogger({
      dir: paths.logsDir,
      clock,
      redact: () => secretValuesCache,
      sink: opts.logToStdout ? (line) => console.log(line) : undefined,
    });
    if (!loaded.fromFile) logger.info('config.json không có, dùng mặc định', { file: paths.configFile });
    if (loaded.missingEnv.length > 0) logger.warn('config.json tham chiếu biến môi trường thiếu', { missing: loaded.missingEnv });
    if (hmac.created) logger.info('đã sinh khóa HMAC');

    // 5. CSDL + migration
    database = openDatabase({ file: paths.dbFile, now: () => clock.nowIso() });
    if (database.migration && database.migration.applied.length > 0) {
      logger.info('đã áp migration', { applied: database.migration.applied, current: database.migration.current });
    }
    const settings = new SettingsRepo(database.db, clock);
    const audit = new AuditRepo(database.db, clock);

    // 6. Bus
    const bus = new EventBus({ onListenerError: (event, err) => logger?.error('listener lỗi', { event, err: String(err) }) });

    // 7. Fury + Health (SPEC-01, SPEC-02)
    const fury =
      opts.fury ??
      new HttpFuryClient({
        baseUrl: loaded.config.fury.apiBaseUrl,
        supportedVersions: loaded.config.fury.supportedVersions,
        getToken: furyTokenSource(secrets, tokenFile),
        exitLookup: loaded.config.fury.exitLookup,
        clock,
        timers: opts.timers,
        logger: logger.child({ pkg: 'fury-client' }),
      });
    const healthRef: { current: HealthService | null } = { current: null };
    poller = new FuryStatusPoller({
      client: fury,
      bus,
      clock,
      timers: opts.timers,
      logger: logger.child({ pkg: 'fury-poller' }),
      listBoundProfileIds: () => healthRef.current?.listBindings().map((b) => b.furyProfileId) ?? [],
      onProfileStatusChanged: (profileId, open, at) => healthRef.current?.recordFuryProfileStatus(profileId, open, at),
      onVersionChanged: (from, to) => healthRef.current?.recordFuryVersionChanged(from, to),
    });
    const pollerRef = poller;
    healthBundle = createHealth({
      database,
      bus,
      clock,
      timers: opts.timers,
      fury,
      logger: logger.child({ pkg: 'health' }),
      config: loaded.config,
      audit,
      settings,
      secrets,
      probesDir: paths.probesDir,
      captureHost: () => captureHostSnapshot({ now: () => clock.nowIso() }),
      isFuryReachable: () => pollerRef.lastHealth?.reachable ?? false,
      currentFuryVersion: () => pollerRef.lastHealth?.version,
    });
    healthRef.current = healthBundle.health;

    // 8. Seed
    const firstRun = !settings.has('schema_version');
    settings.set('schema_version', { migration: database.migration?.current ?? 0 }, 'system');
    if (!settings.has('runner')) settings.set('runner', DEFAULT_RUNNER_SETTINGS, 'system');
    const registry = opts.seeders ?? new SeederRegistry();
    if (!registry.names().includes('thresholds')) registry.register('thresholds', healthBundle.thresholdsSeeder);
    if (!registry.names().includes('consistency_rules')) registry.register('consistency_rules', healthBundle.rulesSeeder);
    const seeded = await registry.run({ database, settings, clock, logger });

    // 9. Audit
    if (firstRun) audit.append({ actorType: 'system', action: 'system.first_run', detail: { version: SERVICE_VERSION } });
    audit.append({
      actorType: 'system',
      action: 'system.started',
      detail: { version: SERVICE_VERSION, schemaVersion: database.migration?.current ?? 0, firstRun },
    });
    logger.info('dịch vụ đã khởi động', { version: SERVICE_VERSION, firstRun, pid: process.pid });

    // 10. Gateway (SPEC-05)
    if (!opts.runner) {
      const loader = new PackLoader(() => healthBundle?.health.currentFuryVersion());
      const packsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packs');
      for (const name of ['generic', 'youtube']) await loader.load(path.join(packsDir, name));
      for (const entry of readdirSync(paths.extensionsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.isSymbolicLink())) {
        const dir = path.join(paths.extensionsDir, entry.name);
        if (!existsSync(path.join(dir, 'pack.json'))) continue;
        try { await loader.load(dir); } catch (err) { logger.warn('Không nạp được pack mở rộng', { pack: entry.name, error: String(err) }); }
      }
      ownedRunner = new Runner({ database, clock, config: loaded.config, settings, audit, bus, health: healthBundle.health, fury, logger: logger.child({ pkg: 'runner' }), runsDir: paths.runsDir, loader, timers: opts.timers });
      await ownedRunner.recover();
    }
    const runner = opts.runner ?? ownedRunner!;
    // Tự cài Fury bản đã ghim khi máy chưa có (SPEC-00 §11.1).
    // Cài xong còn bật automation API (biến user FURY_API_PORT); token đọc từ file api-token của Fury (SPIKE-P2).
    const furyInstaller =
      opts.furyInstaller ??
      new FuryInstaller({
        localAppData: env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
        downloadsDir: path.join(paths.localAppData, 'downloads'),
        clock,
        logger: logger.child({ pkg: 'fury-installer' }),
      });
    const auditRef = audit;
    let lastInstallState = furyInstaller.status().state;
    const prevOnStatus = furyInstaller.onStatus;
    furyInstaller.onStatus = (s) => {
      prevOnStatus?.(s);
      if (lastInstallState === 'installing' && s.state === 'ready') {
        auditRef.append({ actorType: 'system', action: 'fury.installed', detail: { appVersion: s.appVersion, coreVersion: s.coreVersion, pinnedVersion: s.pinnedVersion } });
      }
      lastInstallState = s.state;
    };
    if (!loaded.config.fury.autoInstall) furyInstaller.disable();
    gateway = await createGateway({
      config: loaded.config,
      clock,
      timers: opts.timers,
      bus,
      logger: logger.child({ pkg: 'gateway' }),
      health: healthBundle.health,
      fury,
      poller,
      secrets,
      audit,
      settings,
      database,
      paths: { probesDir: paths.probesDir },
      runner,
      furyInstall: furyInstaller,
      furyTokenFile: tokenFile,
      staticDir: opts.staticDir ?? defaultStaticDir(),
      serviceVersion: SERVICE_VERSION,
      startedAt: clock.nowIso(),
    });
    let gatewayUrl: string | null = null;
    if (opts.listen ?? opts.startBackground !== false) gatewayUrl = await gateway.listen();

    // 11. Nền: poller Fury + lịch kiểm proxy
    if (opts.startBackground !== false) {
      poller.start();
      void poller.tickHealth().catch(() => undefined);
      healthBundle.health.start();
      ownedRunner?.start();
      if (loaded.config.fury.autoInstall) {
        void furyInstaller.ensure().then((s) => {
          if (s.state === 'ready') void pollerRef.tickHealth().catch(() => undefined);
        });
      }
    }

    let stopped = false;
    const ctx: ServiceContext = {
      paths,
      config: loaded.config,
      database,
      settings,
      audit,
      bus,
      logger,
      secrets,
      clock,
      fury,
      poller,
      health: healthBundle.health,
      healthBundle,
      gateway,
      runner,
      furyInstaller,
      gatewayUrl,
      firstRun,
      seeded,
      async shutdown() {
        if (stopped) return;
        stopped = true;
        try {
          pollerRef.stop();
          await ownedRunner?.stop();
          healthBundle?.health.stop();
          await gateway?.close();
          audit.append({ actorType: 'system', action: 'system.stopped', detail: { version: SERVICE_VERSION } });
          logger?.info('dịch vụ dừng');
        } finally {
          bus.removeAll();
          database?.close();
          logger?.close();
          lock.release();
        }
      },
    };
    return ctx;
  } catch (err) {
    poller?.stop();
    await ownedRunner?.stop();
    healthBundle?.health.stop();
    await gateway?.close().catch(() => undefined);
    database?.close();
    logger?.close();
    lock.release();
    throw err;
  }
}

function defaultSecretStore(file: string): SecretStore {
  if (process.platform !== 'win32') {
    throw new PvError('INTERNAL', 'ProfileVault chỉ chạy trên Windows (DPAPI). Trên nền tảng khác chỉ chạy test với MemorySecretStore.', {
      reason: 'platform_unsupported',
      platform: process.platform,
    });
  }
  return new DpapiSecretStore(file);
}

/** apps/dashboard/dist cạnh apps/service (cả khi chạy từ src/ lẫn dist/). */
function defaultStaticDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'dist');
}
