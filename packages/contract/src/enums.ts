import { z } from 'zod';

/** Nền tảng; mở rộng theo pack (SPEC-00 §7). */
export const KNOWN_PLATFORMS = ['youtube', 'tiktok', 'facebook'] as const;
export const PlatformSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, 'platform là chữ thường');
export type Platform = z.infer<typeof PlatformSchema>;

/** Mức tự động hóa L0..L3. */
export const AutomationLevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type AutomationLevel = z.infer<typeof AutomationLevelSchema>;
export const AUTOMATION_LEVEL_LABELS: Record<AutomationLevel, string> = {
  0: 'L0 Thủ công',
  1: 'L1 Quan sát',
  2: 'L2 Bán tự động',
  3: 'L3 Tự động',
};

export const SeveritySchema = z.enum(['block', 'warn', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

export const RuleStatusSchema = z.enum(['pass', 'fail', 'unknown', 'info', 'skipped']);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;

export const EventSeveritySchema = z.enum(['info', 'warn', 'red']);
export type EventSeverity = z.infer<typeof EventSeveritySchema>;

export const EventSourceSchema = z.enum(['manual', 'proxy_check', 'session_check', 'probe', 'run', 'fury', 'system']);
export type EventSource = z.infer<typeof EventSourceSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'needs_user', 'done', 'failed', 'cancelled', 'rejected']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const RunStatusSchema = z.enum([
  'queued',
  'waiting_profile',
  'launching',
  'running',
  'needs_user',
  'finalizing',
  'done',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const PauseReasonSchema = z.enum([
  'red_event',
  'proxy_changed',
  'detect_suite_failed',
  'consistency_block',
  'duplicate_exit_ip',
  'manual',
]);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

/** Lý do dừng mà chỉ người gỡ được (SPEC-02 §4.1 R1, R2, R7). */
export const USER_CLEARABLE_PAUSE_REASONS: readonly PauseReason[] = ['red_event', 'proxy_changed', 'manual'];

export const ActorTypeSchema = z.enum(['user', 'client', 'system']);
export type ActorType = z.infer<typeof ActorTypeSchema>;
