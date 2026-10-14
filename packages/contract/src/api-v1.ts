import { z } from 'zod';
import { IsoDateTimeSchema, JsonObjectSchema } from './common.js';
import { AutomationLevelSchema, JobStatusSchema, PlatformSchema } from './enums.js';
import { ErrorCodeSchema } from './errors.js';
import { BindingIdSchema, FlowIdSchema, JobIdSchema } from './ids.js';
import { CONTRACT_VERSION } from './version.js';

/** Integration API `profilevault/v1` (SPEC-06 §5, §7). `CONTRACT_VERSION` ở version.ts; thay đổi phá vỡ → `profilevault/v2`. */

export const AccountRefSchema = z.object({ platform: PlatformSchema, accountId: z.string().min(1) });
export type AccountRef = z.infer<typeof AccountRefSchema>;

/** File trong input của job: đường dẫn tuyệt đối + SHA-256 (Job service kiểm, flow chỉ upload file đã kiểm). */
export const FileRefSchema = z.object({ path: z.string().min(1), sha256: z.string().regex(/^[0-9a-fA-F]{64}$/) });
export type FileRef = z.infer<typeof FileRefSchema>;

export const JobSourceSchema = z.object({ app: z.string().min(1).max(100), ref: z.string().max(200).optional(), traceparent: z.string().max(200).optional() });

export const SubmitJobRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION).default(CONTRACT_VERSION),
    flowId: FlowIdSchema,
    account: AccountRefSchema.optional(),
    bindingId: BindingIdSchema.optional(),
    idempotencyKey: z.string().min(1).max(200),
    input: z.unknown().default({}),
    source: JobSourceSchema.optional(),
  })
  .refine((r) => (r.account === undefined) !== (r.bindingId === undefined), { message: 'Cần đúng một trong account hoặc bindingId', path: ['account'] });
export type SubmitJobRequest = z.input<typeof SubmitJobRequestSchema>;

export const ApiJobSchema = z.object({
  id: JobIdSchema,
  flowId: FlowIdSchema,
  account: AccountRefSchema,
  status: JobStatusSchema,
  mode: z.enum(['L2', 'L3']).nullable(),
  progress: z.object({ step: z.string().nullable(), stepIndex: z.number().int(), stepCount: z.number().int().nullable(), percent: z.number().int().min(0).max(100).nullable() }),
  /** Gate đang chờ: chỉ thông tin; KHÔNG có lựa chọn để app trả lời (chỉ người trên dashboard). */
  needsUser: z.object({ reason: z.string(), message: z.string(), since: IsoDateTimeSchema, expiresAt: IsoDateTimeSchema.nullable() }).nullable(),
  result: z.unknown().nullable(),
  error: z.object({ code: ErrorCodeSchema, message: z.string(), detail: JsonObjectSchema.nullable() }).nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ApiJob = z.infer<typeof ApiJobSchema>;

export const ApiAccountSchema = z.object({
  platform: PlatformSchema,
  accountId: z.string(),
  displayName: z.string(),
  level: AutomationLevelSchema,
  paused: z.boolean(),
  flows: z.array(z.object({ flowId: FlowIdSchema, mode: z.enum(['L2', 'L3']).optional() })),
});
export type ApiAccount = z.infer<typeof ApiAccountSchema>;
export const AccountsResponseSchema = z.object({ accounts: z.array(ApiAccountSchema) });
export const AccountsQuerySchema = z.object({ platform: PlatformSchema.optional() });

export const ApiFlowSchema = z.object({
  flowId: FlowIdSchema,
  version: z.string(),
  minLevel: AutomationLevelSchema,
  modes: z.array(z.enum(['L2', 'L3'])),
  inputSchema: JsonObjectSchema.nullable(),
  outputSchema: JsonObjectSchema.nullable(),
});
export const FlowsResponseSchema = z.object({ flows: z.array(ApiFlowSchema) });

export const JobsListQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  flowId: FlowIdSchema.optional(),
  accountId: z.string().optional(),
  since: IsoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type JobsListQuery = z.input<typeof JobsListQuerySchema>;
export const JobsListResponseSchema = z.object({ jobs: z.array(ApiJobSchema), nextCursor: z.string().nullable() });

export const ApiHealthSchema = z.object({
  service: z.literal('ok'),
  fury: z.object({ reachable: z.boolean(), version: z.string().nullable(), supported: z.boolean() }),
  contractVersion: z.literal(CONTRACT_VERSION),
});


/** Mọi `{ path, sha256 }` trong input (đệ quy). Job service kiểm từng file; Runner chỉ cho flow upload các file này. */
export function collectFileRefs(input: unknown): FileRef[] {
  const out: FileRef[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) for (const x of v) walk(x);
    else if (typeof v === 'object' && v !== null) {
      const r = FileRefSchema.safeParse(v);
      if (r.success) out.push({ path: r.data.path, sha256: r.data.sha256.toLowerCase() });
      else for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  walk(input);
  return out;
}

/** Mẫu glob đơn giản trên `flowId` (`*` khớp mọi ký tự, kể cả `/`). */
export function matchesFilter(value: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => p === '*' || new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(value));
}
