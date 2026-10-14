/**
 * FakeFury — HTTP server giả lập automation API Fury cho test (SPEC-09 §3.1).
 * Theo API thật của Fury 0.3.22 đã xác minh ở SPIKE-P2 (xem src/adapter/endpoint-map.ts).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_ENDPOINT_MAP, parseExitInfo, type FuryEndpointMap } from '../adapter/endpoint-map.js';

export interface FakeProfile {
  id: string;
  name: string;
  tags?: string[];
  personaId?: string;
  os?: string;
  persona?: {
    platform?: string;
    userAgent?: string;
    gpuRenderer?: string;
    screen?: { width: number; height: number };
    hardwareConcurrency?: number;
    deviceMemory?: number;
  };
  seed?: string;
  timezone?: string;
  languages?: string[];
  geolocation?: { mode: 'off' | 'auto' | 'manual'; lat?: number; lon?: number };
  webrtc?: string;
  /** Có cả credentials để kiểm bộ chuyển đổi loại bỏ chúng. */
  proxy?: { id: string; host?: string; username?: string; password?: string };
}

export interface FakeExit {
  ip?: string;
  country?: string;
  city?: string;
  timezone?: string;
  asn?: number;
  asnOrg?: string;
  asnType?: string;
  latencyMs?: number;
  error?: string;
}

export type FakeCapability = 'health' | 'listProfiles' | 'personas' | 'launch' | 'stop' | 'checkExit';

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  authorization: string | undefined;
}

export interface FakeFuryOptions {
  version?: string;
  token?: string;
  authRequired?: boolean;
}

interface OpenState {
  open: boolean;
  via: 'app' | 'api' | 'mcp' | 'unknown';
  since: string;
}

export class FakeFury {
  private server: Server | null = null;
  private _baseUrl = '';
  private version: string;
  private token: string | undefined;
  private authRequired: boolean;
  private readonly profiles = new Map<string, FakeProfile>();
  private readonly open = new Map<string, OpenState>();
  private readonly exits = new Map<string, FakeExit>();
  private latencyMs = 0;
  private readonly failQueue: number[] = [];
  private readonly disabled = new Set<FakeCapability>();
  private readonly recorded: RecordedRequest[] = [];
  private readonly launchCounter = new Map<string, number>();

  /** Tiêm để khởi Chromium thật (feature 007). Mặc định trả endpoint giả. */
  launchHandler: ((profileId: string) => Promise<{ cdpEndpoint: string; sessionRef?: string }>) | null = null;
  stopHandler: ((profileId: string) => Promise<void>) | null = null;

