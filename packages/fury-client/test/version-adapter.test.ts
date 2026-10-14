import { describe, expect, it } from 'vitest';
import { PvError } from '@sctech/profilevault-contract';
import { DEFAULT_ENDPOINT_MAP, isSupportedVersion, normalizeVersion, parseExitInfo, parseExitLookup, parseScreen, quoteBigSeeds, type EndpointSpec } from '../src/index.js';

describe('isSupportedVersion (SPEC-01 §6)', () => {
  const range = '>=0.2.21 <0.4.0';
  it('trong/ngoài khoảng, coerce chuỗi lạ', () => {
    expect(isSupportedVersion('0.2.21', range)).toBe(true);
    expect(isSupportedVersion('0.3.9', range)).toBe(true);
    expect(isSupportedVersion('0.4.0', range)).toBe(false);
    expect(isSupportedVersion('0.2.20', range)).toBe(false);
    expect(isSupportedVersion('v0.2.23', range)).toBe(true);
    expect(isSupportedVersion('0.2.23-win', range)).toBe(true);
    expect(isSupportedVersion(undefined, range)).toBe(false);
    expect(isSupportedVersion('garbage', range)).toBe(false);
    expect(normalizeVersion('v0.2.23')).toBe('0.2.23');
  });
});

describe('bộ ánh xạ endpoint Fury 0.3.22 (SPIKE-P2)', () => {
  const ctx = (profileId?: string) => ({ now: '2026-10-14T00:00:00.000Z', params: profileId ? { profileId } : undefined });
  const getProfile = DEFAULT_ENDPOINT_MAP.getProfile as EndpointSpec<{ profileId: string }, Record<string, unknown>>;
  const listProfiles = DEFAULT_ENDPOINT_MAP.listProfiles as EndpointSpec<void, unknown[]>;
  // Hàng thật từ Fury 0.3.22 (giá trị định danh đã thay)
  const row = {
    allow_no_proxy: false,
    blocklists: [],
    fp_seed: '7021075368349779267',
    id: '01a13b30-cab1-7c90-afd3-c39ffd9f0d73',
    inline_lists: [],
    languages: null,
    last_opened_at: '2026-10-14T16:23:40.9839711Z',
    name: 'Kênh test',
    notes: '',
    overrides: { geolocation: { latitude: 52.52, longitude: 13.4 }, screen: { width: 1536, height: 864, device_pixel_ratio: 1.25 } },
    persona_id: 'win11-iris-xe-1920x1080',
    project_id: null,
    project_name: null,
    proxy: { id: 'px-1', name: 'DE', host: 'h', username: 'user', password: 'hunter2' },
    proxy_id: 'px-1',
    running: false,
    start_urls: ['https://www.google.com/'],
    status: '',
    tags: [],
    timezone: null,
  };

  it('getProfile: lấy theo id từ danh sách; override thắng; bỏ proxy credentials; null → không đoán', () => {
    const d = getProfile.parse({ ok: true, data: [row] }, ctx(row.id));
    expect(d).toEqual({
      id: row.id,
      name: 'Kênh test',
      tags: [],
      personaId: 'win11-iris-xe-1920x1080',
      osFamily: 'windows',
      seed: '7021075368349779267',
      proxyRef: 'px-1',
      geolocation: { mode: 'manual', lat: 52.52, lon: 13.4 },
      persona: { platform: 'win11-iris-xe-1920x1080', screen: { width: 1536, height: 864 } },
    });
    expect(JSON.stringify(d)).not.toContain('hunter2');
    expect(getProfile.parse({ ok: true, data: [{ ...row, overrides: {} }] }, ctx(row.id)).geolocation).toEqual({ mode: 'auto' });
    expect(() => getProfile.parse({ ok: true, data: [row] }, ctx('khac'))).toThrow(/không tồn tại/);
  });

  it('phong bì sai → FURY_OFFLINE bad_response', () => {
    let caught: unknown;
    try {
      listProfiles.parse([row], ctx());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PvError);
    expect((caught as PvError).detail?.reason).toBe('bad_response');
  });

  it('fp_seed u64 → chuỗi trước JSON.parse (không mất chính xác); màn hình "W×H"', () => {
    const text = '{"ok":true,"data":[{"id":"a","fp_seed":7021075368349779267},{"id":"b","fp_seed":-5}]}';
    // JSON.parse thẳng làm tròn số
    expect(String((JSON.parse(text) as { data: { fp_seed: number }[] }).data[0]?.fp_seed)).not.toBe('7021075368349779267');
    const fixed = JSON.parse(quoteBigSeeds(text)) as { data: { fp_seed: string }[] };
    expect(fixed.data.map((r) => r.fp_seed)).toEqual(['7021075368349779267', '-5']);
    expect(parseScreen('1920×1080')).toEqual({ width: 1920, height: 1080 });
    expect(parseScreen('1440x900')).toEqual({ width: 1440, height: 900 });
    expect(parseScreen(null)).toBeUndefined();
  });

  it('launch: body { id, cdp }; ws_endpoint → cdpEndpoint, pid → sessionRef; không cấp CDP → FURY_CAPABILITY_MISSING', () => {
    const launch = DEFAULT_ENDPOINT_MAP.launch as EndpointSpec<{ profileId: string; cdp: true }, { cdpEndpoint: string; sessionRef: string }>;
    expect(launch.path({ profileId: 'x', cdp: true })).toBe('/v1/profiles/start');
    expect(launch.body?.({ profileId: 'x', cdp: true })).toEqual({ id: 'x', cdp: true });
    expect(launch.parse({ ok: true, data: { pid: 40213, relay_port: 51834, debug_port: 51835, ws_endpoint: 'ws://127.0.0.1:51835/devtools/browser/9c1f' } }, ctx())).toEqual({
      cdpEndpoint: 'ws://127.0.0.1:51835/devtools/browser/9c1f',
      sessionRef: '40213',
    });
    expect(() => launch.parse({ ok: true, data: { pid: 1, relay_port: 2 } }, ctx())).toThrow(/không cấp CDP/);
    expect(DEFAULT_ENDPOINT_MAP.checkExit.source).toBe('missing'); // SPIKE-P5: tra exit thay thế
  });

  it('parseExitInfo (cho nguồn kiểm exit sau P5): chuẩn hóa quốc gia, asnType lạ → unknown, lỗi → ok=false', () => {
    const now = ctx();
    expect(parseExitInfo({ ip: '1.2.3.4', country: 'de', asn: 3320, asnType: 'ISP', latencyMs: 80 }, now)).toEqual({
      ok: true,
      ip: '1.2.3.4',
      country: 'DE',
      asn: 3320,
      asnType: 'isp',
      latencyMs: 80,
      checkedAt: now.now,
    });
    expect(parseExitInfo({ ip: '1.2.3.4', asnType: 'weird' }, now)).toMatchObject({ asnType: 'unknown' });
    expect(parseExitInfo({ error: 'proxy down' }, now)).toMatchObject({ ok: false, error: 'proxy down' });
  });
});

