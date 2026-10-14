import { z } from 'zod';
import { CountryCodeSchema, IsoDateTimeSchema, JsonObjectSchema } from './common.js';
import { ActorTypeSchema, AutomationLevelSchema, PauseReasonSchema, PlatformSchema } from './enums.js';
import { AsnTypeSchema } from './fury.js';
import { ManualEventTypeSchema } from './health-event-types.js';
import { BindingIdSchema, FlowIdSchema, LevelChangeIdSchema, PauseIdSchema, ProxyCheckIdSchema, RunIdSchema } from './ids.js';
import { ErrorCodeSchema } from './errors.js';

// ---- Binding (SPEC-00 §8 bindings; SPEC-02 §8 CreateBindingInput) ----

export const BindingSchema = z.object({
  id: BindingIdSchema,
  platform: PlatformSchema,
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  furyProfileId: z.string().min(1),
  marketCountry: CountryCodeSchema,
  packConfig: JsonObjectSchema,
  allowedRoots: z.array(z.string()),
  level: AutomationLevelSchema,
  levelSince: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  archivedAt: IsoDateTimeSchema.nullable(),
});
export type Binding = z.infer<typeof BindingSchema>;

export const CreateBindingInputSchema = z.object({
  platform: PlatformSchema,
  accountId: z.string().min(1),
  displayName: z.string().min(1).max(200),
  furyProfileId: z.string().min(1),
  marketCountry: CountryCodeSchema,
  packConfig: JsonObjectSchema.default({}),
  allowedRoots: z.array(z.string().min(1)).default([]),
});
export type CreateBindingInput = z.input<typeof CreateBindingInputSchema>;

export const UpdateBindingInputSchema = z
  .object({
    displayName: z.string().min(1).max(200),
    marketCountry: CountryCodeSchema,
    packConfig: JsonObjectSchema,
    allowedRoots: z.array(z.string().min(1)),
  })
  .partial();
export type UpdateBindingInput = z.infer<typeof UpdateBindingInputSchema>;

// ---- Ngưỡng lên mức (SPEC-02 §3.2, §3.3) ----

export const ConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('days_at_level'), min: z.number().int().min(0) }),
  z.object({ kind: z.literal('event_count'), type: z.string(), min: z.number().int().min(0) }),
  z.object({ kind: z.literal('no_red_events') }),
  z.object({ kind: z.literal('session_check_rate'), min: z.number().min(0).max(1), minSamples: z.number().int().min(1) }),
  z.object({ kind: z.literal('proxy_stable') }),
  z.object({ kind: z.literal('detect_suite_pass') }),
  z.object({ kind: z.literal('consistency_clear'), maxAgeHours: z.number().min(0) }),
  z.object({ kind: z.literal('checklist_valid') }),
  z.object({
    kind: z.literal('flow_success_rate'),
    flowId: FlowIdSchema,
    mode: z.enum(['L2', 'L3']).optional(),
    min: z.number().min(0).max(1),
    minSamples: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('l2_correct_rate'), flowId: FlowIdSchema, min: z.number().min(0).max(1), minSamples: z.number().int().min(1) }),
  z.object({ kind: z.literal('event_count_by_mode'), flowId: FlowIdSchema, mode: z.enum(['L2', 'L3']), min: z.number().int().min(0) }),
  z.object({ kind: z.literal('no_open_site_changed'), flowId: FlowIdSchema.optional() }),
]);
export type Condition = z.infer<typeof ConditionSchema>;
export type ConditionKind = Condition['kind'];

export const TransitionSchema = z.enum(['L0_to_L1', 'L1_to_L2', 'L2_to_L3']);
export type Transition = z.infer<typeof TransitionSchema>;

