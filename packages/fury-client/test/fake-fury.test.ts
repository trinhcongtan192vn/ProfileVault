import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeFury, TEST_CHECK_EXIT_PATH } from './fake-fury.js';

let fake: FakeFury;
beforeEach(async () => {
  fake = new FakeFury({ version: '0.2.23' });
  await fake.start();
  fake.setProfiles([{ id: 'p1', name: 'A', personaId: 'win11-a', persona: { platform: 'Windows 11', screen: { width: 1920, height: 1080 } }, seed: '7021075368349779267' }]);
});
afterEach(async () => {
  await fake.stop();
});

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${fake.baseUrl}${path}`, { headers });
  return { status: res.status, text: await res.text() };
}
async function post(path: string, body?: unknown) {
  const res = await fetch(`${fake.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as unknown };
}

describe('FakeFury theo API Fury 0.3.22 (SPEC-09 §3.1, SPIKE-P2)', () => {
  it('route /v1, phong bì { ok, data }, fp_seed là số nguyên thô, ghi lại request', async () => {
    const status = await get('/v1/status');
    expect(status.status).toBe(200);
    expect(JSON.parse(status.text)).toMatchObject({ ok: true, data: { version: '0.2.23', running: [] } });
    const profiles = await get('/v1/profiles');
    expect(profiles.text).toContain('"fp_seed":7021075368349779267');
    expect((JSON.parse(profiles.text) as { data: unknown[] }).data[0]).toMatchObject({ id: 'p1', name: 'A', persona_id: 'win11-a', running: false, overrides: {} });
    expect((JSON.parse((await get('/v1/personas')).text) as { data: unknown[] }).data).toEqual([
      { id: 'win11-a', os: 'Windows 11', gpu: null, screen: '1920×1080', own: false, source: 'derived', weight: 0.05 },
    ]);
    expect((await get('/v1/profiles/p1')).status).toBe(404);
    expect(fake.requests().map((r) => r.path)).toEqual(['/v1/status', '/v1/profiles', '/v1/personas', '/v1/profiles/p1']);
    fake.clearRequests();
    expect(fake.requests()).toEqual([]);
  });

  it('auth, failNext, capability tắt', async () => {
    fake.setAuthRequired(true, 't');
    expect((await get('/v1/status')).status).toBe(401);
    expect((await get('/v1/status', { authorization: 'Bearer t' })).status).toBe(200);
    fake.setAuthRequired(false);
    fake.failNext(1, 503);
    expect((await get('/v1/status')).status).toBe(503);
    expect((await get('/v1/status')).status).toBe(200);
    fake.setCapability('checkExit', false);
    expect((await post(TEST_CHECK_EXIT_PATH, { id: 'p1' })).status).toBe(404);
  });

  it('start/stop với handler tùy chỉnh; start khi đang chạy → 400 failed; không có profile → 400', async () => {
    const calls: string[] = [];
    fake.launchHandler = async (id) => {
      calls.push(`launch:${id}`);
      return { cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/x', sessionRef: '4242' };
    };
    fake.stopHandler = async (id) => void calls.push(`stop:${id}`);
    const r = await post('/v1/profiles/start', { id: 'p1', cdp: true });
    expect(r).toEqual({ status: 200, body: { ok: true, data: expect.objectContaining({ pid: 4242, ws_endpoint: 'ws://127.0.0.1:9222/devtools/browser/x' }) } });
    expect(fake.isOpen('p1')).toBe(true);
    expect(await post('/v1/profiles/start', { id: 'p1', cdp: true })).toEqual({ status: 400, body: { error: 'failed', message: 'profile p1 is already running' } });
    expect((await post('/v1/profiles/stop', { id: 'p1' })).status).toBe(200);
    expect(fake.isOpen('p1')).toBe(false);
    expect((await post('/v1/profiles/start', { id: 'nope', cdp: true })).status).toBe(400);
    expect(calls).toEqual(['launch:p1', 'stop:p1']);
    // không xin CDP → không có ws_endpoint (như Fury thật)
    const plain = (await post('/v1/profiles/start', { id: 'p1' })).body as { data: Record<string, unknown> };
    expect(plain.data.ws_endpoint).toBeUndefined();
  });
});
