import { createReadStream, constants as fsConstants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  collectFileRefs,
  matchesFilter,
  PvError,
  SubmitJobRequestSchema,
  type ApiAccount,
  type ApiJob,
  type Binding,
  type ClientScope,
  type Clock,
  type Config,
  type EnqueueInput,
  type FileRef,
  type FlowInfo,
  type FlowManifest,
  type JobRecord,
  type JobStatus,
  type RunRecord,
  type SubmitJobRequest,
} from '@sctech/profilevault-contract';
import type { Logger } from '@sctech/profilevault-core';
import { z } from 'zod';
import type { AuditRepo } from '@sctech/profilevault-db';
import { fromLocal, localParts, type HealthService } from '@sctech/profilevault-health';

/** Phần Runner mà Job service dùng (SPEC-03 §9). */
export interface JobRunner {
  enqueue(input: EnqueueInput): Promise<RunRecord>;
  listFlows(): FlowInfo[];
  getFlow(id: string): { manifest: FlowManifest; input: { parse(v: unknown): unknown }; output?: { parse(v: unknown): unknown } } | undefined;
  getJob(id: string): JobRecord | undefined;
  runForJob(jobId: string): RunRecord | undefined;
  jobByKey(clientId: string, key: string): JobRecord | undefined;
  listJobs(filter: { status?: string; bindingId?: string; clientId?: string; limit?: number }): JobRecord[];
  cancelRun(runId: string, actor: string): Promise<void>;
}

/** Người gửi job: client có token (SPEC-05 §4.2) hoặc client đặc biệt `dashboard` / `scheduler`. */
export interface JobClient {
  id: string;
  scopes: readonly ClientScope[];
  flowFilter: readonly string[];
  bindingFilter: readonly string[];
}
export const DASHBOARD_CLIENT: JobClient = { id: 'dashboard', scopes: ['accounts.read', 'jobs.read', 'jobs.write', 'ops.read', 'ops.write'], flowFilter: ['*'], bindingFilter: ['*'] };

export interface JobServiceDeps {
  clock: Clock;
  config: Config;
  audit: AuditRepo;
  health: HealthService;
  runner: JobRunner;
  logger?: Logger;
  /** Băm file (test tiêm); mặc định SHA-256 đọc luồng. */
  sha256File?: (file: string) => Promise<string>;
}

const COUNTING: ReadonlySet<JobStatus> = new Set(['done', 'queued', 'running', 'needs_user']);

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

