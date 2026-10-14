import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PvError,
  systemClock,
  type Clock,
  type ExitInfo,
  type FuryCapabilities,
  type FuryHealth,
  type FuryLaunchResult,
  type FuryProfileDetail,
  type FuryProfileStatus,
  type FuryProfileSummary,
} from '@sctech/profilevault-contract';
import type { Logger, SecretStore } from '@sctech/profilevault-core';
import {
  DEFAULT_ENDPOINT_MAP,
  osFamilyOf,
  type EndpointSpec,
  type FuryCapability,
  type FuryEndpointMap,
  type MissingEndpoint,
  type ParseContext,
} from './adapter/endpoint-map.js';
import type { ProfileConfigFileSource } from './adapter/profile-config-file.js';
import { FURY_RETRY_BACKOFF_MS, FURY_TIMEOUTS_MS, realTimers, type FuryClient, type FuryTimeouts, type Timers } from './client.js';
import { furyOffline, isRetryableFuryError, mapHttpStatus } from './errors.js';
import { isSupportedVersion, normalizeVersion } from './version.js';

export interface HttpFuryClientOptions {
  /** `config.fury.apiBaseUrl` (đã thay biến môi trường). */
  baseUrl: string;
  /** `config.fury.supportedVersions`. */
  supportedVersions: string;
  /** Token bearer (từ SecretStore `fury.token`). */
  getToken?: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  timers?: Timers;
  clock?: Clock;
  logger?: Logger;
  endpoints?: FuryEndpointMap;
  /** Fallback đọc cấu hình profile từ `fury.dataDir` (SPEC-01 §4). */
  profileConfigSource?: ProfileConfigFileSource;
  timeouts?: Partial<FuryTimeouts>;
  /** Số lần thử lại tối đa cho lỗi mạng/5xx (mặc định 2). */
  maxRetries?: number;
}

export function fromSecretStore(store: SecretStore): () => Promise<string | undefined> {
  return () => store.get('fury.token');
}

/** File token của automation API Fury: `<thư mục dữ liệu Fury>/api-token` (agent/src/http.rs). */
export function furyTokenFile(env: NodeJS.ProcessEnv, dataDir: string | null): string | undefined {
  const dir = dataDir ?? env.FURY_HOME ?? (env.APPDATA ? path.join(env.APPDATA, 'Fury') : undefined);
  return dir ? path.join(dir, 'api-token') : undefined;
}

/**
 * Token đã lưu ở Cài đặt (DPAPI) thắng; không có → đọc file `api-token` do Fury tự tạo, mỗi lần gọi
 * (Fury có thể tạo lại). Không lưu, không log giá trị.
 */
export function furyTokenSource(store: SecretStore, tokenFile: string | undefined): () => Promise<string | undefined> {
  return async () => {
    const saved = await store.get('fury.token');
    if (saved) return saved;
    if (!tokenFile) return undefined;
    try {
      const t = (await readFile(tokenFile, 'utf8')).trim();
      return t.length > 0 ? t : undefined;
    } catch {
      return undefined;
    }
  };
}

type Cap = Exclude<FuryCapability, never>;

/** FuryClient qua automation API HTTP (SPEC-01 §5, §6, §8). */
export class HttpFuryClient implements FuryClient {
  private baseUrl: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly timers: Timers;
  private readonly clock: Clock;
  private readonly endpoints: FuryEndpointMap;
  private readonly timeouts: FuryTimeouts;
  private readonly maxRetries: number;

  constructor(private readonly opts: HttpFuryClientOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timers = opts.timers ?? realTimers;
    this.clock = opts.clock ?? systemClock;
    this.endpoints = opts.endpoints ?? DEFAULT_ENDPOINT_MAP;
    this.timeouts = { ...FURY_TIMEOUTS_MS, ...(opts.timeouts ?? {}) };
    this.maxRetries = opts.maxRetries ?? 2;
  }

