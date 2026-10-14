import { describe, expect, it } from 'vitest';
import { PvError } from '@sctech/profilevault-contract';
import { DEFAULT_ENDPOINT_MAP, isSupportedVersion, normalizeVersion, type EndpointSpec } from '../src/index.js';

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

describe('bộ ánh xạ endpoint mặc định (TODO(SPIKE-P2))', () => {
  const now = { now: '2026-10-14T00:00:00.000Z' };
  const getProfile = DEFAULT_ENDPOINT_MAP.getProfile as EndpointSpec<{ profileId: string }, unknown>;
  const checkExit = DEFAULT_ENDPOINT_MAP.checkExit as EndpointSpec<{ profileId: string }, unknown>;

  it('getProfile: giữ trường có, bỏ proxy credentials, chỉ giữ proxyRef', () => {
    const detail = getProfile.parse(
      {
        id: 42,
        name: 'A',
        persona: { os: 'Windows 11', userAgent: 'UA', screen: { width: 1920, height: 1080 } },
        timezone: 'Europe/Berlin',
        languages: ['de-DE', 'en'],
        geolocation: { mode: 'off' },
        webrtc: 'replace',
        proxy: { id: 'px-1', host: 'h', username: 'user', password: 'hunter2' },
      },
      now,
    ) as Record<string, unknown>;
    expect(detail).toMatchObject({ id: '42', name: 'A', tags: [], osFamily: 'windows', timezone: 'Europe/Berlin', proxyRef: 'px-1', webrtcMode: 'replace' });
    expect(JSON.stringify(detail)).not.toContain('hunter2');
    expect(JSON.stringify(detail)).not.toContain('username');
    expect(detail.seed).toBeUndefined();
  });

  it('thiếu trường bắt buộc → FURY_OFFLINE bad_response', () => {
    let caught: unknown;
    try {
      getProfile.parse({ name: 'no id' }, now);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PvError);
    expect((caught as PvError).code).toBe('FURY_OFFLINE');
    expect((caught as PvError).detail?.reason).toBe('bad_response');
  });

  it('checkExit: chuẩn hóa quốc gia, asnType lạ → unknown, lỗi → ok=false', () => {
    expect(checkExit.parse({ ip: '1.2.3.4', country: 'de', asn: 3320, asnType: 'ISP', latencyMs: 80 }, now)).toEqual({
      ok: true,
      ip: '1.2.3.4',
      country: 'DE',
      asn: 3320,
      asnType: 'isp',
      latencyMs: 80,
      checkedAt: now.now,
    });
    expect(checkExit.parse({ ip: '1.2.3.4', asnType: 'weird' }, now)).toMatchObject({ asnType: 'unknown' });
    expect(checkExit.parse({ error: 'proxy down' }, now)).toMatchObject({ ok: false, error: 'proxy down' });
  });

  it('đường dẫn mã hóa profileId', () => {
    expect(getProfile.path({ profileId: 'a b/c' })).toBe('/api/profiles/a%20b%2Fc');
  });
});
