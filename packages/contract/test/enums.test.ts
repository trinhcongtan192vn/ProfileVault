import { describe, expect, it } from 'vitest';
import {
  AutomationLevelSchema,
  JobStatusSchema,
  PauseReasonSchema,
  RuleStatusSchema,
  RunStatusSchema,
  SeveritySchema,
  USER_CLEARABLE_PAUSE_REASONS,
} from '../src/index.js';

describe('enum dùng chung (SPEC-00 §7)', () => {
  it('AutomationLevel chỉ 0..3', () => {
    expect(AutomationLevelSchema.safeParse(3).success).toBe(true);
    expect(AutomationLevelSchema.safeParse(4).success).toBe(false);
    expect(AutomationLevelSchema.safeParse('1').success).toBe(false);
  });
  it('các enum đúng danh sách', () => {
    expect(SeveritySchema.options).toEqual(['block', 'warn', 'info']);
    expect(RuleStatusSchema.options).toEqual(['pass', 'fail', 'unknown', 'info', 'skipped']);
    expect(JobStatusSchema.options).toEqual(['queued', 'running', 'needs_user', 'done', 'failed', 'cancelled', 'rejected']);
    expect(RunStatusSchema.options).toHaveLength(9);
    expect(PauseReasonSchema.options).toHaveLength(6);
    expect(USER_CLEARABLE_PAUSE_REASONS).toEqual(['red_event', 'proxy_changed', 'manual']);
  });
});