  configureAddress(baseUrl: string): void {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) throw new PvError('INPUT_INVALID', 'Địa chỉ Fury không hợp lệ');
    this.baseUrl = normalized;
    this.opts.baseUrl = baseUrl;
  }

  async health(opts: { retry?: boolean } = {}): Promise<FuryHealth> {
    const checkedAt = this.clock.nowIso();
    try {
      const { version } = await this.call('health', undefined, { retry: opts.retry ?? true });
      const v = normalizeVersion(version);
      const out: FuryHealth = { reachable: true, supported: isSupportedVersion(v, this.opts.supportedVersions), checkedAt };
      if (v !== undefined) out.version = v;
      return out;
    } catch (err) {
      const detailReason = err instanceof PvError ? err.detail?.reason : undefined;
      const reason = typeof detailReason === 'string' ? detailReason : err instanceof PvError ? err.code : 'unknown';
      this.opts.logger?.debug('fury health thất bại', { reason });
      return { reachable: false, supported: false, checkedAt, error: reason };
    }
  }

  async listProfiles(): Promise<FuryProfileSummary[]> {
    return this.call('listProfiles', undefined, { retry: true });
  }

  async getProfile(profileId: string): Promise<FuryProfileDetail> {
    const detail = await this.call('getProfile', { profileId }, { retry: true });
    if (detail.personaId && this.endpoints.personas.source !== 'missing') {
      try {
        const persona = (await this.call('personas', undefined, { retry: true })).find((p) => p.id === detail.personaId);
        if (persona?.os) {
          const own = detail.persona;
          detail.persona = { ...own, platform: persona.os };
          const gpu = own?.gpuRenderer ?? persona.gpu;
          if (gpu) detail.persona.gpuRenderer = gpu;
          const screen = own?.screen ?? persona.screen;
          if (screen) detail.persona.screen = screen;
          detail.osFamily = osFamilyOf(persona.os) ?? detail.osFamily;
        }
      } catch (err) {
        this.opts.logger?.debug('không đọc được danh mục persona Fury', { error: String(err) });
      }
    }
    if (!this.opts.profileConfigSource) return detail;
    const extra = await this.opts.profileConfigSource.read(profileId);
    if (!extra) return detail;
    const merged: Record<string, unknown> = { ...detail };
    for (const [k, v] of Object.entries(extra)) if (merged[k] === undefined && v !== undefined) merged[k] = v;
    return merged as FuryProfileDetail;
  }

  async getStatus(profileId: string): Promise<FuryProfileStatus> {
    return this.call('getStatus', { profileId }, { retry: true });
  }

  /** Không thử lại; kiểm phiên bản và trạng thái trước (SPEC-01 §5, §6). */
  async launch(profileId: string, opts: { cdp: true }): Promise<FuryLaunchResult> {
    const health = await this.health();
    if (!health.reachable) throw furyOffline((health.error as 'network') ?? 'network', 'Không gọi được Fury');
    if (!health.supported) {
      throw new PvError('FURY_VERSION_UNSUPPORTED', `Phiên bản Fury ${health.version ?? '?'} ngoài khoảng hỗ trợ ${this.opts.supportedVersions}`, {
        version: health.version,
        supportedVersions: this.opts.supportedVersions,
      });
    }
    const status = await this.getStatus(profileId);
    if (status.open) {
      throw new PvError('PROFILE_BUSY', `Profile "${profileId}" đang mở (${status.via ?? 'unknown'})`, { profileId, via: status.via });
    }
    return this.call('launch', { profileId, cdp: opts.cdp }, { retry: false });
  }

  async stop(profileId: string): Promise<void> {
    await this.call('stop', { profileId }, { retry: true });
  }

  async checkExit(profileId: string): Promise<ExitInfo> {
    return this.call('checkExit', { profileId }, { retry: true });
  }

  async capabilities(): Promise<FuryCapabilities> {
    const e = this.endpoints;
    const src = (s: EndpointSpec<unknown, unknown> | MissingEndpoint) => s.source;
    const profileConfig = e.getProfile.source !== 'missing' ? e.getProfile.source : this.opts.profileConfigSource ? 'fallback' : 'missing';
    return {
      listProfiles: src(e.listProfiles as EndpointSpec<unknown, unknown> | MissingEndpoint),
      getStatus: src(e.getStatus as EndpointSpec<unknown, unknown> | MissingEndpoint),
      launchCdp: src(e.launch as EndpointSpec<unknown, unknown> | MissingEndpoint),
      stop: src(e.stop as EndpointSpec<unknown, unknown> | MissingEndpoint),
      profileConfig,
      seed: e.meta.seed,
      checkExit: src(e.checkExit as EndpointSpec<unknown, unknown> | MissingEndpoint),
      asnType: e.checkExit.source === 'missing' ? 'missing' : e.meta.asnType,
    };
  }

  // ---- nội bộ ----

  private async call<K extends Cap>(
    cap: K,
    params: ParamsOf<FuryEndpointMap[K]>,
    o: { retry: boolean },
  ): Promise<ResultOf<FuryEndpointMap[K]>> {
    const spec = this.endpoints[cap] as EndpointSpec<unknown, unknown> | MissingEndpoint;
    if (spec.source === 'missing') {
      throw new PvError('FURY_CAPABILITY_MISSING', `Fury không cung cấp năng lực ${cap}`, { capability: cap });
    }
    if (!this.baseUrl) {
      throw furyOffline('url_invalid', `config.fury.apiBaseUrl không hợp lệ: "${this.opts.baseUrl}"`, { baseUrl: this.opts.baseUrl });
    }
    const timeoutMs = this.timeouts[cap];
    const profileId = (params as { profileId?: string } | undefined)?.profileId;
    const attempts = o.retry ? this.maxRetries + 1 : 1;
    let lastErr: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const backoff = FURY_RETRY_BACKOFF_MS[Math.min(attempt - 1, FURY_RETRY_BACKOFF_MS.length - 1)] ?? 1000;
        await this.timers.sleep(backoff);
      }
      try {
        return (await this.once(cap, spec, params, timeoutMs, profileId)) as ResultOf<FuryEndpointMap[K]>;
      } catch (err) {
        lastErr = err;
        if (!isRetryableFuryError(err)) throw err;
      }
    }
    throw lastErr;
  }

  private async once(
    cap: Cap,
    spec: EndpointSpec<unknown, unknown>,
    params: unknown,
    timeoutMs: number,
    profileId: string | undefined,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${spec.path(params)}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await this.opts.getToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    const init: RequestInit = { method: spec.method, headers };
    if (spec.body) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(spec.body(params));
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    init.signal = ac.signal;
    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch (err) {
      clearTimeout(timer);
      if (ac.signal.aborted) throw furyOffline('timeout', `Fury không trả lời ${cap} trong ${timeoutMs} ms`, { capability: cap, timeoutMs });
      throw furyOffline('network', `Không kết nối được Fury (${cap})`, { capability: cap }, err);
    }
    clearTimeout(timer);
    if (!res.ok) throw mapHttpStatus(cap, res.status, profileId, await furyErrorMessage(res));
    const ctx: ParseContext = { now: this.clock.nowIso(), params };
    if (res.status === 204) return spec.parse(undefined, ctx);
    const rawText = await res.text();
    const text = this.endpoints.meta.normalizeJson ? this.endpoints.meta.normalizeJson(rawText) : rawText;
    let raw: unknown = undefined;
    if (text.length > 0) {
      try {
        raw = JSON.parse(text);
      } catch {
        throw furyOffline('bad_response', `Fury trả nội dung không phải JSON cho ${cap}`, { capability: cap });
      }
    }
    return spec.parse(raw, ctx);
  }
}

/** `message` trong thân lỗi Fury (`{ error, message }`), cắt ngắn; không đọc được → undefined. */
async function furyErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === 'string' ? body.message.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

type ParamsOf<S> = S extends { path: (params: infer P) => string } ? P : never;
type ResultOf<S> = S extends { parse: (raw: unknown, ctx: ParseContext) => infer R } ? R : never;

function normalizeBaseUrl(input: string): string | null {
  if (input.includes('${')) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}
