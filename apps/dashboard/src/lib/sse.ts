import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** Khóa cache TanStack Query dùng chung. */
export const qk = {
  overview: ['overview'] as const,
  inbox: ['inbox'] as const,
  system: ['system'] as const,
  fury: ['fury'] as const,
  furyInstall: ['fury', 'install'] as const,
  bindings: ['bindings'] as const,
  binding: (id: string) => ['binding', id] as const,
  readiness: (id: string) => ['readiness', id] as const,
  events: (id: string) => ['events', id] as const,
  pauses: (id: string) => ['pauses', id] as const,
  consistency: (id: string) => ['consistency', id] as const,
  probes: (id: string) => ['probes', id] as const,
  checklist: (id: string) => ['checklist', id] as const,
  proxyChecks: (id: string) => ['proxyChecks', id] as const,
  levelChanges: (id: string) => ['levelChanges', id] as const,
  chart: (id: string, name: string, bucket: string) => ['chart', id, name, bucket] as const,
  jobs: ['jobs'] as const,
  run: (id: string) => ['run', id] as const,
  schedules: ['schedules'] as const,
  matrix: ['matrix'] as const,
};

export const SSE_EVENT_NAMES = ['health.event_recorded', 'binding.level_changed', 'binding.pause_changed', 'run.status_changed', 'run.needs_user', 'fury.status_changed'] as const;

/** Sự kiện SSE → các khóa cần làm mới (FR-003). Hàm thuần để test. */
export function invalidationsFor(name: string, payload: unknown): QueryKey[] {
  const p = (payload ?? {}) as { bindingId?: string; event?: { bindingId?: string | null }; runId?: string };
  const id = p.bindingId ?? p.event?.bindingId ?? null;
  const perBinding = (bid: string | null): QueryKey[] =>
    bid ? [qk.binding(bid), qk.readiness(bid), qk.events(bid), qk.pauses(bid), qk.consistency(bid), qk.levelChanges(bid), qk.proxyChecks(bid), qk.probes(bid), qk.checklist(bid), ['chart', bid]] : [];
  switch (name) {
    case 'health.event_recorded':
      return [qk.overview, qk.inbox, ...perBinding(id)];
    case 'binding.level_changed':
    case 'binding.pause_changed':
      return [qk.overview, qk.inbox, qk.system, qk.bindings, ...perBinding(id)];
    case 'run.status_changed':
    case 'run.needs_user':
      return [qk.jobs, qk.inbox, qk.system, ...(p.runId ? [qk.run(p.runId) as QueryKey] : []), ...(id ? [qk.events(id) as QueryKey] : [])];
    case 'fury.status_changed':
      return [qk.fury, qk.system, qk.overview, qk.inbox];
    default:
      return [];
  }
}

export type SseStatus = 'connecting' | 'open' | 'lost';

/** Nối `/internal/stream`; EventSource tự nối lại (server gửi `retry: 3000`). */
export function connectSse(client: QueryClient, onStatus: (s: SseStatus) => void, factory: (url: string) => EventSource = (u) => new EventSource(u)): () => void {
  const es = factory('/internal/stream');
  onStatus('connecting');
  es.onopen = () => onStatus('open');
  es.onerror = () => onStatus('lost');
  for (const name of SSE_EVENT_NAMES) {
    es.addEventListener(name, (ev) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse((ev as MessageEvent<string>).data);
      } catch {
        /* bỏ qua */
      }
      for (const key of invalidationsFor(name, payload)) void client.invalidateQueries({ queryKey: key });
    });
  }
  return () => es.close();
}
