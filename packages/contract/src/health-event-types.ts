import { z } from 'zod';
import type { EventSeverity, EventSource } from './enums.js';

export interface HealthEventMeta {
  source: EventSource;
  /** Một mức, hoặc danh sách mức cho phép (phần tử đầu là mặc định). */
  severity: EventSeverity | readonly EventSeverity[];
}

/** Bảng loại sự kiện sức khỏe (SPEC-00 §7.1). */
export const HEALTH_EVENT_TYPES = {
  'manual.upload': { source: 'manual', severity: 'info' },
  'manual.verification_request': { source: 'manual', severity: 'red' },
  'manual.captcha': { source: 'manual', severity: 'red' },
  'manual.platform_warning': { source: 'manual', severity: 'red' },
  'manual.logged_out': { source: 'manual', severity: 'red' },
  'manual.note': { source: 'manual', severity: 'info' },
  'fury.profile_opened': { source: 'fury', severity: 'info' },
  'fury.profile_closed': { source: 'fury', severity: 'info' },
  'fury.version_changed': { source: 'fury', severity: 'warn' },
  'proxy.country_changed': { source: 'proxy_check', severity: 'red' },
  'proxy.asn_changed': { source: 'proxy_check', severity: 'red' },
  'proxy.check_failed': { source: 'proxy_check', severity: 'warn' },
  'session_check.ok': { source: 'session_check', severity: 'info' },
  'session_check.logged_out': { source: 'session_check', severity: 'red' },
  'session_check.wrong_account': { source: 'session_check', severity: 'red' },
  'session_check.failed': { source: 'session_check', severity: 'warn' },
  'probe.imported': { source: 'probe', severity: 'info' },
  'detect_suite.recorded': { source: 'system', severity: ['info', 'red'] },
  'run.done': { source: 'run', severity: 'info' },
  'run.failed': { source: 'run', severity: 'warn' },
  'run.needs_user': { source: 'run', severity: 'warn' },
  'run.challenge': { source: 'run', severity: 'red' },
  'flow.site_changed': { source: 'run', severity: 'warn' },
  'level.promoted': { source: 'system', severity: 'info' },
  'level.demoted': { source: 'system', severity: 'warn' },
  'binding.paused': { source: 'system', severity: 'warn' },
  'binding.resumed': { source: 'system', severity: 'info' },
} as const satisfies Record<string, HealthEventMeta>;

export type HealthEventType = keyof typeof HEALTH_EVENT_TYPES;
const typeNames = Object.keys(HEALTH_EVENT_TYPES) as [HealthEventType, ...HealthEventType[]];
export const HealthEventTypeSchema = z.enum(typeNames);

/** Loại sự kiện người vận hành khai báo tay (SPEC-02 §5). */
export const ManualEventTypeSchema = z.enum([
  'manual.upload',
  'manual.verification_request',
  'manual.captcha',
  'manual.platform_warning',
  'manual.logged_out',
  'manual.note',
]);
export type ManualEventType = z.infer<typeof ManualEventTypeSchema>;

export function eventMeta(type: HealthEventType): HealthEventMeta {
  return HEALTH_EVENT_TYPES[type];
}

/** Mức mặc định của loại sự kiện (phần tử đầu nếu là danh sách). */
export function defaultSeverity(type: HealthEventType): EventSeverity {
  const s = HEALTH_EVENT_TYPES[type].severity;
  return typeof s === 'string' ? s : s[0];
}

/** Mức có hợp lệ cho loại sự kiện không. */
export function isSeverityAllowed(type: HealthEventType, severity: EventSeverity): boolean {
  const s = HEALTH_EVENT_TYPES[type].severity;
  return typeof s === 'string' ? s === severity : (s as readonly EventSeverity[]).includes(severity);
}
