import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PvError } from '@sctech/profilevault-contract';
import { ensureDirs, loadConfig, resolvePaths } from '../src/index.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-core-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('resolvePaths (SPEC-00 §5)', () => {
  it('theo %APPDATA% / %LOCALAPPDATA%', () => {
    const p = resolvePaths({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
    expect(p.configFile).toBe(path.join('C:\\Users\\u\\AppData\\Roaming', 'ProfileVault', 'config.json'));
    expect(p.secretsFile.endsWith('secrets.bin')).toBe(true);
    expect(p.dbFile.endsWith('profilevault.db')).toBe(true);
    expect(p.lockFile.endsWith('service.lock')).toBe(true);
    expect(p.extensionsDir).toBe(path.join('C:\\Users\\u\\AppData\\Roaming', 'ProfileVault', 'extensions', 'flows'));
    expect(p.runsDir).toBe(path.join('C:\\Users\\u\\AppData\\Local', 'ProfileVault', 'runs'));
    expect(p.probesDir.endsWith('probes')).toBe(true);
    expect(p.logsDir.endsWith('logs')).toBe(true);
  });

  it('ghi đè bằng PV_APPDATA_DIR / PV_LOCALAPPDATA_DIR và ensureDirs tạo thư mục', () => {
    const a = tmp();
    const l = tmp();
    const p = resolvePaths({ PV_APPDATA_DIR: a, PV_LOCALAPPDATA_DIR: l });
    expect(p.appData).toBe(a);
    expect(p.localAppData).toBe(l);
    ensureDirs(p);
    for (const d of [p.extensionsDir, p.runsDir, p.probesDir, p.logsDir]) expect(rmSafeExists(d)).toBe(true);
  });
});

function rmSafeExists(d: string): boolean {
  try {
    return statSync(d).isDirectory();
  } catch {
    return false;
  }
}

describe('loadConfig', () => {
  it('không có file → mặc định', () => {
    const p = resolvePaths({ PV_APPDATA_DIR: tmp(), PV_LOCALAPPDATA_DIR: tmp() });
    const r = loadConfig(p, { FURY_API_PORT: '9000' });
    expect(r.fromFile).toBe(false);
    expect(r.config.gateway.port).toBe(50410);
    expect(r.config.fury.apiBaseUrl).toBe('http://127.0.0.1:9000');
    expect(r.missingEnv).toEqual([]);
  });

  it('ghi đè một phần; thiếu biến môi trường → giữ nguyên + báo', () => {
    const a = tmp();
    const p = resolvePaths({ PV_APPDATA_DIR: a, PV_LOCALAPPDATA_DIR: tmp() });
    writeFileSync(p.configFile, JSON.stringify({ gateway: { port: 50500 } }));
    const r = loadConfig(p, {});
    expect(r.config.gateway.port).toBe(50500);
    expect(r.config.gateway.host).toBe('127.0.0.1');
    expect(r.config.fury.apiBaseUrl).toBe('http://127.0.0.1:${FURY_API_PORT}');
    expect(r.missingEnv).toEqual(['FURY_API_PORT']);
  });

  it('sai kiểu → INPUT_INVALID nêu đường dẫn khóa', () => {
    const a = tmp();
    const p = resolvePaths({ PV_APPDATA_DIR: a, PV_LOCALAPPDATA_DIR: tmp() });
    writeFileSync(p.configFile, JSON.stringify({ gateway: { port: 'abc' } }));
    let caught: unknown;
    try {
      loadConfig(p, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PvError);
    const pv = caught as PvError;
    expect(pv.code).toBe('INPUT_INVALID');
    expect(pv.detail?.issues).toEqual([expect.objectContaining({ path: 'gateway.port' })]);
  });

  it('JSON hỏng → INPUT_INVALID kèm vị trí, không ghi đè file', () => {
    const a = tmp();
    const p = resolvePaths({ PV_APPDATA_DIR: a, PV_LOCALAPPDATA_DIR: tmp() });
    writeFileSync(p.configFile, '{ "gateway": { "port": 1, }');
    expect(() => loadConfig(p, {})).toThrow(/config.json hỏng/);
    expect(readFileSync(p.configFile, 'utf8')).toBe('{ "gateway": { "port": 1, }');
  });
});
