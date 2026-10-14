import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Đường dẫn trên máy theo SPEC-00 §5. */
export interface Paths {
  appData: string;
  localAppData: string;
  configFile: string;
  secretsFile: string;
  dbFile: string;
  lockFile: string;
  extensionsDir: string;
  runsDir: string;
  probesDir: string;
  logsDir: string;
}

const APP_DIR = 'ProfileVault';

function defaultAppData(env: NodeJS.ProcessEnv): string {
  if (env.APPDATA) return env.APPDATA;
  return path.join(os.homedir(), '.config');
}

function defaultLocalAppData(env: NodeJS.ProcessEnv): string {
  if (env.LOCALAPPDATA) return env.LOCALAPPDATA;
  return path.join(os.homedir(), '.local', 'share');
}

/**
 * `%APPDATA%\ProfileVault` và `%LOCALAPPDATA%\ProfileVault`; ghi đè gốc bằng `PV_APPDATA_DIR`, `PV_LOCALAPPDATA_DIR`
 * (trỏ thẳng tới thư mục ProfileVault, dùng cho test/dev).
 */
export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const appData = env.PV_APPDATA_DIR ? path.resolve(env.PV_APPDATA_DIR) : path.join(defaultAppData(env), APP_DIR);
  const localAppData = env.PV_LOCALAPPDATA_DIR
    ? path.resolve(env.PV_LOCALAPPDATA_DIR)
    : path.join(defaultLocalAppData(env), APP_DIR);
  return {
    appData,
    localAppData,
    configFile: path.join(appData, 'config.json'),
    secretsFile: path.join(appData, 'secrets.bin'),
    dbFile: path.join(appData, 'profilevault.db'),
    lockFile: path.join(appData, 'service.lock'),
    extensionsDir: path.join(appData, 'extensions', 'flows'),
    runsDir: path.join(localAppData, 'runs'),
    probesDir: path.join(localAppData, 'probes'),
    logsDir: path.join(localAppData, 'logs'),
  };
}

/** Tạo mọi thư mục cần thiết (idempotent). */
export function ensureDirs(paths: Paths): void {
  for (const dir of [paths.appData, paths.localAppData, paths.extensionsDir, paths.runsDir, paths.probesDir, paths.logsDir]) {
    mkdirSync(dir, { recursive: true });
  }
}
