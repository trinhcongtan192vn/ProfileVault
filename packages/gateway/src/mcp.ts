import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  BindingIdSchema,
  CONTRACT_VERSION,
  CreateBindingInputSchema,
  FlowIdSchema,
  JobIdSchema,
  JobStatusSchema,
  ManualEventTypeSchema,
  PlatformSchema,
  PvError,
  type Client,
  type ClientScope,
  type JobStatus,
} from '@sctech/profilevault-contract';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { GatewayDeps } from './deps.js';
import { buildOverview } from './overview.js';
import { asJobClient } from './routes/api-v1.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err: unknown): ToolResult => {
  const e = err instanceof PvError ? err : new PvError('INTERNAL', 'Lỗi nội bộ');
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: e.code, message: e.message, detail: e.detail ?? null }) }] };
};
const TERMINAL: ReadonlySet<JobStatus> = new Set(['done', 'failed', 'cancelled', 'rejected']);

/**
 * MCP Streamable HTTP tại `/mcp` (SPEC-05 §6). Không trạng thái: mỗi request một server; danh sách tool chỉ gồm
 * tool mà scope của token cho phép. Không có tool cho hành động chỉ dành cho người (§5.2).
 */
export function buildMcpServer(deps: GatewayDeps, client: Client): McpServer {
  const server = new McpServer({ name: 'profilevault', version: deps.serviceVersion ?? '0.1.0' }, { instructions: `ProfileVault ${CONTRACT_VERSION}. Lên mức, gỡ dừng, xác nhận checklist, trả lời gate L2 chỉ làm trên dashboard.` });
  const has = (s: ClientScope) => client.scopes.includes(s);
  const jc = asJobClient(client);
  const jobs = () => {
    if (!deps.jobs) throw new PvError('FLOW_DISABLED', 'Job service chưa sẵn sàng');
    return deps.jobs;
  };
  const allowedBinding = (id: string) => {
    if (!client.bindingFilter.includes('*') && !client.bindingFilter.includes(id)) throw new PvError('FORBIDDEN_SCOPE', 'Binding ngoài bộ lọc của client', { bindingId: id });
    if (!deps.health.getBinding(id)) throw new PvError('ACCOUNT_NOT_BOUND', 'Không có binding', { bindingId: id });
  };
  const audit = (tool: string, detail: Record<string, unknown> = {}) => deps.audit.append({ actorType: 'client', actorId: client.id, action: 'mcp.tool', detail: { tool, ...detail } });
  const run = async (fn: () => unknown): Promise<ToolResult> => {
    try {
      return ok(await fn());
    } catch (err) {
      return fail(err);
    }
  };

  if (has('accounts.read')) {
    server.registerTool('pv_accounts_list', { description: 'Tài khoản đã gắn (mức, dừng, flow gửi được ở mức hiện tại).', inputSchema: { platform: PlatformSchema.optional() } }, ({ platform }) => run(() => ({ accounts: jobs().accounts(jc, platform) })));
  }
  if (has('jobs.read')) {
    server.registerTool('pv_flows_list', { description: 'Flow được phép, kèm JSON Schema input/output.', inputSchema: {} }, () => run(() => ({ flows: jobs().flows(jc) })));
    server.registerTool('pv_jobs_get', { description: 'Trạng thái một job của client.', inputSchema: { jobId: JobIdSchema } }, ({ jobId }) => run(() => jobs().get(jobId, jc)));
    server.registerTool(
      'pv_jobs_list',
      { description: 'Job của client, mới nhất trước.', inputSchema: { status: JobStatusSchema.optional(), flowId: FlowIdSchema.optional(), accountId: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().optional() } },
      (q) => run(() => jobs().list(jc, q)),
    );
    server.registerTool(
      'pv_jobs_wait',
      { description: 'Chờ job đổi trạng thái hoặc hết timeoutSeconds (≤ 50). Gửi notifications/progress nếu có progressToken.', inputSchema: { jobId: JobIdSchema, timeoutSeconds: z.number().int().min(1).max(50).default(30) } },
      async ({ jobId, timeoutSeconds }, extra) =>
        run(async () => {
          const start = jobs().get(jobId, jc);
          if (TERMINAL.has(start.status)) return start;
          const token = extra._meta?.progressToken;
          let progress = 0;
          const result = await new Promise<string>((resolve) => {
            const timer = setTimeout(() => done('timeout'), timeoutSeconds * 1000);
            const off = deps.bus.on('run.status_changed', (e) => {
              if (e.jobId !== jobId) return;
              if (token !== undefined) void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++progress, message: `${e.status}${e.step ? ` · ${e.step}` : ''}` } }).catch(() => undefined);
              if (e.status !== start.status) done('changed');
            });
            extra.signal.addEventListener('abort', () => done('aborted'));
            function done(why: string) {
              clearTimeout(timer);
              off();
              resolve(why);
            }
          });
          return { ...jobs().get(jobId, jc), waited: result };
        }),
    );
  }
  if (has('jobs.write')) {
    server.registerTool(
      'pv_jobs_submit',
      {
        description: 'Gửi job (profilevault/v1). idempotencyKey ổn định cho cùng nội dung; trùng → trả job cũ.',
        inputSchema: {
          flowId: FlowIdSchema,
          account: z.object({ platform: PlatformSchema, accountId: z.string().min(1) }).optional(),
          bindingId: BindingIdSchema.optional(),
          idempotencyKey: z.string().min(1).max(200),
          input: z.record(z.string(), z.unknown()).default({}),
          source: z.object({ app: z.string(), ref: z.string().optional() }).optional(),
        },
      },
      (args) =>
        run(async () => {
          const r = await jobs().submit(args, jc);
          audit('pv_jobs_submit', { jobId: r.job.id, duplicate: r.duplicate });
          return { ...r.job, duplicate: r.duplicate };
        }),
    );
    server.registerTool('pv_jobs_cancel', { description: 'Hủy job của client.', inputSchema: { jobId: JobIdSchema } }, ({ jobId }) =>
      run(async () => {
        const j = await jobs().cancel(jobId, jc);
        audit('pv_jobs_cancel', { jobId });
        return j;
      }),
    );
  }
  if (has('ops.read')) {
    server.registerTool('pv_readiness_overview', { description: 'Bảng tổng quan dashboard: mức, tiến độ, còn thiếu, dừng, cờ đỏ, điểm nhất quán, exit.', inputSchema: {} }, () =>
      run(async () => {
        const o = await buildOverview(deps);
        return {
          ...o,
          rows: o.rows
            .filter((r) => client.bindingFilter.includes('*') || client.bindingFilter.includes(r.binding.id))
            .map((r) => ({ bindingId: r.binding.id, platform: r.binding.platform, accountId: r.binding.accountId, displayName: r.binding.displayName, level: r.binding.level, daysAtLevel: r.daysAtLevel, readiness: r.readiness, openPauses: r.openPauses, lastRed: r.lastRed, consistency: r.consistency, exit: r.exit && { country: r.exit.country, asn: r.exit.asn, checkedAt: r.exit.checkedAt } })),
          dashboard: '/',
        };
      }),
    );
    server.registerTool('pv_binding_detail', { description: 'Chi tiết kênh: mức, điều kiện lên mức, dừng đang mở, sự kiện gần đây.', inputSchema: { bindingId: BindingIdSchema } }, ({ bindingId }) =>
      run(async () => {
        allowedBinding(bindingId);
        return {
          binding: deps.health.getBinding(bindingId),
          readiness: await deps.health.evaluateReadiness(bindingId),
          openPauses: deps.health.listPauses(bindingId, { open: true }),
          recentEvents: deps.health.listEvents(bindingId, { limit: 20, order: 'desc' }),
          consistency: deps.health.getConsistency(bindingId)?.score ?? null,
          dashboard: `/bindings/${bindingId}`,
        };
      }),
    );
    server.registerTool('pv_consistency_report', { description: 'Kết quả kiểm tra nhất quán gần nhất (luật, trạng thái, gợi ý).', inputSchema: { bindingId: BindingIdSchema } }, ({ bindingId }) =>
      run(() => {
        allowedBinding(bindingId);
        return deps.health.getConsistency(bindingId) ?? null;
      }),
    );
    server.registerTool(
      'pv_events_list',
      { description: 'Sự kiện sức khỏe theo binding/khoảng thời gian.', inputSchema: { bindingId: BindingIdSchema, since: z.string().optional(), until: z.string().optional(), types: z.array(z.string()).optional(), limit: z.number().int().min(1).max(500).default(100) } },
      ({ bindingId, ...f }) =>
        run(() => {
          allowedBinding(bindingId);
          return { events: deps.health.listEvents(bindingId, { ...f, order: 'desc' }) };
        }),
    );
  }
  if (has('ops.write')) {
    server.registerTool('pv_binding_create', { description: 'Gắn kênh mới ở L0 (profile Fury đã tạo và người đã đăng nhập).', inputSchema: CreateBindingInputSchema.shape }, (input) =>
      run(async () => {
        const b = await deps.health.createBinding(CreateBindingInputSchema.parse(input), 'client');
        audit('pv_binding_create', { bindingId: b.id });
        return { ...b, dashboard: `/bindings/${b.id}` };
      }),
    );
    server.registerTool(
      'pv_event_record',
      { description: 'Ghi sự kiện tay. Sự kiện đỏ (xác minh, CAPTCHA, cảnh báo, đăng xuất) hạ kênh về L0 — hỏi lại người trước khi ghi.', inputSchema: { bindingId: BindingIdSchema, type: ManualEventTypeSchema, occurredAt: z.string().optional(), note: z.string().max(1000).optional() } },
      ({ bindingId, type, occurredAt, note }) =>
        run(async () => {
          allowedBinding(bindingId);
          const ev = await deps.health.recordManualEvent(bindingId, type, occurredAt, note, `client:${client.id}`);
          audit('pv_event_record', { bindingId, type });
          return ev;
        }),
    );
    server.registerTool('pv_probe_import', { description: 'Nhập file probe (.json) người xuất từ trang probe của Fury.', inputSchema: { bindingId: BindingIdSchema, filePath: z.string().regex(/\.json$/i, 'Chỉ nhận file .json') } }, ({ bindingId, filePath }) =>
      run(async () => {
        allowedBinding(bindingId);
        const p = await deps.health.importProbe(bindingId, { filePath }, 'manual_import', 'client');
        audit('pv_probe_import', { bindingId, probeId: p.id });
        return { id: p.id, furyVersion: p.furyVersion, capturedAt: p.capturedAt };
      }),
    );
    server.registerTool('pv_consistency_run', { description: 'Chạy lại kiểm tra nhất quán (một binding hoặc tất cả trong bộ lọc).', inputSchema: { bindingId: BindingIdSchema.optional() } }, ({ bindingId }) =>
      run(async () => {
        if (bindingId) allowedBinding(bindingId);
        else if (!client.bindingFilter.includes('*')) throw new PvError('FORBIDDEN_SCOPE', 'Client có bộ lọc binding phải chỉ rõ bindingId');
        const r = await deps.health.runConsistency(bindingId ? { bindingId } : {}, 'manual', 'client');
        audit('pv_consistency_run', { bindingId: bindingId ?? '*' });
        return r;
      }),
    );
  }
  return server;
}

/** Xử lý một request `/mcp` (POST/GET/DELETE) ở chế độ không trạng thái. */
export async function handleMcp(deps: GatewayDeps, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = buildMcpServer(deps, req.client!);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: false });
  reply.hijack();
  reply.raw.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
}