  constructor(opts: FakeFuryOptions = {}) {
    this.version = opts.version ?? '0.2.23';
    this.token = opts.token;
    this.authRequired = opts.authRequired ?? false;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  async start(): Promise<string> {
    if (this.server) return this._baseUrl;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    const addr = server.address() as AddressInfo;
    this._baseUrl = `http://127.0.0.1:${addr.port}`;
    return this._baseUrl;
  }

  async stop(): Promise<void> {
    const s = this.server;
    if (!s) return;
    this.server = null;
    await new Promise<void>((resolve) => {
      s.closeAllConnections();
      s.close(() => resolve());
    });
  }

  // ---- kịch bản ----
  setVersion(v: string): void {
    this.version = v;
  }
  setAuthRequired(on: boolean, token?: string): void {
    this.authRequired = on;
    if (token !== undefined) this.token = token;
  }
  setProfiles(list: FakeProfile[]): void {
    this.profiles.clear();
    for (const p of list) this.profiles.set(p.id, p);
  }
  upsertProfile(p: FakeProfile): void {
    this.profiles.set(p.id, p);
  }
  setOpen(id: string, open: boolean, via: OpenState['via'] = 'app'): void {
    this.open.set(id, { open, via, since: new Date().toISOString() });
  }
  isOpen(id: string): boolean {
    return this.open.get(id)?.open ?? false;
  }
  setExit(id: string, exit: FakeExit): void {
    this.exits.set(id, exit);
  }
  setCapability(cap: FakeCapability, enabled: boolean): void {
    if (enabled) this.disabled.delete(cap);
    else this.disabled.add(cap);
  }
  setLatency(ms: number): void {
    this.latencyMs = ms;
  }
  /** `n` request kế tiếp trả `status` (mặc định 500). */
  failNext(n: number, status = 500): void {
    for (let i = 0; i < n; i++) this.failQueue.push(status);
  }
  requests(): RecordedRequest[] {
    return [...this.recorded];
  }
  clearRequests(): void {
    this.recorded.length = 0;
  }
  launchCount(id: string): number {
    return this.launchCounter.get(id) ?? 0;
  }

  // ---- xử lý HTTP: API thật của Fury 0.3.22 (SPIKE-P2) + một route chỉ dành cho test ----
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    this.recorded.push({ method, path: url.pathname, body, authorization: req.headers.authorization });
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));

    const forced = this.failQueue.shift();
    if (forced !== undefined) return send(res, forced, { error: 'injected_failure', message: 'injected' });

    if (this.authRequired) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${this.token ?? ''}`) return send(res, 401, { error: 'unauthenticated', message: 'Send the token from the api-token file as a bearer token.' });
    }

    const ok = (data: unknown) => send(res, 200, { ok: true, data });
    const failed = (message: string) => send(res, 400, { error: 'failed', message });
    const route = (cap: FakeCapability, fn: () => Promise<void> | void): Promise<void> | void => {
      if (this.disabled.has(cap)) return send(res, 404, { error: 'not_found', message: 'No such endpoint.' });
      return fn();
    };
    const idValue = (body as { id?: unknown } | undefined)?.id;
    const id = typeof idValue === 'string' ? idValue : '';

    if (method === 'GET' && url.pathname === '/v1/status') {
      const running = [...this.open].filter(([, st]) => st.open).map(([k]) => k);
      return route('health', () => ok({ version: this.version, running, core_problem: null }));
    }
    if (method === 'GET' && url.pathname === '/v1/profiles') {
      return route('listProfiles', () => sendRaw(res, 200, `{"ok":true,"data":[${[...this.profiles.values()].map((p) => this.profileJson(p)).join(',')}]}`));
    }
    if (method === 'GET' && url.pathname === '/v1/personas') {
      return route('personas', () => {
        const seen = new Map<string, unknown>();
        for (const p of this.profiles.values()) {
          if (!p.personaId || seen.has(p.personaId)) continue;
          const os = p.persona?.platform ?? p.os;
          seen.set(p.personaId, {
            id: p.personaId,
            os: os ?? null,
            gpu: p.persona?.gpuRenderer ?? null,
            screen: p.persona?.screen ? `${p.persona.screen.width}×${p.persona.screen.height}` : null,
            own: false,
            source: 'derived',
            weight: 0.05,
          });
        }
        return ok([...seen.values()]);
      });
    }
    if (method === 'POST' && url.pathname === '/v1/profiles/start') {
      return route('launch', async () => {
        if (!this.profiles.has(id)) return failed(`no profile ${id}`);
        if (this.open.get(id)?.open) return failed(`profile ${id} is already running`);
        this.launchCounter.set(id, (this.launchCounter.get(id) ?? 0) + 1);
        const result = this.launchHandler
          ? await this.launchHandler(id)
          : { cdpEndpoint: `ws://127.0.0.1:0/devtools/browser/fake-${encodeURIComponent(id)}`, sessionRef: String(40000 + this.launchCount(id)) };
        this.open.set(id, { open: true, via: 'api', since: new Date().toISOString() });
        const cdp = (body as { cdp?: unknown } | undefined)?.cdp === true;
        const pid = Number(result.sessionRef) || 40000;
        return ok(cdp ? { pid, relay_port: 51834, debug_port: 51835, ws_endpoint: result.cdpEndpoint, ws: { puppeteer: result.cdpEndpoint, selenium: result.cdpEndpoint } } : { pid, relay_port: 51834 });
      });
    }
    if (method === 'POST' && url.pathname === '/v1/profiles/stop') {
      return route('stop', async () => {
        if (!this.profiles.has(id)) return failed(`no profile ${id}`);
        if (this.open.get(id)?.open) await this.stopHandler?.(id);
        this.open.set(id, { open: false, via: 'unknown', since: '' });
        return ok({});
      });
    }
    // Chỉ cho test: Fury thật KHÔNG có route này (TODO(SPIKE-P5)); dùng với TEST_ENDPOINT_MAP
    if (method === 'POST' && url.pathname === TEST_CHECK_EXIT_PATH) {
      return route('checkExit', () => {
        if (!this.profiles.has(id)) return failed(`no profile ${id}`);
        return send(res, 200, this.exits.get(id) ?? { error: 'no_exit_scenario' });
      });
    }
    return send(res, 404, { error: 'not_found', message: 'No such endpoint.' });
  }

  /** Hàng profile dạng Fury 0.3.22; `fp_seed` ghi dạng số nguyên thô (u64) như Fury thật. */
  private profileJson(p: FakeProfile): string {
    const row = {
      id: p.id,
      name: p.name,
      tags: p.tags ?? [],
      persona_id: p.personaId ?? null,
      fp_seed: '__SEED__',
      timezone: p.timezone ?? null,
      languages: p.languages ?? null,
      // Fury trả cả đối tượng proxy; ProfileVault phải bỏ thông tin đăng nhập
      proxy: p.proxy ?? null,
      proxy_id: p.proxy?.id ?? null,
      allow_no_proxy: p.proxy === undefined,
      overrides: p.geolocation?.mode === 'manual' && p.geolocation.lat !== undefined && p.geolocation.lon !== undefined ? { geolocation: { latitude: p.geolocation.lat, longitude: p.geolocation.lon } } : {},
      status: '',
      running: this.open.get(p.id)?.open ?? false,
    };
    const seed = p.seed === undefined ? 'null' : /^-?\d+$/.test(p.seed) ? p.seed : JSON.stringify(p.seed);
    return JSON.stringify(row).replace('"__SEED__"', seed);
  }
}

/** Route kiểm exit chỉ có trong FakeFury (Fury thật chưa có — TODO(SPIKE-P5)). */
export const TEST_CHECK_EXIT_PATH = '/v1/test/check-exit';

/** Bộ ánh xạ thật + checkExit trỏ route test, cho test Health/Gateway cần kịch bản exit. */
export const TEST_ENDPOINT_MAP: FuryEndpointMap = {
  ...DEFAULT_ENDPOINT_MAP,
  checkExit: {
    source: 'native',
    method: 'POST',
    path: () => TEST_CHECK_EXIT_PATH,
    body: ({ profileId }) => ({ id: profileId }),
    parse: parseExitInfo,
  },
  meta: { ...DEFAULT_ENDPOINT_MAP.meta, asnType: 'fallback' },
};

function sendRaw(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
