import { z } from 'zod';
import { AutomationLevelSchema } from './enums.js';
import { BindingIdSchema, FlowIdSchema } from './ids.js';
import { IsoDateTimeSchema, JsonObjectSchema } from './common.js';

export const FLOW_API_VERSION = '1.0.0';
export const FlowManifestSchema = z.object({ id: FlowIdSchema, version: z.string(), description: z.string(), minLevel: AutomationLevelSchema.refine((n) => n > 0, 'Flow không chạy trên L0'), modes: z.array(z.enum(['L2', 'L3'])).default([]), site: z.array(z.string().min(1)).min(1), timeoutMinutes: z.number().positive(), countsAsUpload: z.boolean().default(false), errors: z.array(z.string()).default([]) });
export type FlowManifest = z.infer<typeof FlowManifestSchema>;
export const StepOptionsSchema = z.object({ idempotent: z.boolean().default(true), retry: z.number().int().min(0).max(5).optional(), final: z.boolean().default(false), fragile: z.boolean().default(false), timeoutSeconds: z.number().positive().default(120) });
export type StepOptions = z.input<typeof StepOptionsSchema>;
export const HumanGateSchema = z.object({ reason: z.enum(['review_before_final', 'session_expired', 'challenge', 'wrong_account', 'duplicate_suspected', 'custom']), message: z.string(), choices: z.array(z.object({ id: z.string().min(1), label: z.string() })).min(1), keepProfileOpen: z.boolean(), summary: JsonObjectSchema.optional() });
export type HumanGate = z.infer<typeof HumanGateSchema>;
export const GateResultSchema = z.object({ choice: z.string(), note: z.string().optional(), resolvedAt: IsoDateTimeSchema });
export type GateResult = z.infer<typeof GateResultSchema>;
export const CheckpointSchema = z.object({ version: z.literal(1).default(1), stepIndex: z.number().int().min(-1).default(-1), state: JsonObjectSchema.default({}), stepResults: z.record(z.string(), z.unknown()).default({}), stepNames: z.array(z.string()).default([]), stepGateEnds: z.record(z.string(), z.number().int()).default({}), gateResults: z.array(GateResultSchema).default([]), activeStep: z.object({ index: z.number().int(), name: z.string(), idempotent: z.boolean() }).nullable().default(null), gateIndex: z.number().int().nullable().default(null) });
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export const GenericSessionConfigSchema = z.object({ sites: z.array(z.string()).min(1), session: z.object({ url: z.string().url(), loggedOutUrlPattern: z.string(), challengeUrlPattern: z.string() }) });
export type GenericSessionConfig = z.infer<typeof GenericSessionConfigSchema>;
export const PackManifestSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), version: z.string(), platform: z.string(), appApi: z.string(), furyVersions: z.string(), bindingConfigSchema: z.string(), forbiddenActions: z.array(z.string()), flows: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)), generic: GenericSessionConfigSchema.optional() });
export type PackManifest = z.infer<typeof PackManifestSchema>;
export const EnqueueInputSchema = z.object({ flowId: FlowIdSchema, bindingId: BindingIdSchema, input: z.unknown().default({}), mode: z.enum(['L2', 'L3']).nullable().default(null), clientId: z.string().min(1).default('scheduler'), idempotencyKey: z.string().min(1) });
export type EnqueueInput = z.input<typeof EnqueueInputSchema>;
export const SessionCheckInputSchema = z.object({});
export const SessionCheckOutputSchema = z.object({ state: z.enum(['logged_in', 'logged_out', 'challenge', 'wrong_account', 'unknown']), channelId: z.string().optional(), studioLanguage: z.string().optional(), studioLanguageOk: z.boolean().optional() });
export type SessionCheckOutput = z.infer<typeof SessionCheckOutputSchema>;
export const YoutubeBindingConfigSchema = z.object({ studioLanguage: z.literal('en'), channelHandle: z.string().optional() });
export const ForbiddenPatternsSchema = z.array(z.string());
export const ScheduleSlotsSchema = z.array(z.object({ bindingId: BindingIdSchema, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), at: IsoDateTimeSchema }));
export type ScheduleSlot = z.infer<typeof ScheduleSlotsSchema>[number];

// ---- Flow chính thức M1 (SPEC-04 §2.3–2.5, §5) ----
const FileRefInput = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[0-9a-fA-F]{64}$/) });
export const YoutubeUploadInputSchema = z.object({
  video: FileRefInput,
  thumbnail: FileRefInput.optional(),
  /** Phụ đề cũng là file đi qua kiểm SHA-256 của Job service (SPEC-04 §5.1 + decisions 2026-10-15). */
  captions: z.array(FileRefInput.extend({ language: z.string().min(2) })).max(5).optional(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000),
  madeForKids: z.boolean(),
  tags: z.array(z.string().min(1)).optional().refine((t) => !t || t.join(',').length <= 500, 'Tổng tag ≤ 500 ký tự'),
  playlistNames: z.array(z.string().min(1)).optional(),
  videoLanguage: z.string().optional(),
  alteredContent: z.boolean().optional(),
});
export type YoutubeUploadInput = z.infer<typeof YoutubeUploadInputSchema>;
export const YoutubeUploadOutputSchema = z.object({
  videoId: z.string().min(1),
  studioUrl: z.url(),
  visibility: z.literal('private'),
  warnings: z.array(z.string()),
  l2Review: z.enum(['correct', 'fixed']).optional(),
});
export type YoutubeUploadOutput = z.infer<typeof YoutubeUploadOutputSchema>;

export const ProbeFlowInputSchema = z.object({});
export const ProbeFlowOutputSchema = z.object({ raw: z.record(z.string(), z.unknown()) });
export const LocatorSpecSchema = z.object({ role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), css: z.string().optional() }).refine((l) => Object.values(l).some((v) => v !== undefined), 'Locator rỗng');
export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;
export const ReadPageInputSchema = z.object({ url: z.url(), fields: z.array(z.object({ name: z.string().min(1), locator: LocatorSpecSchema })).min(1).max(50) });
export const ReadPageOutputSchema = z.object({ values: z.record(z.string(), z.string().nullable()) });
export const OpenAndWaitInputSchema = z.object({ url: z.url(), message: z.string().min(1).max(500) });
export const OpenAndWaitOutputSchema = z.object({ choice: z.enum(['done']), note: z.string().optional() });
