import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, newId } from '@sctech/profilevault-contract';
import { openTestDatabase, SettingsRepo } from '@sctech/profilevault-db';
import { createLogger, EventBus, SeederRegistry, silentLogger } from '../src/index.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-bus-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('EventBus (SPEC-00 §10)', () => {
  it('payload sai → ném, không listener nào nhận; đúng → theo thứ tự đăng ký', () => {
    const bus = new EventBus({ onListenerError: () => undefined });
    const order: string[] = [];
    bus.on('fury.status_changed', () => void order.push('a'));
    bus.on('fury.status_changed', () => void order.push('b'));
    expect(() => bus.emit('fury.status_changed', { reachable: 'yes' } as unknown as { reachable: boolean; supported: boolean })).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID' }),
    );
    expect(order).toEqual([]);
    bus.emit('fury.status_changed', { reachable: true, version: '0.2.23', supported: true });
    expect(order).toEqual(['a', 'b']);
  });

  it('listener lỗi không chặn listener khác; once; off', () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onListenerError: (_e, err) => void errors.push(err) });
    const got: number[] = [];
    bus.on('binding.level_changed', () => {
      throw new Error('boom');
    });
    bus.on('binding.level_changed', async () => {
      throw new Error('async boom');
    });
    bus.once('binding.level_changed', (p) => void got.push(p.toLevel));
    const off = bus.on('binding.level_changed', (p) => void got.push(p.toLevel * 10));
    const payload = {
      bindingId: newId('binding'),
      changeId: newId('levelChange'),
      fromLevel: 1 as const,
      toLevel: 0 as const,
      kind: 'demote' as const,
      reason: 'red_event',
    };
    bus.emit('binding.level_changed', payload);
    off();
    bus.emit('binding.level_changed', payload);
    expect(got).toEqual([0, 0]);
    return vi.waitFor(() => expect(errors).toHaveLength(4));
  });
});

describe('Logger', () => {
  it('NDJSON theo ngày, giữ 7 ngày, che bí mật', () => {
    const dir = tmp();
    const clock = new FakeClock('2026-10-01T10:00:00.000Z');
    const log = createLogger({ dir, clock, redact: () => ['super-secret'] });
    for (let d = 0; d < 8; d++) {
      log.info('ngày', { token: 'super-secret', n: d });
      clock.advanceDays(1);
    }
    log.info('cuối');
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(7);
    expect(files[0]).toBe('service-2026-10-03.log');
    expect(files[6]).toBe('service-2026-10-09.log');
    const content = readFileSync(path.join(dir, 'service-2026-10-08.log'), 'utf8');
    expect(content).not.toContain('super-secret');
    expect(content).toContain('"token":"***"');
    const first = JSON.parse(content.split('\n')[0] ?? '{}') as { ts: string; level: string; msg: string };
    expect(first).toMatchObject({ level: 'info' });
  });

  it('child giữ bindings; mức lọc', () => {
    const lines: string[] = [];
    const log = createLogger({ dir: null, level: 'warn', sink: (l) => lines.push(l) }).child({ pkg: 'x' });
    log.info('bỏ qua');
    log.error('lỗi', { a: 1 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ level: 'error', msg: 'lỗi', pkg: 'x', a: 1 });
  });
});

describe('SeederRegistry', () => {
  it('mỗi seeder chạy một lần', async () => {
    const t = openTestDatabase();
    try {
      const settings = new SettingsRepo(t.database.db);
      const reg = new SeederRegistry();
      let runs = 0;
      reg.register('thresholds', (ctx) => {
        runs++;
        ctx.settings.set('thresholds', { x: 1 }, 'system');
      });
      const ctx = { database: t.database, settings, clock: new FakeClock(), logger: silentLogger };
      expect(await reg.run(ctx)).toEqual(['thresholds']);
      expect(await reg.run(ctx)).toEqual([]);
      expect(runs).toBe(1);
      expect(settings.get('seeded.thresholds')).toBe(true);
      expect(() => reg.register('thresholds', () => undefined)).toThrow(/trùng tên/);
    } finally {
      t.cleanup();
    }
  });
});
