import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@sctech/profilevault-contract';
import { MemorySecretStore } from '@sctech/profilevault-core';
import { FakeTimers, HttpFuryClient } from '@sctech/profilevault-fury-client';
import { FakeFury } from '@sctech/profilevault-fury-client/testing';
import { bootstrap } from '../src/bootstrap.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-gw-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('bootstrap + gateway (spec 005 T015)', () => {
  it('listen loopback cổng 0, mở phiên qua createOpenUrl, gọi /internal/system, shutdown đóng cổng', async () => {
    const fake = new FakeFury({ version: '0.2.23' });
    await fake.start();
    const a = tmp();
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(a, { recursive: true });
    writeFileSync(path.join(a, 'config.json'), JSON.stringify({ gateway: { host: '127.0.0.1', port: 0 } }));
    const env = { PV_APPDATA_DIR: a, PV_LOCALAPPDATA_DIR: tmp() };
    const timers = new FakeTimers();
    const clock = new FakeClock('2026-10-14T03:00:00.000Z');
    const fury = new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, clock, maxRetries: 0 });
    const ctx = await bootstrap({ env, secretStore: new MemorySecretStore(), clock, timers, fury, pidAlive: () => true, startBackground: false, listen: true });
    try {
      expect(ctx.gatewayUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const open = await fetch(ctx.gateway.createOpenUrl(), { redirect: 'manual' });
      expect(open.status).toBe(302);
      const cookie = open.headers.get('set-cookie')!.split(';')[0]!;
      const sys = await fetch(`${ctx.gatewayUrl}/internal/system`, { headers: { cookie } });
      expect(sys.status).toBe(200);
      expect((await sys.json()) as { bindings: number }).toMatchObject({ bindings: 0 });
      expect(ctx.audit.list({ action: 'dashboard.login' })).toHaveLength(1);
    } finally {
      const url = ctx.gatewayUrl!;
      await ctx.shutdown();
      await expect(fetch(`${url}/internal/session`)).rejects.toThrow();
      await fake.stop();
    }
  });
});
