import { z } from 'zod';
import { IsoDateTimeSchema, JsonObjectSchema } from './common.js';
import { AutomationLevelSchema, JobStatusSchema, PlatformSchema, RunStatusSchema } from './enums.js';
import { ErrorCodeSchema } from './errors.js';
import { FuryCapabilitiesSchema, FuryHealthSchema, FuryProfileSummarySchema } from './fury.js';
import { ManualEventTypeSchema } from './health-event-types.js';
import { BindingIdSchema, ClientIdSchema, FlowIdSchema, JobIdSchema, PauseIdSchema, RuleIdSchema, RunIdSchema, ScheduleIdSchema } from './ids.js';

/** Schema request/response của API nội bộ `/internal/*` (SPEC-05 §7). */

// ---- phiên ----
export const SessionInfoSchema = z.object({ csrfToken: z.string(), expiresAt: IsoDateTimeSchema });
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

// ---- Fury ----
export const FuryStatusSchema = z.object({ health: FuryHealthSchema.nullable(), capabilities: FuryCapabilitiesSchema.nullable(), currentVersion: z.string().nullable(), apiBaseUrl: z.string(), supportedVersions: z.string(), hasToken: z.boolean() });
export type FuryStatus = z.infer<typeof FuryStatusSchema>;
export const FuryTokenInputSchema = z.object({ token: z.string().min(1).max(4096) });
export const FuryProfileListItemSchema = FuryProfileSummarySchema.extend({ bound: z.boolean(), bindingId: BindingIdSchema.nullable() });
export type FuryProfileListItem = z.infer<typeof FuryProfileListItemSchema>;

// ---- params ----
export const BindingIdParamsSchema = z.object({ id: BindingIdSchema });
export const PauseIdParamsSchema = z.object({ id: PauseIdSchema });
export const RunIdParamsSchema = z.object({ id: RunIdSchema });
export const ScheduleIdParamsSchema = z.object({ id: ScheduleIdSchema });
export const ClientIdParamsSchema = z.object({ id: ClientIdSchema });
export const RuleIdParamsSchema = z.object({ id: RuleIdSchema });
export const ArtifactParamsSchema = z.object({ id: RunIdSchema, name: z.string().regex(/^[A-Za-z0-9._-]+$/) });

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));
const limitQ = z.coerce.number().int().min(1).max(1000).optional();

export const EventsQuerySchema = z.object({ types: csv, since: IsoDateTimeSchema.optional(), until: IsoDateTimeSchema.optional(), limit: limitQ, order: z.enum(['asc', 'desc']).optional() });
export const PauseBodySchema = z.object({ note: z.string().max(2000).optional() });
export const ManualEventBodySchema = z.object({ type: ManualEventTypeSchema, occurredAt: IsoDateTimeSchema.optional(), note: z.string().max(2000).optional() });
export const ProbeJsonBodySchema = z.object({ raw: z.record(z.string(), z.unknown()) });
export const ConsistencyRunBodySchema = z.object({ bindingId: BindingIdSchema.optional() });
export const ResolveGateBodySchema = z.object({ choice: z.string().min(1), note: z.string().max(2000).optional() });
export const GlobalPauseBodySchema = z.object({ paused: z.boolean() });
export const BusyModeBodySchema = z.object({ busy: z.boolean() });
export const JobsQuerySchema = z.object({ status: JobStatusSchema.optional(), clientId: z.string().optional(), bindingId: BindingIdSchema.optional(), limit: limitQ });