describe('tra exit (SPIKE-P5)', () => {
  it('ipinfo: org "AS… tên" → asn + asnOrg; asn riêng; quốc gia viết hoa', () => {
    expect(parseExitLookup({ ip: '1.2.3.4', country: 'de', org: 'AS3320 Deutsche Telekom AG' })).toEqual({ ip: '1.2.3.4', country: 'DE', asn: 3320, asnOrg: 'Deutsche Telekom AG' });
    expect(parseExitLookup({ ip: '1.2.3.4', asn: { asn: 'AS7922', name: 'Comcast' } })).toEqual({ ip: '1.2.3.4', asn: 7922, asnOrg: 'Comcast' });
    expect(parseExitLookup({})).toEqual({});
  });

  it('/v1/proxies chỉ giữ id + last_*; bỏ host, username, password', () => {
    const proxies = DEFAULT_ENDPOINT_MAP.proxies as EndpointSpec<void, unknown[]>;
    const out = proxies.parse({ ok: true, data: [{ id: 'px', name: 'de', kind: 'socks5', host: 'h', port: 1080, username: 'u', password: 'hunter2', last_ip: '1.2.3.4', last_country: 'de', last_timezone: 'Europe/Berlin' }] }, { now: 'x' });
    expect(out).toEqual([{ id: 'px', lastIp: '1.2.3.4', lastCountry: 'DE', lastTimezone: 'Europe/Berlin' }]);
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });
});
