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
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-wire-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('wiring Fury ↔ poller ↔ Health (spec 003 T015)', () => {
  it('poller báo phiên bản và profile mở → Health ghi sự kiện; scheduler và poller đăng ký timer', async () => {
    const fake = new FakeFury({ version: '0.2.23' });
    await fake.start();
    try {
      const env = { PV_APPDATA_DIR: tmp(), PV_LOCALAPPDATA_DIR: tmp() };
      const timers = new FakeTimers();
      const clock = new FakeClock('2026-10-14T03:00:00.000Z');
      const fury = new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, clock, maxRetries: 0 });
      const ctx = await bootstrap({ env, secretStore: new MemorySecretStore(), clock, timers, fury, pidAlive: () => true, startBackground: true });
      try {
        expect(timers.intervals.map((i) => i.ms).sort((a, b) => a - b)).toEqual([60_000, 60_000, 60_000, 300_000]); // poller health, lịch proxy, lịch nhất quán, poller status
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
