import { systemClock, type Clock, type Config } from '@sctech/profilevault-contract';
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
import { PvError } from '@sctech/profilevault-contract';

export const SERVICE_VERSION = '0.1.0';

export interface BootstrapOptions {
  env?: NodeJS.ProcessEnv;
  /** Mặc định `DpapiSecretStore` (chỉ Windows). Test truyền `MemorySecretStore`. */
  secretStore?: SecretStore;
  clock?: Clock;
  seeders?: SeederRegistry;
  /** Ghi log ra stdout (dev). */
  logToStdout?: boolean;
  /** Tiêm cho test khóa. */
  pidAlive?: (pid: number) => boolean;
  /** Tiêm cho test khóa (giả lập tiến trình khác). */
  pid?: number;
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
 * khóa → thư mục → cấu hình → bí mật (HMAC) → CSDL + migration → seed → bus → log → audit.
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
  try {
    // 2. Cấu hình
    const loaded = loadConfig(paths, env);

    // 3. Bí mật
    const secrets = opts.secretStore ?? defaultSecretStore(paths.secretsFile);
    const secretValuesCache: string[] = [];
    const refreshSecretCache = async () => {
      secretValuesCache.splice(0, secretValuesCache.length, ...(await secrets.values()));
    };
    const hmac = await ensureHmacKey(secrets);
    await refreshSecretCache();

    // 4. Log (che bí mật) — tạo sau khi có bí mật để redact đúng
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

    // 6. Seed
    const firstRun = !settings.has('schema_version');
    settings.set('schema_version', { migration: database.migration?.current ?? 0 }, 'system');
    if (!settings.has('runner')) settings.set('runner', DEFAULT_RUNNER_SETTINGS, 'system');
    const registry = opts.seeders ?? new SeederRegistry();
    const seeded = await registry.run({ database, settings, clock, logger });

    // 7. Bus
    const bus = new EventBus({ onListenerError: (event, err) => logger?.error('listener lỗi', { event, err: String(err) }) });

    // 8. Audit
    if (firstRun) audit.append({ actorType: 'system', action: 'system.first_run', detail: { version: SERVICE_VERSION } });
    audit.append({
      actorType: 'system',
      action: 'system.started',
      detail: { version: SERVICE_VERSION, schemaVersion: database.migration?.current ?? 0, firstRun },
    });
    logger.info('dịch vụ đã khởi động', { version: SERVICE_VERSION, firstRun, pid: process.pid });

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
      firstRun,
      seeded,
      async shutdown() {
        if (stopped) return;
        stopped = true;
        try {
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