// ---- cài đặt runner (settings.runner; SPEC-03 §4.2, §5.2, SPEC-00 §5) ----
const rangeMs = z.tuple([z.number().int().min(0), z.number().int().min(0)]);
export const RunnerSettingsSchema = z.object({
  humanize: z.object({ actionDelayMs: rangeMs.default([300, 1200]), typingDelayMs: rangeMs.default([40, 140]) }).default({ actionDelayMs: [300, 1200], typingDelayMs: [40, 140] }),
  traceAlways: z.boolean().default(false),
  maxConcurrentIdle: z.number().int().min(0).optional(),
  maxConcurrentBusy: z.number().int().min(0).optional(),
  ramPerProfileMb: z.number().int().min(1).optional(),
  profileBusyTimeoutMinutes: z.number().int().min(1).optional(),
  humanGateTimeoutHours: z.number().int().min(1).optional(),
  uploadsPerAccountPerDay: z.number().int().min(1).optional(),
});
export type RunnerSettings = z.infer<typeof RunnerSettingsSchema>;

// ---- client token (SPEC-05 §4.2, §5.1) ----
export const ClientScopeSchema = z.enum(['accounts.read', 'jobs.read', 'jobs.write', 'ops.read', 'ops.write']);
export type ClientScope = z.infer<typeof ClientScopeSchema>;
export const ClientCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(ClientScopeSchema).min(1),
  flowFilter: z.array(z.string().min(1)).default(['*']),
  bindingFilter: z.array(z.string().min(1)).default(['*']),
  rateLimitPerMin: z.number().int().min(1).max(10_000).default(120),
});
export type ClientCreateInput = z.input<typeof ClientCreateInputSchema>;
export const ClientSchema = z.object({
  id: ClientIdSchema,
  name: z.string(),
  tokenPrefix: z.string(),
  scopes: z.array(ClientScopeSchema),
  flowFilter: z.array(z.string()),
  bindingFilter: z.array(z.string()),
  rateLimitPerMin: z.number().int(),
  createdAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
  lastUsedAt: IsoDateTimeSchema.nullable(),
});
export type Client = z.infer<typeof ClientSchema>;
export const ClientCreatedSchema = z.object({ client: ClientSchema, token: z.string() });

// ---- biểu đồ (SPEC-07 §8) ----
export const CHART_NAMES = ['uploads_by_mode', 'success_rates', 'needs_user_by_reason', 'session_age', 'exit_timeline', 'detect_suite_timeline', 'consistency_score'] as const;
export const ChartNameSchema = z.enum(CHART_NAMES);
export type ChartName = z.infer<typeof ChartNameSchema>;
export const ChartQuerySchema = z.object({ bindingId: BindingIdSchema.optional(), from: IsoDateTimeSchema.optional(), to: IsoDateTimeSchema.optional(), bucket: z.enum(['day', 'week']).default('day') });
export const ChartPointSchema = z.object({ bucket: z.string(), series: z.record(z.string(), z.number()) });
export const ChartSpanSchema = z.object({ from: IsoDateTimeSchema, to: IsoDateTimeSchema, label: z.string(), value: z.string().optional(), ok: z.boolean().optional() });
export const ChartResponseSchema = z.object({ name: ChartNameSchema, kind: z.enum(['series', 'spans']), bucket: z.enum(['day', 'week']), points: z.array(ChartPointSchema).optional(), spans: z.array(ChartSpanSchema).optional() });
export type ChartResponse = z.infer<typeof ChartResponseSchema>;

// ---- xuất CSV ----
export const EXPORT_DATASETS = ['events', 'proxy_checks', 'runs', 'level_changes', 'consistency_results'] as const;
export const ExportDatasetSchema = z.enum(EXPORT_DATASETS);
export const ExportQuerySchema = z.object({ bindingId: BindingIdSchema.optional(), from: IsoDateTimeSchema.optional(), to: IsoDateTimeSchema.optional() });

