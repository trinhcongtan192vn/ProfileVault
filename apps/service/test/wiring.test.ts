import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@sctech/profilevault-contract';
import { MemorySecretStore } from '@sctech/profilevault-core';
import { FakeTimers, FuryInstaller, HttpFuryClient } from '@sctech/profilevault-fury-client';
import { FakeFury } from '@sctech/profilevault-fury-client/testing';
import { bootstrap } from '../src/bootstrap.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-wire-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Bộ cài giả: không mạng, không chạy Fury thật (constitution: test không gọi Fury thật). */
function fakeInstaller(clock: FakeClock): FuryInstaller {
  const la = tmp();
  const setup = Buffer.from('setup');
  const core = Buffer.from('core');
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const pin = {
    version: '0.3.22',
    setup: { url: 'https://example.test/fury-setup.exe', sha256: sha(setup), size: setup.length },
    core: { url: 'https://example.test/fury-core.tar.xz', sha256: sha(core), size: core.length },
  };
  let coreInstalled = false;
  return new FuryInstaller({
    localAppData: la,
    downloadsDir: tmp(),
    clock,
    pin,
    platform: 'win32',
    fetch: (async (u: string) => new Response(new Uint8Array(u.endsWith('.exe') ? setup : core))) as unknown as typeof fetch,
    exec: async (file, args) => {
      if (file.endsWith('setup.exe')) {
        mkdirSync(path.join(la, 'Fury'), { recursive: true });
        writeFileSync(path.join(la, 'Fury', 'fury-agent.exe'), 'x');
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === '--help') return { code: 0, stdout: 'fury-agent 0.3.22', stderr: '' };
      if (args.length === 2) coreInstalled = true;
      return coreInstalled ? { code: 0, stdout: 'installed 155.0.8059.39', stderr: '' } : { code: 1, stdout: '', stderr: 'none' };
    },
  });
}

describe('wiring Fury ↔ poller ↔ Health (spec 003 T015)', () => {
  it('poller báo phiên bản và profile mở → Health ghi sự kiện; scheduler và poller đăng ký timer', async () => {
    const fake = new FakeFury({ version: '0.2.23' });
    await fake.start();
    try {
      const appData = tmp();
      // cổng 0: không đụng ProfileVault đang chạy ở 50410
      writeFileSync(path.join(appData, 'config.json'), JSON.stringify({ gateway: { host: '127.0.0.1', port: 0 } }));
      const env = { PV_APPDATA_DIR: appData, PV_LOCALAPPDATA_DIR: tmp() };
      const timers = new FakeTimers();
      const clock = new FakeClock('2026-10-14T03:00:00.000Z');
      const fury = new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, clock, maxRetries: 0 });
      const ctx = await bootstrap({ env, secretStore: new MemorySecretStore(), clock, timers, fury, pidAlive: () => true, startBackground: true, furyInstaller: fakeInstaller(clock) });
      try {
        expect(timers.intervals.map((i) => i.ms).sort((a, b) => a - b)).toEqual([2000, 2000, 60_000, 60_000, 60_000, 300_000, 86_400_000]); // Runner, lịch flow, poller health, proxy/nhất quán, poller status, retention
        // Nền bật → tự cài Fury chạy; cài xong ghi audit fury.installed
        expect((await ctx.furyInstaller.ensure()).state).toBe('ready');
        expect(ctx.audit.list({ action: 'fury.installed' })).toHaveLength(1);
        fake.upsertProfile({ id: 'p1', name: 'A', personaId: 'x' });
        const b = await ctx.health.createBinding({ platform: 'youtube', accountId: 'UC1', displayName: 'A', furyProfileId: 'p1', marketCountry: 'DE' });
        await ctx.poller.tickHealth();
        expect(ctx.health.currentFuryVersion()).toBeUndefined(); // chưa đổi phiên bản → chưa ghi
        fake.setVersion('0.2.24');
        await ctx.poller.tickHealth();
        expect(ctx.health.currentFuryVersion()).toBe('0.2.24');
        // consistency_block vì chưa có checklist (C3); detect_suite_failed vì phiên bản mới chưa có kết quả
        expect(ctx.health.listPauses(b.id, { open: true }).map((p) => p.reason).sort()).toEqual(['consistency_block', 'detect_suite_failed']);
        fake.setOpen('p1', true, 'app');
        await ctx.poller.tickStatus();
        expect(ctx.health.listEvents(b.id, { types: ['fury.profile_opened'] })).toHaveLength(1);
      } finally {
        await ctx.shutdown();
      }
      expect(timers.intervals.every((i) => !i.active)).toBe(true);
    } finally {
      await fake.stop();
    }
  });
});
