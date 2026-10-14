import type { BusEventName } from '@sctech/profilevault-contract';
import type { FastifyInstance } from 'fastify';
import type { GatewayDeps } from './deps.js';
import { realTimers } from '@sctech/profilevault-fury-client';

export const SSE_EVENTS: readonly BusEventName[] = ['health.event_recorded', 'binding.level_changed', 'binding.pause_changed', 'run.status_changed', 'run.needs_user', 'fury.status_changed'];
export const SSE_HEARTBEAT_MS = 15_000;

/** `GET /internal/stream` — Server-Sent Events (SPEC-05 §3, SPEC-00 §10). */
export function registerSse(app: FastifyInstance, deps: GatewayDeps): { connections: () => number } {
  let open = 0;
  const timers = deps.timers ?? realTimers;
  app.get('/internal/stream', (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 3000\n\n');
    open++;
    const unsubs = SSE_EVENTS.map((name) =>
      deps.bus.on(name, (payload) => {
        raw.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
      }),
    );
    const stopHeartbeat = timers.setInterval(() => raw.write(': heartbeat\n\n'), SSE_HEARTBEAT_MS);
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      open--;
      for (const u of unsubs) u();
      stopHeartbeat();
    };
    req.raw.once('close', cleanup);
    raw.once('close', cleanup);
  });
  return { connections: () => open };
}