// ---- lịch (SPEC-03 §8.1) ----
export const ScheduleTargetSchema = z.union([
  z.object({ bindingIds: z.array(BindingIdSchema).min(1) }),
  z.object({ furyTag: z.string().min(1) }),
  z.object({ all: z.literal(true), platform: PlatformSchema.optional() }),
]);
export const ScheduleInputSchema = z.object({
  flowId: FlowIdSchema,
  target: ScheduleTargetSchema,
  daysOfWeek: z.string().regex(/^[1-7]{1,7}$/),
  windowStart: z.string().regex(/^\d{2}:\d{2}$/),
  windowEnd: z.string().regex(/^\d{2}:\d{2}$/),
  params: JsonObjectSchema.default({}),
  enabled: z.boolean().default(true),
});
export type ScheduleInput = z.input<typeof ScheduleInputSchema>;
export const ScheduleSchema = ScheduleInputSchema.extend({ id: ScheduleIdSchema, nextRunAt: IsoDateTimeSchema.nullable(), lastRunAt: IsoDateTimeSchema.nullable(), createdAt: IsoDateTimeSchema, nextRuns: z.array(z.object({ bindingId: BindingIdSchema, at: IsoDateTimeSchema })).optional() });
export type Schedule = z.infer<typeof ScheduleSchema>;

// ---- job/run (bảng SPEC-00 §8; Runner 007 dùng lại) ----
export const JobRecordSchema = z.object({
  id: JobIdSchema,
  clientId: z.string(),
  flowId: FlowIdSchema,
  bindingId: BindingIdSchema,
  idempotencyKey: z.string(),
  mode: z.enum(['L2', 'L3']).nullable(),
  status: JobStatusSchema,
  result: z.unknown().nullable(),
  errorCode: ErrorCodeSchema.nullable(),
  errorDetail: JsonObjectSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JobRecord = z.infer<typeof JobRecordSchema>;
export const RunStepRecordSchema = z.object({ seq: z.number().int(), name: z.string(), status: z.string(), attempts: z.number().int(), startedAt: IsoDateTimeSchema.nullable(), finishedAt: IsoDateTimeSchema.nullable(), errorCode: z.string().nullable() });
export const RunRecordSchema = z.object({
  id: RunIdSchema,
  jobId: JobIdSchema,
  bindingId: BindingIdSchema,
  flowId: FlowIdSchema,
  flowVersion: z.string(),
  status: RunStatusSchema,
  currentStep: z.string().nullable(),
  attempt: z.number().int(),
  needsUser: z.object({ reason: z.string(), message: z.string(), choices: z.array(z.object({ id: z.string(), label: z.string() })), keepProfileOpen: z.boolean(), since: IsoDateTimeSchema, expiresAt: IsoDateTimeSchema.optional(), summary: JsonObjectSchema.optional() }).nullable(),
  queuedAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  errorCode: ErrorCodeSchema.nullable(),
  errorDetail: JsonObjectSchema.nullable(),
  artifactsDir: z.string().nullable(),
  steps: z.array(RunStepRecordSchema),
  input: z.unknown().optional(),
  logTail: z.array(z.string()).optional(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;
export const FlowInfoSchema = z.object({ id: FlowIdSchema, version: z.string(), minLevel: AutomationLevelSchema, modes: z.array(z.enum(['L2', 'L3'])), status: z.enum(['enabled', 'disabled']), reason: z.string().optional(), description: z.string().optional(), countsAsUpload: z.boolean().optional() });
export type FlowInfo = z.infer<typeof FlowInfoSchema>;

// ---- hệ thống ----
export const SystemInfoSchema = z.object({
  service: z.object({ version: z.string(), startedAt: IsoDateTimeSchema, now: IsoDateTimeSchema }),
  fury: FuryHealthSchema.nullable(),
  queue: z.object({ queued: z.number().int(), running: z.number().int(), needsUser: z.number().int() }),
  runningProfiles: z.number().int(),
  ramFreeMb: z.number().int(),
  ramTotalMb: z.number().int(),
  busyMode: z.boolean(),
  globalPause: z.boolean(),
  packs: z.array(z.object({ id: z.string(), version: z.string(), status: z.enum(['enabled', 'disabled']), reason: z.string().optional(), flows: z.array(z.string()) })),
  bindings: z.number().int(),
  openPauses: z.number().int(),
  waitingForUser: z.number().int(),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
