import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeFury } from './fake-fury.js';

let fake: FakeFury;
beforeEach(async () => {
  fake = new FakeFury({ version: '0.2.23' });
  await fake.start();
  fake.setProfiles([{ id: 'p1', name: 'A' }]);
});
afterEach(async () => {
  await fake.stop();
});

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${fake.baseUrl}${path}`, { headers });
  return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
}
async function post(path: string, body?: unknown) {
  const res = await fetch(`${fake.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? undefined : await res.json() };
}

describe('FakeFury (SPEC-09 §3.1)', () => {
  it('route cơ bản và ghi lại request', async () => {
    expect(await get('/api/status')).toEqual({ status: 200, body: { ok: true, version: '0.2.23' } });
    expect((await get('/api/profiles')).body).toEqual([{ id: 'p1', name: 'A', tags: [] }]);
    expect((await get('/api/profiles/p1/status')).body).toEqual({ open: false, via: 'unknown' });
    expect((await get('/api/profiles/nope')).status).toBe(404);
    expect(fake.requests().map((r) => r.path)).toEqual(['/api/status', '/api/profiles', '/api/profiles/p1/status', '/api/profiles/nope']);
    fake.clearRequests();
    expect(fake.requests()).toEqual([]);
  });

  it('auth, failNext, capability tắt', async () => {
    fake.setAuthRequired(true, 't');
    expect((await get('/api/status')).status).toBe(401);
    expect((await get('/api/status', { authorization: 'Bearer t' })).status).toBe(200);
    fake.setAuthRequired(false);
    fake.failNext(1, 503);
    expect((await get('/api/status')).status).toBe(503);
    expect((await get('/api/status')).status).toBe(200);
    fake.setCapability('checkExit', false);
    expect((await post('/api/profiles/p1/check-exit')).status).toBe(404);
  });

  it('launch/stop với handler tùy chỉnh; launch khi đang mở → 409', async () => {
    const calls: string[] = [];
    fake.launchHandler = async (id) => {
      calls.push(`launch:${id}`);
      return { cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/x', sessionRef: 's1' };
    };
    fake.stopHandler = async (id) => void calls.push(`stop:${id}`);
    const r = await post('/api/profiles/p1/launch', { cdp: true });
    expect(r).toEqual({ status: 200, body: { cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/x', sessionRef: 's1' } });
    expect(fake.isOpen('p1')).toBe(true);
    expect((await post('/api/profiles/p1/launch', { cdp: true })).status).toBe(409);
    expect((await post('/api/profiles/p1/stop')).status).toBe(204);
    expect(fake.isOpen('p1')).toBe(false);
    expect(calls).toEqual(['launch:p1', 'stop:p1']);
    expect(fake.requests().find((q) => q.path.endsWith('/launch'))?.body).toEqual({ cdp: true });
  });
});