function inside(child: string, root: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const c = norm(path.resolve(child));
  const r = norm(path.resolve(root));
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/**
 * Job service (SPEC-06): cửa duy nhất tạo việc cho Runner. Kiểm theo thứ tự §3 và dừng ở lỗi đầu tiên.
 */
export class JobService {
  constructor(private readonly d: JobServiceDeps) {}

  /** Tiếp nhận job. Trùng `(client, idempotencyKey)` → trả job cũ với `duplicate: true` (§3 bước 3). */
  async submit(request: SubmitJobRequest, client: JobClient): Promise<{ job: ApiJob; duplicate: boolean }> {
    // 1. Schema
    const parsed = SubmitJobRequestSchema.safeParse(request);
    if (!parsed.success) throw new PvError('INPUT_INVALID', 'Yêu cầu job sai schema', { issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) });
    const req = parsed.data;
    // 2. Scope + bộ lọc flow
    if (!client.scopes.includes('jobs.write')) this.deny(client, 'scope', { scope: 'jobs.write' });
    if (!matchesFilter(req.flowId, client.flowFilter)) this.deny(client, 'flow_filter', { flowId: req.flowId });
    // 3. Idempotency
    const existing = this.d.runner.jobByKey(client.id, req.idempotencyKey);
    if (existing) return { job: this.toApi(existing), duplicate: true };
    // 4. Flow
    const info = this.d.runner.listFlows().find((f) => f.id === req.flowId);
    const flow = this.d.runner.getFlow(req.flowId);
    if (!info) throw new PvError('FLOW_NOT_FOUND', `Không có flow ${req.flowId}`, { flowId: req.flowId });
    if (info.status !== 'enabled' || !flow) throw new PvError('FLOW_DISABLED', `Flow ${req.flowId} đang bị vô hiệu`, { flowId: req.flowId, reason: info.reason });
    // 5. Binding
    const binding = this.resolveBinding(req, client);
    const flowPlatform = req.flowId.split('/')[0];
    if (flowPlatform !== 'generic' && flowPlatform !== binding.platform) throw new PvError('ACCOUNT_NOT_BOUND', 'Flow không thuộc nền tảng của tài khoản', { flowId: req.flowId, platform: binding.platform });
    // 6. Dừng
    const pauses = this.d.health.listPauses(binding.id, { open: true });
    if (pauses.length > 0) throw new PvError('BINDING_PAUSED', 'Kênh đang bị dừng', { bindingId: binding.id, reasons: pauses.map((p) => p.reason) });
    // 7. Mức
    if (binding.level < info.minLevel) throw new PvError('LEVEL_TOO_LOW', `Kênh ở L${binding.level}, flow cần L${info.minLevel}`, { level: binding.level, minLevel: info.minLevel });
    const mode = info.modes.length === 0 ? null : binding.level >= 3 && info.modes.includes('L3') ? 'L3' : info.modes.includes('L2') ? 'L2' : null;
    if (info.modes.length > 0 && mode === null) throw new PvError('LEVEL_TOO_LOW', 'Không có chế độ phù hợp với mức kênh', { level: binding.level, modes: info.modes });
    // 8. Input
    let input: unknown;
    try {
      input = flow.input.parse(req.input);
    } catch (err) {
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      throw new PvError('INPUT_INVALID', 'Input không khớp flow', { flowId: req.flowId, issues: issues?.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) });
    }
    // 9. File
    await this.checkFiles(collectFileRefs(input), binding);
    // 10. Giới hạn upload/ngày
    if (flow.manifest.countsAsUpload) this.checkDailyLimit(binding);

    const run = await this.d.runner.enqueue({ flowId: req.flowId, bindingId: binding.id, input, mode, clientId: client.id, idempotencyKey: req.idempotencyKey });
    const job = this.d.runner.getJob(run.jobId)!;
    this.d.audit.append({
      actorType: client.id === 'dashboard' ? 'user' : client.id === 'scheduler' ? 'system' : 'client',
      actorId: client.id,
      action: 'job.submit',
      targetType: 'job',
      targetId: job.id,
      detail: { flowId: req.flowId, bindingId: binding.id, mode, ...(req.source ? { source: { app: req.source.app, ref: req.source.ref } } : {}) },
    });
    return { job: this.toApi(job), duplicate: false };
  }

  /** `GET /accounts` (SPEC-06 §5.1): binding trong bộ lọc + flow client gửi được ở mức hiện tại. */
  accounts(client: JobClient, platform?: string): ApiAccount[] {
    if (!client.scopes.includes('accounts.read')) this.deny(client, 'scope', { scope: 'accounts.read' });
    const flows = this.d.runner.listFlows().filter((f) => f.status === 'enabled' && matchesFilter(f.id, client.flowFilter));
    return this.d.health
      .listBindings()
      .filter((b) => (!platform || b.platform === platform) && (client.bindingFilter.includes('*') || client.bindingFilter.includes(b.id)))
      .map((b) => {
        const paused = this.d.health.listPauses(b.id, { open: true }).length > 0;
        const usable = flows
          .filter((f) => (f.id.startsWith('generic/') || f.id.startsWith(b.platform + '/')) && b.level >= f.minLevel)
          .map((f) => {
            const mode = f.modes.length === 0 ? undefined : b.level >= 3 && f.modes.includes('L3') ? ('L3' as const) : f.modes.includes('L2') ? ('L2' as const) : undefined;
            return mode ? { flowId: f.id, mode } : { flowId: f.id };
          });
        return { platform: b.platform, accountId: b.accountId, displayName: b.displayName, level: b.level, paused, flows: paused ? [] : usable };
      });
  }

  /** `GET /flows` (SPEC-06 §5.2): flow trong bộ lọc, kèm JSON Schema input/output. */
  flows(client: JobClient): { flowId: string; version: string; minLevel: number; modes: ('L2' | 'L3')[]; inputSchema: Record<string, unknown> | null; outputSchema: Record<string, unknown> | null }[] {
    if (!client.scopes.includes('jobs.read')) this.deny(client, 'scope', { scope: 'jobs.read' });
    return this.d.runner
      .listFlows()
      .filter((f) => f.status === 'enabled' && matchesFilter(f.id, client.flowFilter))
      .map((f) => {
        const def = this.d.runner.getFlow(f.id);
        return { flowId: f.id, version: f.version, minLevel: f.minLevel, modes: f.modes, inputSchema: jsonSchema(def?.input), outputSchema: jsonSchema(def?.output) };
      });
  }

  /** Job của chính client (dashboard thấy mọi job). */
  get(jobId: string, client: JobClient): ApiJob {
    if (!client.scopes.includes('jobs.read')) this.deny(client, 'scope', { scope: 'jobs.read' });
    const job = this.d.runner.getJob(jobId);
    if (!job || (client.id !== 'dashboard' && job.clientId !== client.id)) throw new PvError('INPUT_INVALID', 'Không có job này', { jobId });
    return this.toApi(job);
  }

  list(client: JobClient, q: { status?: JobStatus; flowId?: string; accountId?: string; since?: string; limit?: number; cursor?: string }): { jobs: ApiJob[]; nextCursor: string | null } {
    if (!client.scopes.includes('jobs.read')) this.deny(client, 'scope', { scope: 'jobs.read' });
    const limit = q.limit ?? 50;
    const all = this.d.runner
      .listJobs({ ...(client.id === 'dashboard' ? {} : { clientId: client.id }), ...(q.status ? { status: q.status } : {}), limit: 10_000 })
      .filter((j) => (!q.flowId || j.flowId === q.flowId) && (!q.since || j.createdAt >= q.since))
      .filter((j) => !q.accountId || this.d.health.getBinding(j.bindingId)?.accountId === q.accountId)
      .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
    const start = q.cursor ? all.findIndex((j) => j.id === q.cursor) + 1 : 0;
    const page = all.slice(Math.max(0, start), Math.max(0, start) + limit);
    const next = start + limit < all.length ? (page.at(-1)?.id ?? null) : null;
    return { jobs: page.map((j) => this.toApi(j)), nextCursor: next };
  }

  /** Hủy theo SPEC-03 §5.6. */
  async cancel(jobId: string, client: JobClient): Promise<ApiJob> {
    if (!client.scopes.includes('jobs.write')) this.deny(client, 'scope', { scope: 'jobs.write' });
    const job = this.get(jobId, { ...client, scopes: [...client.scopes, 'jobs.read'] });
    const run = this.d.runner.runForJob(jobId);
    if (run) await this.d.runner.cancelRun(run.id, client.id === 'dashboard' ? 'user' : 'system');
    this.d.audit.append({ actorType: client.id === 'dashboard' ? 'user' : 'client', actorId: client.id, action: 'job.cancel', targetType: 'job', targetId: jobId });
    return this.toApi(this.d.runner.getJob(jobId) ?? (job as unknown as JobRecord));
  }

  /** Job → dạng `profilevault/v1` (SPEC-06 §5.4). Gate không bao giờ kèm lựa chọn. */
  toApi(job: JobRecord): ApiJob {
    const run = this.d.runner.runForJob(job.id);
    const binding = this.d.health.getBinding(job.bindingId);
    const done = run?.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length ?? 0;
    const stepCount = run && (run.status === 'done' ? run.steps.length : null);
    const percent = job.status === 'done' ? 100 : null;
    const needs = run?.status === 'needs_user' && run.needsUser ? { reason: run.needsUser.reason, message: run.needsUser.message, since: run.needsUser.since, expiresAt: run.needsUser.expiresAt ?? null } : null;
    const errored = job.status === 'failed' || job.status === 'cancelled' || job.status === 'rejected';
    return {
      id: job.id,
      flowId: job.flowId,
      account: { platform: binding?.platform ?? 'unknown', accountId: binding?.accountId ?? '' },
      status: job.status,
      mode: job.mode,
      progress: { step: run?.currentStep ?? null, stepIndex: done, stepCount: stepCount ?? null, percent },
      needsUser: needs,
      result: job.status === 'done' ? job.result : null,
      error: errored && job.errorCode ? { code: job.errorCode, message: errorMessage(job.errorCode), detail: job.errorDetail } : null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private resolveBinding(req: { account?: { platform: string; accountId: string } | undefined; bindingId?: string | undefined }, client: JobClient): Binding {
    const b = req.bindingId
      ? this.d.health.getBinding(req.bindingId)
      : this.d.health.listBindings().find((x) => x.platform === req.account!.platform && x.accountId === req.account!.accountId);
    if (!b || b.archivedAt) throw new PvError('ACCOUNT_NOT_BOUND', 'Tài khoản chưa được gắn', { account: req.account ?? null, bindingId: req.bindingId ?? null });
    if (!client.bindingFilter.includes('*') && !client.bindingFilter.includes(b.id)) this.deny(client, 'binding_filter', { bindingId: b.id });
    return b;
  }

  private async checkFiles(refs: FileRef[], binding: Binding): Promise<void> {
    if (refs.length === 0) return;
    // Gốc dạng khai báo + dạng đã giải tên (realpath đổi tên ngắn 8.3 / symlink) — kiểm đường dẫn khai và đường dẫn thật
    const declared = binding.allowedRoots.map((r) => path.resolve(r));
    const roots = [...declared, ...(await Promise.all(declared.map(async (r) => { try { return await realpath(r); } catch { return r; } })))];
    for (const ref of refs) {
      if (!path.isAbsolute(ref.path)) throw new PvError('FILE_NOT_ALLOWED', 'Đường dẫn file phải là tuyệt đối', { path: ref.path });
      if (!roots.some((r) => inside(ref.path, r))) throw new PvError('FILE_NOT_ALLOWED', 'File nằm ngoài thư mục cho phép của kênh', { path: ref.path });
      const realRoots = await Promise.all(roots.map(async (r) => { try { return await realpath(r); } catch { return r; } }));
      let real: string;
      try {
        real = await realpath(ref.path);
        if (!(await stat(real)).isFile()) throw new Error('not a file');
        await access(real, fsConstants.R_OK);
      } catch {
        throw new PvError('FILE_NOT_FOUND', 'Không thấy hoặc không đọc được file', { path: ref.path });
      }
      // Không theo symlink ra ngoài thư mục cho phép
      if (!realRoots.some((r) => inside(real, r))) throw new PvError('FILE_NOT_ALLOWED', 'File (sau khi giải liên kết) nằm ngoài thư mục cho phép', { path: ref.path });
      const digest = await (this.d.sha256File ?? sha256OfFile)(real);
      if (digest.toLowerCase() !== ref.sha256.toLowerCase()) throw new PvError('FILE_CHANGED', 'SHA-256 của file không khớp', { path: ref.path });
    }
  }

  private checkDailyLimit(binding: Binding): void {
    const tz = this.d.config.ui.timezone;
    const now = new Date(this.d.clock.nowMs());
    const p = localParts(now, tz);
    const since = fromLocal(tz, p.year, p.month, p.day, 0, 0).toISOString();
    const uploadFlows = new Set(this.d.runner.listFlows().filter((f) => f.countsAsUpload).map((f) => f.id));
    const jobs = this.d.runner.listJobs({ bindingId: binding.id, limit: 10_000 }).filter((j) => uploadFlows.has(j.flowId) && COUNTING.has(j.status) && j.createdAt >= since).length;
    const manual = this.d.health.listEvents(binding.id, { types: ['manual.upload'], since }).length;
    const limit = this.d.config.limits.uploadsPerAccountPerDay;
    if (jobs + manual >= limit) throw new PvError('DAILY_LIMIT_REACHED', `Đã đủ ${limit} upload hôm nay cho kênh này`, { count: jobs + manual, limit });
  }

  private deny(client: JobClient, reason: string, detail: Record<string, unknown>): never {
    this.d.audit.append({ actorType: 'client', actorId: client.id, action: 'auth.denied', detail: { reason, ...detail } });
    throw new PvError('FORBIDDEN_SCOPE', 'Client không có quyền cho yêu cầu này', { reason, ...detail });
  }
}

function jsonSchema(v: unknown): Record<string, unknown> | null {
  if (!(v instanceof z.ZodType)) return null;
  try {
    return z.toJSONSchema(v, { io: 'input', unrepresentable: 'any' });
  } catch {
    return null;
  }
}

const MESSAGES: Record<string, string> = {
  LEVEL_TOO_LOW: 'Kênh chưa đủ mức cho flow này',
  BINDING_PAUSED: 'Kênh đang bị dừng',
  SESSION_EXPIRED: 'Phiên đăng nhập hết hạn',
  CHALLENGE: 'Nền tảng yêu cầu xác minh',
  WRONG_ACCOUNT: 'Profile đang đăng nhập sai kênh',
  SITE_CHANGED: 'Giao diện nền tảng đã đổi',
  FILE_CHANGED: 'File đổi sau khi gửi job',
  CANCELLED: 'Job đã bị hủy',
  TIMEOUT: 'Quá thời gian',
  FURY_OFFLINE: 'Fury không phản hồi',
  INTERRUPTED: 'Run bị ngắt giữa chừng',
};
function errorMessage(code: string): string {
  return MESSAGES[code] ?? code;
}
