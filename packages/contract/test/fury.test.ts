import { describe, expect, it } from 'vitest';
import { ExitInfoSchema, FURY_CAPABILITY_NAMES, FuryCapabilitiesSchema, FuryProfileDetailSchema } from '../src/index.js';

describe('kiểu Fury (SPEC-01 §3)', () => {
  it('ExitInfo chấp nhận ví dụ, từ chối asnType lạ', () => {
    expect(
      ExitInfoSchema.safeParse({ ok: true, ip: '1.2.3.4', country: 'DE', asn: 3320, asnType: 'isp', checkedAt: '2026-10-14T00:00:00.000Z' }).success,
    ).toBe(true);
    expect(ExitInfoSchema.safeParse({ ok: true, asnType: 'vpn', checkedAt: '2026-10-14T00:00:00.000Z' }).success).toBe(false);
  });

  it('FuryProfileDetail: trường tùy chọn thiếu được, không có trường proxy credentials', () => {
    const r = FuryProfileDetailSchema.safeParse({ id: 'p1', name: 'A', tags: [] });
    expect(r.success).toBe(true);
    const keys = Object.keys(FuryProfileDetailSchema.shape);
    expect(keys).toContain('proxyRef');
    expect(keys.some((k) => /password|cookie|username/i.test(k))).toBe(false);
  });

  it('FuryCapabilities cần đủ 8 khóa', () => {
    expect(FURY_CAPABILITY_NAMES).toHaveLength(8);
    const full = Object.fromEntries(FURY_CAPABILITY_NAMES.map((n) => [n, 'native']));
    expect(FuryCapabilitiesSchema.safeParse(full).success).toBe(true);
    expect(FuryCapabilitiesSchema.safeParse({ listProfiles: 'native' }).success).toBe(false);
  });
});
