import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { PvError, type SessionInfo } from '@sctech/profilevault-contract';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { GatewayDeps } from './deps.js';
import { registerCoreRoutes } from './routes/core.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerOpsRoutes } from './routes/ops.js';
import { assertLoopback, hostAllowed, isWriteMethod, mapError, originAllowed } from './security.js';
import { CSRF_HEADER, OpenCodeStore, SESSION_COOKIE, SessionStore, type Session } from './session.js';
import { registerSse } from './sse.js';

export interface Gateway {
  app: FastifyInstance;
  /** Bind loopback; trả URL gốc `http://127.0.0.1:<port>`. */
  listen(): Promise<string>;
  close(): Promise<void>;
  /** URL mở dashboard một lần cho tray (SPEC-05 §4.1). */
  createOpenUrl(next?: string): string;
  port(): number;
  sessions: SessionStore;
  openCodes: OpenCodeStore;
  sseConnections(): number;
}

const MINIMAL_HTML = (title: string, body: string) =>
  `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:Segoe UI,sans-serif;max-width:40rem;margin:4rem auto"><h1>${title}</h1><p>${body}</p></body></html>`;

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
    denyReason?: string;
  }
}

export async function createGateway(deps: GatewayDeps): Promise<Gateway> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024, trustProxy: false, disableRequestLogging: true });
  const random = deps.random;
  const openCodes = new OpenCodeStore(deps.clock, random);
  const sessions = new SessionStore(deps.clock, random);
  let actualPort = deps.config.gateway.port;
  const portOf = () => actualPort;

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  // ---- SPEC-05 §2: Host, Origin, không CORS ----
  app.addHook('onRequest', async (req, reply) => {
    if (!hostAllowed(req.headers.host, portOf())) {
      req.denyReason = 'host';
      return reply.code(403).send({ error: { code: 'UNAUTHORIZED', message: 'Host không hợp lệ', detail: { reason: 'host' } } });
    }
    if (!originAllowed(req.headers.origin, portOf())) {
      req.denyReason = 'origin';
      return reply.code(403).send({ error: { code: 'FORBIDDEN_SCOPE', message: 'Origin không hợp lệ', detail: { reason: 'origin' } } });
    }
  });

  // ---- SPEC-05 §4.1: phiên dashboard ----
  app.get('/auth/open', async (req, reply) => {
    const { code, next } = req.query as { code?: string; next?: string };
    if (!openCodes.consume(code)) {
      req.denyReason = 'open_code';
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Mã mở dashboard không hợp lệ hoặc đã hết hạn. Mở lại từ biểu tượng tray.' } });
    }
    const s = sessions.create();
    deps.audit.append({ actorType: 'user', action: 'dashboard.login' });
    reply.setCookie(SESSION_COOKIE, s.id, { httpOnly: true, sameSite: 'strict', path: '/', secure: false });
    // chỉ đường dẫn nội bộ (chống open redirect)
    const target = typeof next === 'string' && /^\/(?!\/)[\w\-/?=&%.]*$/.test(next) ? next : '/';
    return reply.redirect(target, 302);
  });
  app.post('/auth/logout', async (req, reply) => {
    const id = req.cookies[SESSION_COOKIE];
    if (id) sessions.destroy(id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/internal')) return;
    const s = sessions.touch(req.cookies[SESSION_COOKIE]);
    if (!s) {
      req.denyReason = 'session';
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Chưa có phiên dashboard. Mở dashboard từ biểu tượng tray.' , detail: { reason: 'session' } } });
    }
    if (isWriteMethod(req.method) && !sessions.csrfValid(s, req.headers[CSRF_HEADER] as string | undefined)) {
      req.denyReason = 'csrf';
      return reply.code(403).send({ error: { code: 'FORBIDDEN_SCOPE', message: 'Thiếu hoặc sai X-PV-CSRF', detail: { reason: 'csrf' } } });
    }
    req.session = s;
  });

  app.get('/internal/session', async (req): Promise<SessionInfo> => ({ csrfToken: req.session!.csrfToken, expiresAt: new Date(req.session!.expiresAt).toISOString() }));

  // ---- lỗi (SPEC-05 §10) ----
  app.setErrorHandler((err, req, reply) => {
    const { status, body } = mapError(err);
    if (status >= 500) deps.logger.error('lỗi gateway', { url: req.url, err: err instanceof Error ? err.message : String(err) });
    void reply.code(status).send(body);
  });

  // ---- audit (SPEC-05 §9) ----
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url;
    if (reply.statusCode === 401 || reply.statusCode === 403) {
      deps.audit.append({ actorType: 'user', action: 'http.denied', detail: { method: req.method, route, status: reply.statusCode, reason: req.denyReason ?? 'unknown' } });
      return;
    }
    if (isWriteMethod(req.method) && req.url.startsWith('/internal')) {
      const params = (req.params ?? {}) as Record<string, string>;
      deps.audit.append({ actorType: 'user', action: 'http.write', detail: { method: req.method, route, status: reply.statusCode, params } });
    }
  });

  // ---- route ----
  registerCoreRoutes(app, deps);
  registerOpsRoutes(app, deps);
  registerDashboardRoutes(app, deps);
  const sse = registerSse(app, deps);

  // ---- SPA / trang tối thiểu (SPEC-05 §3) ----
  const staticDir = deps.staticDir && existsSync(path.join(deps.staticDir, 'index.html')) ? deps.staticDir : undefined;
  if (staticDir) await app.register(fastifyStatic, { root: staticDir, prefix: '/', wildcard: false, index: false, decorateReply: true });
  const serveIndex = (req: FastifyRequest, reply: FastifyReply) => {
    if (!sessions.touch(req.cookies[SESSION_COOKIE])) {
      req.denyReason = 'session';
      return reply.code(401).type('text/html; charset=utf-8').send(MINIMAL_HTML('ProfileVault', 'Chưa có phiên dashboard. Mở dashboard từ biểu tượng ProfileVault trên khay hệ thống (tray).'));
    }
    if (staticDir) return reply.sendFile('index.html');
    return reply.type('text/html; charset=utf-8').send(MINIMAL_HTML('ProfileVault', 'Dashboard chưa được build (feature 006). API nội bộ đang chạy tại /internal.'));
  };
  app.get('/', serveIndex);
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/internal') && !req.url.startsWith('/auth') && !req.url.startsWith('/api') && !req.url.startsWith('/mcp')) return serveIndex(req, reply);
    return reply.code(404).send({ error: { code: 'FLOW_NOT_FOUND', message: 'Không có đường dẫn này' } });
  });

  await app.ready();

  return {
    app,
    sessions,
    openCodes,
    sseConnections: sse.connections,
    port: portOf,
    async listen() {
      assertLoopback(deps.config.gateway.host);
      await app.listen({ host: deps.config.gateway.host, port: deps.config.gateway.port });
      const addr = app.server.address();
      if (addr && typeof addr === 'object') actualPort = addr.port;
      const url = `http://127.0.0.1:${actualPort}`;
      deps.logger.info('gateway đang nghe', { url });
      return url;
    },
    async close() {
      await app.close();
    },
    createOpenUrl(next?: string) {
      const n = next ? `&next=${encodeURIComponent(next)}` : '';
      return `http://127.0.0.1:${actualPort}/auth/open?code=${openCodes.create()}${n}`;
    },
  };
}

export { PvError };
