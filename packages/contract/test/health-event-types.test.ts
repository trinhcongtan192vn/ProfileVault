import { describe, expect, it } from 'vitest';
import { defaultSeverity, eventMeta, HEALTH_EVENT_TYPES, HealthEventTypeSchema, isSeverityAllowed } from '../src/index.js';

describe('loại sự kiện sức khỏe (SPEC-00 §7.1)', () => {
  it('có đủ 27 loại với nguồn và mức đúng bảng', () => {
    expect(Object.keys(HEALTH_EVENT_TYPES)).toHaveLength(27);
    expect(eventMeta('manual.captcha')).toEqual({ source: 'manual', severity: 'red' });
    expect(eventMeta('proxy.country_changed')).toEqual({ source: 'proxy_check', severity: 'red' });
    expect(eventMeta('session_check.failed')).toEqual({ source: 'session_check', severity: 'warn' });
    expect(eventMeta('fury.version_changed')).toEqual({ source: 'fury', severity: 'warn' });
    expect(eventMeta('run.challenge')).toEqual({ source: 'run', severity: 'red' });
    expect(eventMeta('level.demoted')).toEqual({ source: 'system', severity: 'warn' });
  });

  it('detect_suite.recorded cho phép info hoặc red; mặc định info', () => {
    expect(defaultSeverity('detect_suite.recorded')).toBe('info');
    expect(isSeverityAllowed('detect_suite.recorded', 'red')).toBe(true);
    expect(isSeverityAllowed('detect_suite.recorded', 'warn')).toBe(false);
    expect(isSeverityAllowed('manual.upload', 'red')).toBe(false);
  });

  it('schema từ chối loại lạ', () => {
    expect(HealthEventTypeSchema.safeParse('manual.unknown').success).toBe(false);
    expect(HealthEventTypeSchema.safeParse('binding.resumed').success).toBe(true);
  });
});
