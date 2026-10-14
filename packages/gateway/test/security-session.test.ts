import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeGateway, type GwHarness } from './helpers.js';

let h: GwHarness;
beforeEach(async () => {
  h = await makeGateway();
});
afterEach(() => h.cleanup());

describe('bảo mật mạng (SPEC-05 §2, §11)', () => {
  it('Host lạ bị từ chối 403 và audit http.denied; Host 127.0.0.1/localhost qua', async () => {
    const evil = await h.gw.app.inject({ method: 'GET', url: '/internal/session', headers: { host: 'evil.com' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json()).toMatchObject({ error: { code: 'UNAUTHORIZED', detail: { reason: 'host' } } });
    expect(h.audit.list({ action: 'http.denied' })[0]?.detailJson).toContain('"reason":"host"');
    const ok = await h.gw.app.inject({ method: 'GET', url: '/internal/session', headers: { host: `localhost:${h.port}` } });
    expect(ok.statusCode).toBe(401); // qua Host, thiếu phiên
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Origin lạ → 403; Origin gateway → qua; không Origin → qua', async () => {
    const { cookie } = await h.login();
    const bad = await h.gw.app.inject({ method: 'GET', url: '/internal/session', headers: { host: `127.0.0.1:${h.port}`, origin: 'http://evil.com', cookie } });
    expect(bad.statusCode).toBe(403);
    expect(bad.json()).toMatchObject({ error: { detail: { reason: 'origin' } } });
    const good = await h.gw.app.inject({ method: 'GET', url: '/internal/session', headers: { host: `127.0.0.1:${h.port}`, origin: `http://127.0.0.1:${h.port}`, cookie } });
    expect(good.statusCode).toBe(200);
  });

  it('listen từ chối host không loopback; listen 127.0.0.1 cổng thật rồi đóng', async () => {
    const bad = await makeGateway({ host: '0.0.0.0', port: 0 });
    try {
      await expect(bad.gw.listen()).rejects.toThrow(/loopback/);
    } finally {
      await bad.cleanup();
    }
    const good = await makeGateway({ port: 0 });
    try {
      const url = await good.gw.listen();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const res = await fetch(`${url}/internal/session`);
      expect(res.status).toBe(401);
      const open = await fetch(good.gw.createOpenUrl(), { redirect: 'manual' });
      expect(open.status).toBe(302);
      expect(open.headers.get('set-cookie')).toMatch(/pv_session=.*HttpOnly.*SameSite=Strict/);
    } finally {
      await good.cleanup();
    }
  });

  it('body > 1 MB → 413 INPUT_INVALID', async () => {
    const res = await h.api({ method: 'POST', url: '/internal/bindings', payload: { displayName: 'x'.repeat(1024 * 1024 + 10) } });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'INPUT_INVALID' } });
  });
});

describe('phiên dashboard (SPEC-05 §4.1)', () => {
  it('mã mở một lần: dùng lại → 401; hết hạn 60 s → 401; mã sai → 401; đăng nhập audit', async () => {
    const url = new URL(h.gw.createOpenUrl());
    const first = await h.gw.app.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: `127.0.0.1:${h.port}` } });
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe('/');
    expect(h.audit.list({ action: 'dashboard.login' })).toHaveLength(1);
    const again = await h.gw.app.inject({ method: 'GET', url: url.pathname + url.search, headers: { host: `127.0.0.1:${h.port}` } });
    expect(again.statusCode).toBe(401);
    const url2 = new URL(h.gw.createOpenUrl());
    h.clock.advance(61_000);
    const late = await h.gw.app.inject({ method: 'GET', url: url2.pathname + url2.search, headers: { host: `127.0.0.1:${h.port}` } });
    expect(late.statusCode).toBe(401);
    const wrong = await h.gw.app.inject({ method: 'GET', url: '/auth/open?code=nope', headers: { host: `127.0.0.1:${h.port}` } });
    expect(wrong.statusCode).toBe(401);
  });

  it('cookie phiên: 12 giờ, gia hạn khi dùng; thiếu → 401', async () => {
    const { cookie } = await h.login();
    const host = `127.0.0.1:${h.port}`;
    expect((await h.gw.app.inject({ method: 'GET', url: '/internal/bindings', headers: { host } })).statusCode).toBe(401);
    h.clock.advance(11 * 3_600_000);
    expect((await h.gw.app.inject({ method: 'GET', url: '/internal/bindings', headers: { host, cookie } })).statusCode).toBe(200); // gia hạn
    h.clock.advance(11 * 3_600_000);
    expect((await h.gw.app.inject({ method: 'GET', url: '/internal/bindings', headers: { host, cookie } })).statusCode).toBe(200);
    h.clock.advance(13 * 3_600_000);
    expect((await h.gw.app.inject({ method: 'GET', url: '/internal/bindings', headers: { host, cookie } })).statusCode).toBe(401);
  });

  it('CSRF: ghi thiếu/sai header → 403; đúng → xử lý', async () => {
    const body = { platform: 'youtube', accountId: 'UC1', displayName: 'A', furyProfileId: 'p1', marketCountry: 'DE' };
    h.fake.upsertProfile({ id: 'p1', name: 'A' });
    const noCsrf = await h.api({ method: 'POST', url: '/internal/bindings', payload: body, noCsrf: true });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ error: { code: 'FORBIDDEN_SCOPE', detail: { reason: 'csrf' } } });
    const wrong = await h.api({ method: 'POST', url: '/internal/bindings', payload: body, noCsrf: true, headers: { 'x-pv-csrf': 'wrong' } });
    expect(wrong.statusCode).toBe(403);
    const ok = await h.api({ method: 'POST', url: '/internal/bindings', payload: body });
    expect(ok.statusCode).toBe(201);
    expect(h.audit.list({ action: 'http.write' })[0]?.detailJson).toContain('/internal/bindings');
  });

  it('GET / không phiên → 401 HTML tối thiểu; có phiên không staticDir → HTML "chưa build"; đường dẫn lạ ngoài /internal → SPA fallback', async () => {
    const host = `127.0.0.1:${h.port}`;
    const anon = await h.gw.app.inject({ method: 'GET', url: '/', headers: { host } });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['content-type']).toContain('text/html');
    const { cookie } = await h.login();
    const page = await h.gw.app.inject({ method: 'GET', url: '/', headers: { host, cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('chưa được build');
    const spa = await h.gw.app.inject({ method: 'GET', url: '/bindings/ab_x', headers: { host, cookie } });
    expect(spa.statusCode).toBe(200);
    const missing = await h.gw.app.inject({ method: 'GET', url: '/internal/nope', headers: { host, cookie } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'FLOW_NOT_FOUND' } });
    expect(await h.gw.app.inject({ method: 'GET', url: '/api/v1/accounts', headers: { host, cookie } }).then((r) => r.statusCode)).toBe(404);
    expect(await h.gw.app.inject({ method: 'POST', url: '/mcp', headers: { host, cookie } }).then((r) => r.statusCode)).toBe(404);
  });
});
