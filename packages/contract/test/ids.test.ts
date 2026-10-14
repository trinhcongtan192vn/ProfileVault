import { describe, expect, it } from 'vitest';
import { BindingIdSchema, FlowIdSchema, ID_PREFIXES, isIdOf, newId, RuleIdSchema, ulid, ulidTime } from '../src/index.js';

describe('ULID và ID có tiền tố (SPEC-00 §6)', () => {
  it('sinh 1000 ID khác nhau, đúng tiền tố, 26 ký tự Crockford', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newId('healthEvent'));
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id.startsWith('he_')).toBe(true);
      expect(id.slice(3)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('sắp xếp được theo thời gian và đơn điệu trong cùng mili giây', () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_000);
    const c = ulid(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(ulidTime(a)).toBe(1_700_000_000_000);
    expect(ulidTime(c)).toBe(1_700_000_000_001);
  });

  it('schema ID chấp nhận đúng tiền tố, từ chối sai', () => {
    const ok = newId('binding');
    expect(BindingIdSchema.safeParse(ok).success).toBe(true);
    expect(BindingIdSchema.safeParse('xx_' + ok.slice(3)).success).toBe(false);
    expect(BindingIdSchema.safeParse('ab_short').success).toBe(false);
    expect(BindingIdSchema.safeParse('ab_' + 'I'.repeat(26)).success).toBe(false); // I không thuộc Crockford
    expect(isIdOf('binding', ok)).toBe(true);
    expect(isIdOf('job', ok)).toBe(false);
  });

  it('có đủ 12 tiền tố theo SPEC-00 §6', () => {
    expect(Object.values(ID_PREFIXES).sort()).toEqual(
      ['ab', 'lc', 'bp', 'he', 'px', 'pr', 'cc', 'jb', 'rn', 'sc', 'ca', 'au'].sort(),
    );
  });

  it('flow id và rule id', () => {
    expect(FlowIdSchema.safeParse('youtube/upload').success).toBe(true);
    expect(FlowIdSchema.safeParse('upload').success).toBe(false);
    expect(RuleIdSchema.safeParse('A1.exit_country_matches_market').success).toBe(true);
    expect(RuleIdSchema.safeParse('F1.x').success).toBe(false);
  });
});
