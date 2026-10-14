import { describe, expect, it } from 'vitest';
import { ConfigSchema, DEFAULT_CONFIG, expandEnv } from '../src/index.js';

describe('ConfigSchema (SPEC-00 §5)', () => {
  it('mặc định đúng spec', () => {
    expect(DEFAULT_CONFIG.gateway).toEqual({ host: '127.0.0.1', port: 50410 });
    expect(DEFAULT_CONFIG.fury.supportedVersions).toBe('>=0.2.21 <0.4.0');
    expect(DEFAULT_CONFIG.fury.dataDir).toBeNull();
    expect(DEFAULT_CONFIG.runner).toEqual({
      maxConcurrentIdle: 6,
      maxConcurrentBusy: 3,
      ramPerProfileMb: 500,
      profileBusyTimeoutMinutes: 360,
      humanGateTimeoutHours: 24,
    });
    expect(DEFAULT_CONFIG.limits.uploadsPerAccountPerDay).toBe(10);
    expect(DEFAULT_CONFIG.retention).toEqual({ runArtifactsDays: 30, dataMonths: 12 });
    expect(DEFAULT_CONFIG.ui).toEqual({ timezone: 'Asia/Bangkok', dailyReminderLocalTime: '21:00' });
  });

  it('ghi đè một phần giữ các khóa khác', () => {
    const c = ConfigSchema.parse({ gateway: { port: 50500 } });
    expect(c.gateway.port).toBe(50500);
    expect(c.gateway.host).toBe('127.0.0.1');
    expect(c.runner.maxConcurrentIdle).toBe(6);
  });

  it('sai kiểu → lỗi nêu đường dẫn', () => {
    const r = ConfigSchema.safeParse({ gateway: { port: 'abc' } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['gateway', 'port']);
  });

  it('expandEnv thay biến, giữ nguyên khi thiếu', () => {
    expect(expandEnv('http://127.0.0.1:${FURY_API_PORT}', { FURY_API_PORT: '9222' })).toEqual({
      value: 'http://127.0.0.1:9222',
      missing: [],
    });
    expect(expandEnv('http://127.0.0.1:${FURY_API_PORT}', {})).toEqual({
      value: 'http://127.0.0.1:${FURY_API_PORT}',
      missing: ['FURY_API_PORT'],
    });
  });
});