export const ThresholdsSchema = z.object({
  L0_to_L1: z.array(ConditionSchema),
  L1_to_L2: z.array(ConditionSchema),
  L2_to_L3: z.array(ConditionSchema),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

/** Mặc định SPEC-02 §3.3. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  L0_to_L1: [
    { kind: 'days_at_level', min: 14 },
    { kind: 'event_count', type: 'manual.upload', min: 5 },
    { kind: 'no_red_events' },
    { kind: 'proxy_stable' },
    { kind: 'detect_suite_pass' },
    { kind: 'consistency_clear', maxAgeHours: 24 },
    { kind: 'checklist_valid' },
  ],
  L1_to_L2: [
    { kind: 'days_at_level', min: 14 },
    { kind: 'session_check_rate', min: 0.95, minSamples: 10 },
    { kind: 'no_red_events' },
    { kind: 'proxy_stable' },
    { kind: 'detect_suite_pass' },
    { kind: 'consistency_clear', maxAgeHours: 24 },
    { kind: 'checklist_valid' },
  ],
  L2_to_L3: [
    { kind: 'days_at_level', min: 30 },
    { kind: 'event_count_by_mode', flowId: 'youtube/upload', mode: 'L2', min: 20 },
    { kind: 'l2_correct_rate', flowId: 'youtube/upload', min: 0.95, minSamples: 20 },
    { kind: 'no_red_events' },
    { kind: 'proxy_stable' },
    { kind: 'detect_suite_pass' },
    { kind: 'consistency_clear', maxAgeHours: 24 },
    { kind: 'checklist_valid' },
    { kind: 'no_open_site_changed', flowId: 'youtube/upload' },
  ],
};

export function transitionFor(level: 0 | 1 | 2 | 3): Transition | null {
  return level === 0 ? 'L0_to_L1' : level === 1 ? 'L1_to_L2' : level === 2 ? 'L2_to_L3' : null;
}

export const ConditionResultSchema = z.object({
  condition: ConditionSchema,
  met: z.boolean(),
  current: z.union([z.string(), z.number(), z.null()]),
  required: z.union([z.string(), z.number(), z.null()]),
  note: z.string().optional(),
});
export type ConditionResult = z.infer<typeof ConditionResultSchema>;

// ---- Pause / LevelChange / ProxyCheck ----

export const PauseSchema = z.object({
  id: PauseIdSchema,
  bindingId: BindingIdSchema,
  reason: PauseReasonSchema,
  detail: JsonObjectSchema,
  createdAt: IsoDateTimeSchema,
  clearedAt: IsoDateTimeSchema.nullable(),
  clearedBy: z.enum(['user', 'system']).nullable(),
});
export type Pause = z.infer<typeof PauseSchema>;

export const LevelChangeSchema = z.object({
  id: LevelChangeIdSchema,
  bindingId: BindingIdSchema,
  fromLevel: AutomationLevelSchema,
  toLevel: AutomationLevelSchema,
  kind: z.enum(['promote', 'demote']),
  reason: z.string(),
  detail: JsonObjectSchema,
  actor: z.string(),
  createdAt: IsoDateTimeSchema,
});
export type LevelChange = z.infer<typeof LevelChangeSchema>;

export const ProxyCheckSchema = z.object({
  id: ProxyCheckIdSchema,
  bindingId: BindingIdSchema,
  ok: z.boolean(),
  exitIp: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string().nullable(),
  asn: z.number().int().nullable(),
  asnOrg: z.string().nullable(),
  asnType: AsnTypeSchema.nullable(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
  checkedAt: IsoDateTimeSchema,
});
export type ProxyCheck = z.infer<typeof ProxyCheckSchema>;

export const ReadinessSchema = z.object({
  bindingId: BindingIdSchema,
  level: AutomationLevelSchema,
  nextLevel: AutomationLevelSchema.nullable(),
  conditions: z.array(ConditionResultSchema),
  progress: z.number().min(0).max(1).nullable(),
  canPromote: z.boolean(),
  openPauses: z.array(PauseSchema),
  evaluatedAt: IsoDateTimeSchema,
});
export type Readiness = z.infer<typeof ReadinessSchema>;

// ---- Đầu vào ghi sự kiện (SPEC-02 §5) ----

export const ManualEventInputSchema = z.object({
  type: ManualEventTypeSchema,
  occurredAt: IsoDateTimeSchema.optional(),
  note: z.string().max(2000).optional(),
});
export type ManualEventInput = z.infer<typeof ManualEventInputSchema>;

/** Khai báo tay được lùi tối đa 7 ngày (SPEC-02 §5). */
export const MANUAL_EVENT_MAX_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

export const DetectSuiteInputSchema = z.object({
  furyVersion: z.string().min(1),
  bindingId: BindingIdSchema.optional(),
  passed: z.boolean(),
  summary: z.string().max(4000).optional(),
});
export type DetectSuiteInput = z.infer<typeof DetectSuiteInputSchema>;

export const SessionCheckStateSchema = z.enum(['logged_in', 'logged_out', 'challenge', 'wrong_account', 'unknown', 'failed']);
export const SessionCheckOutcomeSchema = z.object({
  state: SessionCheckStateSchema,
  runId: RunIdSchema.optional(),
  channelId: z.string().optional(),
  studioLanguage: z.string().optional(),
  studioLanguageOk: z.boolean().optional(),
  error: z.string().optional(),
  occurredAt: IsoDateTimeSchema.optional(),
});
export type SessionCheckOutcome = z.infer<typeof SessionCheckOutcomeSchema>;

export const RunOutcomeInputSchema = z.object({
  bindingId: BindingIdSchema,
  runId: RunIdSchema,
  flowId: FlowIdSchema,
  mode: z.enum(['L2', 'L3']).nullable().optional(),
  status: z.enum(['done', 'failed', 'needs_user']),
  errorCode: ErrorCodeSchema.optional(),
  l2Review: z.enum(['correct', 'fixed']).optional(),
  step: z.string().optional(),
  occurredAt: IsoDateTimeSchema.optional(),
});
export type RunOutcomeInput = z.infer<typeof RunOutcomeInputSchema>;

export const HumanActorSchema = z.literal('user');
export const RecordingActorSchema = ActorTypeSchema;
