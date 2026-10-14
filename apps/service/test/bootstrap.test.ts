import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@sctech/profilevault-contract';
import { InstanceAlreadyRunningError, MemorySecretStore, SeederRegistry } from '@sctech/profilevault-core';
import { bootstrap } from '../src/bootstrap.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-boot-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('bootstrap (spec 001 US5)', () => {
  it('lần đầu: thư mục, HMAC, CSDL, settings, seeder, audit first_run; lần hai: không lặp; shutdown nhả khóa', async () => {
    const env = { PV_APPDATA_DIR: tmp(), PV_LOCALAPPDATA_DIR: tmp() };
    const secrets = new MemorySecretStore();
    const clock = new FakeClock('2026-10-14T01:00:00.000Z');
    const seeders = new SeederRegistry().register('custom', (ctx) => ctx.settings.set('custom', { x: 1 }, 'system'));

    const ctx = await bootstrap({ env, secretStore: secrets, clock, seeders, pidAlive: () => true, startBackground: false });
    expect(ctx.firstRun).toBe(true);
    expect(ctx.seeded.sort()).toEqual(['custom', 'thresholds']);
    expect(ctx.health.getThresholds().L0_to_L1).toHaveLength(7);
    for (const d of [ctx.paths.extensionsDir, ctx.paths.runsDir, ctx.paths.probesDir, ctx.paths.logsDir]) expect(existsSync(d)).toBe(true);
    expect(Buffer.from((await secrets.get('hmac.key')) ?? '', 'base64')).toHaveLength(32);
    expect(existsSync(ctx.paths.dbFile)).toBe(true);
    expect(ctx.settings.get('schema_version')).toEqual({ migration: 1 });
    expect(ctx.settings.get('runner')).toMatchObject({ traceAlways: false });
    expect(ctx.settings.get('custom')).toEqual({ x: 1 });
    expect(ctx.audit.list({ action: 'system.first_run' })).toHaveLength(1);
    expect(ctx.audit.list({ action: 'system.started' })).toHaveLength(1);
    expect(existsSync(ctx.paths.lockFile)).toBe(true);
    expect(readdirSync(ctx.paths.logsDir)).toEqual(['service-2026-10-14.log']);

    // đang giữ khóa → tiến trình khác bị từ chối
    await expect(bootstrap({ env, secretStore: secrets, clock, pidAlive: () => true, pid: process.pid + 1, startBackground: false })).rejects.toThrow(InstanceAlreadyRunningError);

    await ctx.shutdown();
    expect(existsSync(ctx.paths.lockFile)).toBe(false);
    expect(ctx.database.sqlite.open).toBe(false);

    clock.advance(5000);
    const hmacBefore = await secrets.get('hmac.key');
    const ctx2 = await bootstrap({ env, secretStore: secrets, clock, seeders, pidAlive: () => true, startBackground: false });
    expect(ctx2.firstRun).toBe(false);
    expect(ctx2.seeded).toEqual([]);
    expect(await secrets.get('hmac.key')).toBe(hmacBefore);
    expect(ctx2.audit.list({ action: 'system.first_run' })).toHaveLength(1);
    expect(ctx2.audit.list({ action: 'system.started' })).toHaveLength(2);
    expect(ctx2.audit.list({ action: 'system.stopped' })).toHaveLength(1);
    await ctx2.shutdown();
  });

  it('config.json hỏng → không khởi động, khóa được nhả', async () => {
    const env = { PV_APPDATA_DIR: tmp(), PV_LOCALAPPDATA_DIR: tmp() };
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(env.PV_APPDATA_DIR, { recursive: true });
    writeFileSync(path.join(env.PV_APPDATA_DIR, 'config.json'), '{ broken');
    await expect(bootstrap({ env, secretStore: new MemorySecretStore(), pidAlive: () => true, startBackground: false })).rejects.toThrow(/config.json hỏng/);
    expect(existsSync(path.join(env.PV_APPDATA_DIR, 'service.lock'))).toBe(false);
  });

  it('log không chứa bí mật', async () => {
    const env = { PV_APPDATA_DIR: tmp(), PV_LOCALAPPDATA_DIR: tmp() };
    const secrets = new MemorySecretStore({ 'fury.token': 'fury-token-value-123' });
    const ctx = await bootstrap({ env, secretStore: secrets, pidAlive: () => true, startBackground: false });
    ctx.logger.info('token test', { token: 'fury-token-value-123' });
    await ctx.shutdown();
    const { readFileSync } = await import('node:fs');
    const content = readdirSync(ctx.paths.logsDir)
      .map((f) => readFileSync(path.join(ctx.paths.logsDir, f), 'utf8'))
      .join('\n');
    expect(content).toContain('token test');
    expect(content).not.toContain('fury-token-value-123');
    const hmac = await secrets.get('hmac.key');
    expect(content).not.toContain(hmac);
  });
});
