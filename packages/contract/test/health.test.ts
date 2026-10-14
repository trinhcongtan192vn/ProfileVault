import { describe, expect, it } from 'vitest';
import { ConditionSchema, CreateBindingInputSchema, DEFAULT_THRESHOLDS, ThresholdsSchema, transitionFor } from '../src/index.js';

describe('ngưỡng (SPEC-02 §3)', () => {
  it('mặc định §3.3: 7/7/9 điều kiện, hợp lệ theo schema', () => {
    expect(DEFAULT_THRESHOLDS.L0_to_L1).toHaveLength(7);
    expect(DEFAULT_THRESHOLDS.L1_to_L2).toHaveLength(7);
    expect(DEFAULT_THRESHOLDS.L2_to_L3).toHaveLength(9);
    expect(ThresholdsSchema.safeParse(DEFAULT_THRESHOLDS).success).toBe(true);
    expect(DEFAULT_THRESHOLDS.L0_to_L1[0]).toEqual({ kind: 'days_at_level', min: 14 });
    expect(DEFAULT_THRESHOLDS.L2_to_L3[0]).toEqual({ kind: 'days_at_level', min: 30 });
  });
  it('kind lạ bị từ chối; transitionFor', () => {
    expect(ConditionSchema.safeParse({ kind: 'magic' }).success).toBe(false);
    expect(ConditionSchema.safeParse({ kind: 'session_check_rate', min: 0.95, minSamples: 10 }).success).toBe(true);
    expect(transitionFor(0)).toBe('L0_to_L1');
    expect(transitionFor(3)).toBeNull();
  });
  it('CreateBindingInput: marketCountry ISO2 hoa', () => {
    expect(CreateBindingInputSchema.safeParse({ platform: 'youtube', accountId: 'UC1', displayName: 'A', furyProfileId: 'p1', marketCountry: 'de' }).success).toBe(false);
    const r = CreateBindingInputSchema.safeParse({ platform: 'youtube', accountId: 'UC1', displayName: 'A', furyProfileId: 'p1', marketCountry: 'DE' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.allowedRoots).toEqual([]);
  });
});
