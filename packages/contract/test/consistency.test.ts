import { describe, expect, it } from 'vitest';
import { ChecklistStatusSchema, NormalizedProbeSchema, PROBE_REQUIRED_PATHS, RULE_IDS } from '../src/index.js';

describe('contract consistency (SPEC-02 §6)', () => {
  it('22 luật theo 5 lớp (A6 B4 C3 D5 E4)', () => {
    expect(RULE_IDS).toHaveLength(22);
    expect(RULE_IDS.filter((r) => r.startsWith('A'))).toHaveLength(6);
    expect(RULE_IDS.filter((r) => r.startsWith('D'))).toHaveLength(5);
  });
  it('NormalizedProbe: thiếu trường bắt buộc bị từ chối', () => {
    expect(PROBE_REQUIRED_PATHS).toContain('timezone');
    const r = NormalizedProbeSchema.safeParse({ furyVersion: '0.2.23', capturedAt: '2026-10-14T00:00:00.000Z', userAgent: 'UA' });
    expect(r.success).toBe(false);
  });
  it('ChecklistStatus không có trường giá trị gốc', () => {
    const keys = Object.keys(ChecklistStatusSchema.shape);
    expect(keys).not.toContain('recoveryEmail');
    expect(keys).toContain('hasRecoveryEmail');
  });
});
