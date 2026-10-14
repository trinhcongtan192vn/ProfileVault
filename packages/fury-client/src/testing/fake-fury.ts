/**
 * FakeFury — HTTP server giả lập automation API Fury cho test (SPEC-09 §3.1).
 * Cài ĐÚNG bộ ánh xạ giả định ở src/adapter/endpoint-map.ts. TODO(SPIKE-P2): cập nhật cùng endpoint-map sau spike.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

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

export type FakeCapability = 'health' | 'listProfiles' | 'getProfile' | 'getStatus' | 'launch' | 'stop' | 'checkExit';

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

  // ---- xử lý HTTP (bộ ánh xạ giả định — TODO(SPIKE-P2)) ----
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';
    this.recorded.push({ method, path: url.pathname, body, authorization: req.headers.authorization });
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));

    const forced = this.failQueue.shift();
    if (forced !== undefined) return send(res, forced, { error: 'injected_failure' });

    if (this.authRequired) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${this.token ?? ''}`) return send(res, 401, { error: 'unauthorized' });
    }

    const route = (cap: FakeCapability, fn: (id: string) => Promise<void> | void, id = ''): Promise<void> | void => {
      if (this.disabled.has(cap)) return send(res, 404, { error: 'not_found' });
      return fn(id);
    };

    if (method === 'GET' && url.pathname === '/api/status') {
      return route('health', () => send(res, 200, { ok: true, version: this.version }));
    }
    if (method === 'GET' && url.pathname === '/api/profiles') {
      return route('listProfiles', () =>
        send(
          res,
          200,
          [...this.profiles.values()].map((p) => ({ id: p.id, name: p.name, tags: p.tags ?? [], personaId: p.personaId, os: p.os })),
        ),
      );
    }
    const m = /^\/api\/profiles\/([^/]+)(?:\/(status|launch|stop|check-exit))?$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1] ?? '');
      const action = m[2];
      const profile = this.profiles.get(id);
      if (!action && method === 'GET') {
        return route('getProfile', () => {
          if (!profile) return send(res, 404, { error: 'profile_not_found' });
          return send(res, 200, { ...profile, webrtc: profile.webrtc, proxy: profile.proxy });
        });
      }
      if (action === 'status' && method === 'GET') {
        return route('getStatus', () => {
          if (!profile) return send(res, 404, { error: 'profile_not_found' });
          const st = this.open.get(id) ?? { open: false, via: 'unknown' as const, since: '' };
          return send(res, 200, { open: st.open, via: st.via, since: st.open ? st.since : undefined });
        });
      }
      if (action === 'launch' && method === 'POST') {
        return route('launch', async () => {
          if (!profile) return send(res, 404, { error: 'profile_not_found' });
          if (this.open.get(id)?.open) return send(res, 409, { error: 'profile_open' });
          this.launchCounter.set(id, (this.launchCounter.get(id) ?? 0) + 1);
          const result = this.launchHandler
            ? await this.launchHandler(id)
            : { cdpEndpoint: `ws://127.0.0.1:0/fake/${encodeURIComponent(id)}`, sessionRef: `fake-${id}-${Date.now()}` };
          this.open.set(id, { open: true, via: 'api', since: new Date().toISOString() });
          return send(res, 200, result);
        });
      }
      if (action === 'stop' && method === 'POST') {
        return route('stop', async () => {
          if (!profile) return send(res, 404, { error: 'profile_not_found' });
          if (this.open.get(id)?.open) await this.stopHandler?.(id);
          this.open.set(id, { open: false, via: 'unknown', since: '' });
          return send(res, 204, undefined);
        });
      }
      if (action === 'check-exit' && method === 'POST') {
        return route('checkExit', () => {
          if (!profile) return send(res, 404, { error: 'profile_not_found' });
          const exit = this.exits.get(id) ?? { error: 'no_exit_scenario' };
          return send(res, 200, exit);
        });
      }
    }
    return send(res, 404, { error: 'not_found' });
  }
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
