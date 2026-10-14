import {
  AccountsResponseSchema,
  ApiHealthSchema,
  ApiJobSchema,
  FlowsResponseSchema,
  JobsListResponseSchema,
  type ApiAccount,
  type ApiJob,
  type JobsListQuery,
  type SubmitJobRequest,
} from './api-v1.js';
import { ApiErrorSchema } from './errors.js';
import { CONTRACT_VERSION } from './version.js';

/** Lỗi trả về từ ProfileVault (`{ error: { code, message, detail } }`, SPEC-00 §9). */
export class ProfileVaultApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProfileVaultApiError';
  }
}

export interface ProfileVaultClientOptions {
  /** Mặc định `http://127.0.0.1:50410`. */
  baseUrl?: string;
  /** Token client `pv_…` tạo trên dashboard (Cài đặt → Ứng dụng kết nối). */
  token: string;
  fetch?: typeof fetch;
  /** Thử lại cho lỗi mạng và 429 (mặc định 3). Không thử lại lỗi nghiệp vụ. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Client mẫu cho Integration API `profilevault/v1` (SPEC-06 §7). Chạy được trên Node 22 và trình duyệt (chỉ dùng fetch).
 * Gửi lại cùng `idempotencyKey` sau lỗi mạng là an toàn: server trả job cũ (`duplicate: true`).
 */
export class ProfileVaultClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: ProfileVaultClientOptions) {
    this.base = (opts.baseUrl ?? 'http://127.0.0.1:50410').replace(/\/+$/, '') + '/api/v1';
    this.fetchFn = opts.fetch ?? ((i, init) => fetch(i, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async health() {
    return ApiHealthSchema.parse((await this.request('GET', '/health')).body);
  }
  async accounts(platform?: string): Promise<ApiAccount[]> {
    return AccountsResponseSchema.parse((await this.request('GET', `/accounts${platform ? `?platform=${encodeURIComponent(platform)}` : ''}`)).body).accounts;
  }
  async flows() {
    return FlowsResponseSchema.parse((await this.request('GET', '/flows')).body).flows;
  }
  async submitJob(req: Omit<SubmitJobRequest, 'contractVersion'>): Promise<{ job: ApiJob; duplicate: boolean }> {
    const r = await this.request('POST', '/jobs', { contractVersion: CONTRACT_VERSION, ...req });
    return { job: ApiJobSchema.parse(r.body), duplicate: r.headers.get('x-pv-duplicate') === 'true' };
  }
  async getJob(id: string): Promise<ApiJob> {
    return ApiJobSchema.parse((await this.request('GET', `/jobs/${encodeURIComponent(id)}`)).body);
  }
  async listJobs(q: JobsListQuery = {}) {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]): [string, string] => [k, String(v)]));
    return JobsListResponseSchema.parse((await this.request('GET', `/jobs${params.size ? `?${params.toString()}` : ''}`)).body);
  }
  async cancelJob(id: string): Promise<ApiJob> {
    return ApiJobSchema.parse((await this.request('POST', `/jobs/${encodeURIComponent(id)}/cancel`)).body);
  }
  /** Hỏi trạng thái tới khi job kết thúc hoặc hết `timeoutMs` (mặc định hỏi mỗi 15 s, SPEC-06 §6). */
  async waitForJob(id: string, o: { intervalMs?: number; timeoutMs?: number } = {}): Promise<ApiJob> {
    const deadline = Date.now() + (o.timeoutMs ?? 3_600_000);
    for (;;) {
      const job = await this.getJob(id);
      if (['done', 'failed', 'cancelled', 'rejected'].includes(job.status) || Date.now() >= deadline) return job;
      await this.sleep(o.intervalMs ?? 15_000);
    }
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ body: unknown; headers: Headers }> {
    const max = this.opts.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.base}${path}`, {
          method,
          headers: { authorization: `Bearer ${this.opts.token}`, accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (err) {
        if (attempt >= max) throw new ProfileVaultApiError(0, 'NETWORK', `Không kết nối được ProfileVault: ${err instanceof Error ? err.message : String(err)}`);
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 429 && attempt < max) {
        await this.sleep(Number(res.headers.get('retry-after') ?? '1') * 1000);
        continue;
      }
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const e = ApiErrorSchema.safeParse(data);
        if (e.success) throw new ProfileVaultApiError(res.status, e.data.error.code, e.data.error.message, e.data.error.detail);
        throw new ProfileVaultApiError(res.status, 'INTERNAL', `HTTP ${res.status}`);
      }
      return { body: data, headers: res.headers };
    }
  }
}
