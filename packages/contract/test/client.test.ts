import { describe, expect, it } from 'vitest';
import { ProfileVaultApiError, ProfileVaultClient } from '../src/index.js';

describe('ProfileVaultClient (SPEC-06 §7)', () => {
  it('thử lại lỗi mạng và 429 (Retry-After), không thử lại lỗi nghiệp vụ', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fetchFn = (async () => {
      n++;
      if (n === 1) throw new TypeError('fetch failed');
      if (n === 2) return new Response('{"error":{"code":"RATE_LIMITED","message":"x"}}', { status: 429, headers: { 'retry-after': '2' } });
      return new Response('{"service":"ok","fury":{"reachable":true,"version":"0.3.22","supported":true},"contractVersion":"profilevault/v1"}', { status: 200 });
    }) as typeof fetch;
    const c = new ProfileVaultClient({ token: 't', fetch: fetchFn, sleep: async (ms) => void sleeps.push(ms) });
    expect((await c.health()).service).toBe('ok');
    expect(sleeps).toEqual([1000, 2000]);
    const biz = new ProfileVaultClient({ token: 't', fetch: (async () => new Response('{"error":{"code":"LEVEL_TOO_LOW","message":"thấp"}}', { status: 422 })) as typeof fetch, sleep: async () => {} });
    await expect(biz.health()).rejects.toMatchObject({ status: 422, code: 'LEVEL_TOO_LOW' });
    await expect(biz.health()).rejects.toBeInstanceOf(ProfileVaultApiError);
  });
});
