import { z } from 'zod';
import { IsoDateTimeSchema, JsonObjectSchema } from './common.js';
import { AutomationLevelSchema, EventSeveritySchema, EventSourceSchema, PauseReasonSchema, RunStatusSchema } from './enums.js';
import { HealthEventTypeSchema } from './health-event-types.js';
import { BindingIdSchema, FlowIdSchema, HealthEventIdSchema, JobIdSchema, LevelChangeIdSchema, PauseIdSchema, RunIdSchema } from './ids.js';
import { ErrorCodeSchema } from './errors.js';

/** Hàng `health_events` (SPEC-00 §8). */
export const HealthEventRecordSchema = z.object({
  id: HealthEventIdSchema,
  bindingId: BindingIdSchema.nullable(),
  type: HealthEventTypeSchema,
  severity: EventSeveritySchema,
  source: EventSourceSchema,
  payload: JsonObjectSchema,
  occurredAt: IsoDateTimeSchema,
  recordedAt: IsoDateTimeSchema,
});
export type HealthEventRecord = z.infer<typeof HealthEventRecordSchema>;

/** Sự kiện bus nội bộ (SPEC-00 §10). */
export const BUS_EVENTS = {
  'health.event_recorded': z.object({ event: HealthEventRecordSchema }),
  'binding.level_changed': z.object({
    bindingId: BindingIdSchema,
    changeId: LevelChangeIdSchema,
    fromLevel: AutomationLevelSchema,
    toLevel: AutomationLevelSchema,
    kind: z.enum(['promote', 'demote']),
    reason: z.string(),
  }),
  'binding.pause_changed': z.object({
    bindingId: BindingIdSchema,
    pauseId: PauseIdSchema,
    reason: PauseReasonSchema,
    open: z.boolean(),
  }),
  'run.status_changed': z.object({
    runId: RunIdSchema,
    jobId: JobIdSchema,
    bindingId: BindingIdSchema,
    flowId: FlowIdSchema,
    status: RunStatusSchema,
    step: z.string().optional(),
    errorCode: ErrorCodeSchema.optional(),
  }),
  'run.needs_user': z.object({
    runId: RunIdSchema,
    bindingId: BindingIdSchema,
    gate: z.object({ reason: z.string(), message: z.string() }).passthrough(),
  }),
  'fury.status_changed': z.object({
    reachable: z.boolean(),
    version: z.string().optional(),
    supported: z.boolean(),
  }),
} as const;

export type BusEventName = keyof typeof BUS_EVENTS;
export type BusEventMap = { [K in BusEventName]: z.infer<(typeof BUS_EVENTS)[K]> };
export const BusEventNameSchema = z.enum(Object.keys(BUS_EVENTS) as [BusEventName, ...BusEventName[]]);
