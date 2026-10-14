import { z } from 'zod';
import { IsoDateTimeSchema, JsonObjectSchema } from './common.js';
import { AutomationLevelSchema } from './enums.js';
import { BindingSchema, PauseSchema } from './health.js';
import { BindingIdSchema, HealthEventIdSchema } from './ids.js';
import { RunRecordSchema } from './internal-api.js';

/** Một dòng trang Tổng quan (SPEC-07 §4.1) — `GET /internal/overview`. */
export const OverviewRowSchema = z.object({
  binding: BindingSchema,
  daysAtLevel: z.number().int(),
  readiness: z.object({
    nextLevel: AutomationLevelSchema.nullable(),
    progress: z.number().nullable(),
    canPromote: z.boolean(),
    missing: z.array(z.string()),
  }),
  openPauses: z.array(PauseSchema),
  lastRed: z.object({ type: z.string(), at: IsoDateTimeSchema }).nullable(),
  consistency: z.object({ passed: z.number().int(), total: z.number().int(), blockFailing: z.number().int(), blockUnknown: z.number().int(), at: IsoDateTimeSchema.nullable() }).nullable(),
  exit: z.object({ country: z.string().nullable(), asn: z.number().int().nullable(), ip: z.string().nullable(), checkedAt: IsoDateTimeSchema }).nullable(),
  fury: z.object({ version: z.string().nullable(), detectSuitePassed: z.boolean() }),
});
export type OverviewRow = z.infer<typeof OverviewRowSchema>;

export const OverviewSchema = z.object({ rows: z.array(OverviewRowSchema), timezone: z.string(), now: IsoDateTimeSchema });
export type Overview = z.infer<typeof OverviewSchema>;

/** Mục trang Chờ bạn (SPEC-07 §4.4). */
export const InboxItemSchema = z.object({
  kind: z.enum(['run', 'pause', 'checklist_expiring', 'asn_unclassified', 'fury_no_detect_suite']),
  bindingId: BindingIdSchema.nullable(),
  bindingName: z.string().nullable(),
  title: z.string(),
  message: z.string(),
  at: IsoDateTimeSchema,
  data: JsonObjectSchema,
  run: RunRecordSchema.optional(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;
export const InboxSchema = z.object({ items: z.array(InboxItemSchema) });

/** Hoàn tác khai báo một chạm trong 10 phút (SPEC-07 §5; giả định G31). */
export const UNDO_WINDOW_MS = 10 * 60_000;
export const UndoEventParamsSchema = z.object({ id: BindingIdSchema, eventId: HealthEventIdSchema });
