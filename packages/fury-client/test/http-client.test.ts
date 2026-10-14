import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, PvError } from '@sctech/profilevault-contract';
import { MemorySecretStore } from '@sctech/profilevault-core';
import { DEFAULT_ENDPOINT_MAP, FakeTimers, FsProfileConfigFileSource, HttpFuryClient, fromSecretStore } from '../src/index.js';
import { FakeFury, TEST_ENDPOINT_MAP } from './fake-fury.js';

const RANGE = '>=0.2.21 <0.4.0';
let fake: FakeFury;
let timers: FakeTimers;

function client(extra: Partial<ConstructorParameters<typeof HttpFuryClient>[0]> = {}): HttpFuryClient {
  return new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: RANGE, timers, clock: new FakeClock(), ...extra });
}

async function expectPv(p: Promise<unknown>, code: string, reason?: string): Promise<PvError> {
  let caught: unknown;
  try {
    await p;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(PvError);
  const e = caught as PvError;
  expect(e.code).toBe(code);
  if (reason) expect(e.detail?.reason).toBe(reason);
  return e;
}

beforeEach(async () => {
  fake = new FakeFury({ version: '0.2.23' });
  await fake.start();
  fake.setProfiles([
    {
      id: 'p1',
      name: 'Kênh A',
      tags: ['pv:youtube'],
      personaId: 'win11-iris-xe-1920x1080',
      persona: { platform: 'Windows 11', gpuRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', screen: { width: 1920, height: 1080 } },
      // u64 thật của Fury: vượt Number.MAX_SAFE_INTEGER
      seed: '7021075368349779267',
      timezone: 'Europe/Berlin',
      languages: ['de-DE'],
      proxy: { id: 'px1', username: 'u', password: 'secret-pass' },
    },
    { id: 'p2', name: 'Kênh B' },
  ]);
  timers = new FakeTimers();
});
afterEach(async () => {
  await fake.stop();
});

describe('HttpFuryClient (SPEC-01)', () => {
  it('health online → reachable, version, supported', async () => {
    const h = await client().health();
    expect(h).toMatchObject({ reachable: true, version: '0.2.23', supported: true });
  });

  it('Fury tắt → health không ném; listProfiles → FURY_OFFLINE', async () => {
    const url = fake.baseUrl;
    await fake.stop();
    const c = new HttpFuryClient({ baseUrl: url, supportedVersions: RANGE, timers });
    expect(await c.health()).toMatchObject({ reachable: false, supported: false, error: 'network' });
    await expectPv(c.listProfiles(), 'FURY_OFFLINE', 'network');
    expect(timers.sleeps).toEqual([1000, 3000, 1000, 3000]); // health + listProfiles đều thử lại 2 lần
  });

  it('401 → FURY_OFFLINE auth; token từ SecretStore được gửi', async () => {
    fake.setAuthRequired(true, 'tok-123');
    await expectPv(client().listProfiles(), 'FURY_OFFLINE', 'auth');
    const store = new MemorySecretStore({ 'fury.token': 'tok-123' });
    const list = await client({ getToken: fromSecretStore(store) }).listProfiles();
    expect(list.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(fake.requests().at(-1)?.authorization).toBe('Bearer tok-123');
  });

  it('phiên bản ngoài khoảng → supported=false, launch FURY_VERSION_UNSUPPORTED, listProfiles vẫn chạy', async () => {
    fake.setVersion('0.5.0');
    const c = client();
    expect(await c.health()).toMatchObject({ reachable: true, version: '0.5.0', supported: false });
    await expectPv(c.launch('p1', { cdp: true }), 'FURY_VERSION_UNSUPPORTED');
    expect(fake.launchCount('p1')).toBe(0);
    expect(await c.listProfiles()).toHaveLength(2);
  });

  it('getProfile từ danh sách + danh mục persona; seed u64 giữ nguyên; không chứa mật khẩu proxy; không có → INPUT_INVALID', async () => {
    const d = await client().getProfile('p1');
    expect(d).toMatchObject({
      id: 'p1',
      personaId: 'win11-iris-xe-1920x1080',
      osFamily: 'windows',
      persona: { platform: 'Windows 11', gpuRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', screen: { width: 1920, height: 1080 } },
      seed: '7021075368349779267',
      timezone: 'Europe/Berlin',
      languages: ['de-DE'],
      proxyRef: 'px1',
      geolocation: { mode: 'auto' },
    });
    expect(JSON.stringify(d)).not.toContain('secret-pass');
    expect(JSON.stringify(d)).not.toContain('username');
    const p2 = await client().getProfile('p2');
    expect(p2.timezone).toBeUndefined();
    expect(p2.seed).toBeUndefined();
    await expectPv(client().getProfile('missing'), 'INPUT_INVALID');
  });

  it('getProfile hợp nhất nguồn file tùy chọn cho trường API không có', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pv-fury-'));
    try {
      mkdirSync(path.join(dir, 'profiles', 'p1'), { recursive: true });
      writeFileSync(path.join(dir, 'profiles', 'p1', 'profile.json'), JSON.stringify({ seed: 's-1', timezone: 'Asia/Tokyo', webrtcMode: 'disable_non_proxied' }));
      const c = client({ profileConfigSource: new FsProfileConfigFileSource({ dataDir: dir }) });
      const d = await c.getProfile('p1');
      expect(d.seed).toBe('7021075368349779267'); // API thắng
      expect(d.timezone).toBe('Europe/Berlin'); // API thắng
      expect(d.webrtcMode).toBe('disable_non_proxied'); // API không có → lấy từ file
      expect((await c.capabilities()).profileConfig).toBe('fallback');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('capabilities theo bộ ánh xạ; năng lực missing → FURY_CAPABILITY_MISSING', async () => {
    const caps = await client().capabilities();
    // Fury 0.3.22 (SPIKE-P2): không có route một profile / trạng thái → suy từ danh sách; không có kiểm exit
    expect(caps).toEqual({
      listProfiles: 'native',
      getStatus: 'fallback',
      launchCdp: 'native',
      stop: 'native',
      profileConfig: 'fallback',
      seed: 'native',
      checkExit: 'missing',
      asnType: 'missing',
    });
    await expectPv(client().checkExit('p1'), 'FURY_CAPABILITY_MISSING');
    expect(DEFAULT_ENDPOINT_MAP.checkExit.source).toBe('missing');
    const t = client({ endpoints: TEST_ENDPOINT_MAP });
    expect((await t.capabilities()).checkExit).toBe('native');
    // route bị tắt → 404 → capability missing
    fake.setCapability('checkExit', false);
    await expectPv(t.checkExit('p1'), 'FURY_CAPABILITY_MISSING');
  });

  it('thử lại 5xx: 500×2 rồi 200 → thành công với backoff 1 s → 3 s; 500×3 → FURY_OFFLINE', async () => {
    fake.failNext(2);
    expect(await client().getStatus('p1')).toEqual({ open: false, via: 'unknown' });
    expect(timers.sleeps).toEqual([1000, 3000]);
    fake.failNext(3);
    await expectPv(client().getStatus('p1'), 'FURY_OFFLINE', 'server');
  });

  it('launch: kiểm status trước, đang mở → PROFILE_BUSY không gọi launch; không thử lại; stop idempotent', async () => {
    fake.setOpen('p1', true, 'app');
    const e = await expectPv(client().launch('p1', { cdp: true }), 'PROFILE_BUSY');
    expect(e.detail?.via).toBe('unknown'); // Fury chỉ báo running, không báo mở qua đâu
    expect(fake.launchCount('p1')).toBe(0);

    fake.setOpen('p1', false);
    const ok = await client().launch('p1', { cdp: true });
    expect(ok.cdpEndpoint).toMatch(/^ws:\/\/127\.0\.0\.1/);
    expect(ok.sessionRef).toMatch(/^\d+$/); // pid
    const start = fake.requests().find((r) => r.path === '/v1/profiles/start');
    expect(start).toMatchObject({ method: 'POST', body: { id: 'p1', cdp: true } });
    expect(fake.isOpen('p1')).toBe(true);
    await client().stop('p1');
    expect(fake.isOpen('p1')).toBe(false);
    await client().stop('p1'); // đã đóng → không lỗi
  });

  it('launch gặp 500 → không thử lại, FURY_OFFLINE', async () => {
    // request 1 = health, 2 = getStatus (thành công); request 3 = launch → 500
    let count = 0;
    const fetchFn: typeof fetch = async (input, init) => {
      count++;
      if (count === 3) return new Response('{"error":"boom"}', { status: 500 });
      return fetch(input, init);
    };
    await expectPv(client({ fetch: fetchFn }).launch('p1', { cdp: true }), 'FURY_OFFLINE', 'server');
    expect(timers.sleeps).toEqual([]);
    expect(count).toBe(3);
  });

  it('timeout → FURY_OFFLINE timeout (fetch treo tôn trọng abort)', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const c = client({ fetch: hanging, timeouts: { getStatus: 30, health: 30 }, maxRetries: 0 });
    await expectPv(c.getStatus('p1'), 'FURY_OFFLINE', 'timeout');
    expect(await c.health()).toMatchObject({ reachable: false, error: 'timeout' });
  });

  it('baseUrl còn ${FURY_API_PORT} → url_invalid', async () => {
    const c = new HttpFuryClient({ baseUrl: 'http://127.0.0.1:${FURY_API_PORT}', supportedVersions: RANGE, timers });
    expect(await c.health()).toMatchObject({ reachable: false, error: 'url_invalid' });
    await expectPv(c.listProfiles(), 'FURY_OFFLINE', 'url_invalid');
  });

  it('phản hồi không phải JSON hoặc thiếu trường → bad_response (không thử lại)', async () => {
    const bad: typeof fetch = async () => new Response('<html>', { status: 200 });
    await expectPv(client({ fetch: bad }).getStatus('p1'), 'FURY_OFFLINE', 'bad_response');
    const missing: typeof fetch = async () => new Response('{"foo":1}', { status: 200 });
    const e = await expectPv(client({ fetch: missing }).getStatus('p1'), 'FURY_OFFLINE', 'bad_response');
    expect(e.detail?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'ok' })]));
    expect(timers.sleeps).toEqual([]);
  });

  it('checkExit qua FakeFury', async () => {
    fake.setExit('p1', { ip: '5.6.7.8', country: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin', asn: 3320, asnOrg: 'DTAG', asnType: 'isp', latencyMs: 120 });
    const t = client({ endpoints: TEST_ENDPOINT_MAP });
    const e = await t.checkExit('p1');
    expect(e).toMatchObject({ ok: true, ip: '5.6.7.8', country: 'DE', asn: 3320, asnType: 'isp' });
    fake.setExit('p1', { error: 'proxy unreachable' });
    expect(await t.checkExit('p1')).toMatchObject({ ok: false, error: 'proxy unreachable' });
  });

  it('Fury từ chối launch (400 failed) → PROFILE_BUSY khi đang chạy, INPUT_INVALID khi không có profile', async () => {
    // getStatus báo đóng nhưng agent đã mở (vd mở từ app giữa hai lời gọi)
    const fetchFn: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/v1/profiles/start')) return new Response('{"error":"failed","message":"profile p1 is already running"}', { status: 400 });
      return fetch(input, init);
    };
    await expectPv(client({ fetch: fetchFn }).launch('p1', { cdp: true }), 'PROFILE_BUSY');
    await expectPv(client().stop('nope'), 'INPUT_INVALID');
  });
});
