import { useAction } from '../components/ui';
import type { Client, ClientScope, FuryStatus, RuleConfig, RunnerSettings, Thresholds } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Section } from '../components/bits';
import { Empty, Loading, Modal, useUi } from '../components/ui';
import { errorMessage, get, patch, post, put } from '../lib/api';
import { formatDateTime, fromLocalInput } from '../lib/format';
import { LAYER_LABELS, SCOPE_LABELS, SEVERITY_LABELS, label } from '../lib/labels';
import { qk } from '../lib/sse';

const SECTIONS = [
  { id: 'fury', label: 'Kết nối Fury' },
  { id: 'thresholds', label: 'Ngưỡng' },
  { id: 'rules', label: 'Luật nhất quán' },
  { id: 'detect', label: 'Detect-suite' },
  { id: 'asn', label: 'ASN' },
  { id: 'runner', label: 'Runner' },
  { id: 'clients', label: 'Ứng dụng kết nối' },
  { id: 'export', label: 'Xuất dữ liệu' },
] as const;

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const active = params.get('section') ?? 'fury';
  return (
    <div className="settings">
      <aside>
        <h1>Cài đặt</h1>
        {SECTIONS.map((s) => (
          <button key={s.id} className={s.id === active ? 'side active' : 'side'} onClick={() => setParams({ section: s.id })}>
            {s.label}
          </button>
        ))}
      </aside>
      <div className="settings-body">
        {active === 'fury' && <FurySection />}
        {active === 'thresholds' && <ThresholdsSection />}
        {active === 'rules' && <RulesSection />}
        {active === 'detect' && <DetectSection />}
        {active === 'asn' && <AsnSection />}
        {active === 'runner' && <RunnerSection />}
        {active === 'clients' && <ClientsSection />}
        {active === 'export' && <ExportSection />}
      </div>
    </div>
  );
}

function useSave<T>(fn: (v: T) => Promise<unknown>, keys: readonly (readonly unknown[])[], ok: string) {
  const qc = useQueryClient();
  const { toast } = useUi();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(ok);
      for (const k of keys) void qc.invalidateQueries({ queryKey: [...k] });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error', ttlMs: 8000 }),
  });
}

function FurySection() {
  const q = useQuery({ queryKey: qk.fury, queryFn: () => get<FuryStatus>('/internal/fury') });
  const [token, setToken] = useState('');
  const save = useSave((t: string) => put('/internal/fury/token', { token: t }), [qk.fury, qk.system], 'Đã lưu token Fury (mã hóa DPAPI)');
  if (!q.data) return <Loading />;
  const f = q.data;
  return (
    <Section title="Kết nối Fury">
      <ul>
        <li>
          Địa chỉ automation API: <code>{f.apiBaseUrl}</code> (sửa trong config.json)
        </li>
        <li>
          Trạng thái: {f.health?.reachable ? `online, phiên bản ${f.health.version ?? '?'}` : `offline${f.health?.error ? ` (${f.health.error})` : ''}`}
          {f.health && f.health.reachable && !f.health.supported && <strong className="red"> — ngoài khoảng hỗ trợ {f.supportedVersions}, mọi lệnh mở profile bị chặn</strong>}
        </li>
        <li>Khoảng phiên bản hỗ trợ: {f.supportedVersions}</li>
        <li>Phiên bản ghi nhận: {f.currentVersion ?? '—'}</li>
        <li>Token: {f.hasToken ? 'đã lưu' : 'chưa có'}</li>
      </ul>
      <div className="form-row">
        <input type="password" autoComplete="off" placeholder="Token automation API của Fury" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="primary" disabled={!token} onClick={() => save.mutate(token, { onSuccess: () => setToken('') })}>
          Lưu token
        </button>
      </div>
      <h4>Năng lực</h4>
      {f.capabilities ? (
        <table className="table">
          <tbody>
            {Object.entries(f.capabilities).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className={v === 'missing' ? 'red' : v === 'fallback' ? 'yellow' : 'green'}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>Không đọc được.</Empty>
      )}
    </Section>
  );
}

function ThresholdsSection() {
  const q = useQuery({ queryKey: ['settings', 'thresholds'], queryFn: () => get<{ thresholds: Thresholds; history: { createdAt: string; actor: string }[] }>('/internal/settings/thresholds') });
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setText(JSON.stringify(q.data.thresholds, null, 2));
  }, [q.data]);
  const save = useSave((t: Thresholds) => put('/internal/settings/thresholds', t), [['settings', 'thresholds'], qk.overview], 'Đã lưu ngưỡng');
  if (!q.data) return <Loading />;
  return (
    <Section title="Ngưỡng lên mức (SPEC-02 §3.3)">
      <p className="muted">Mỗi chuyển tiếp là danh sách điều kiện. Mọi thay đổi được ghi lịch sử.</p>
      <textarea className="mono code-edit" rows={24} value={text} onChange={(e) => setText(e.target.value)} />
      {err && <p className="error">{err}</p>}
      <div className="actions">
        <button
          className="primary"
          onClick={() => {
            try {
              setErr(null);
              save.mutate(JSON.parse(text) as Thresholds);
            } catch (e) {
              setErr(`JSON không hợp lệ: ${(e as Error).message}`);
            }
          }}
        >
          Lưu
        </button>
      </div>
      <h4>Lịch sử</h4>
      <ul>
        {q.data.history.map((h, i) => (
          <li key={i}>
            {formatDateTime(h.createdAt)} — {h.actor}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RulesSection() {
  const q = useQuery({ queryKey: ['rules'], queryFn: () => get<{ rules: RuleConfig[] }>('/internal/rules') });
  const save = useSave((v: { id: string; body: Partial<RuleConfig> }) => patch(`/internal/rules/${v.id}`, v.body), [['rules'], qk.overview], 'Đã lưu luật; lần kiểm kế tiếp áp dụng');
  if (!q.data) return <Loading />;
  return (
    <Section title="Luật nhất quán (SPEC-02 §6.4)">
      <table className="table">
        <thead>
          <tr>
            <th>Luật</th>
            <th>Lớp</th>
            <th>Bật</th>
            <th>Mức</th>
            <th>Tham số</th>
          </tr>
        </thead>
        <tbody>
          {q.data.rules.map((r) => (
            <tr key={r.id}>
              <td>
                <code>{r.id}</code>
              </td>
              <td>{label(LAYER_LABELS, r.layer)}</td>
              <td>
                <input type="checkbox" checked={r.enabled} onChange={(e) => save.mutate({ id: r.id, body: { enabled: e.target.checked } })} />
              </td>
              <td>
                <select value={r.severity} onChange={(e) => save.mutate({ id: r.id, body: { severity: e.target.value as RuleConfig['severity'] } })}>
                  {['block', 'warn', 'info'].map((s) => (
                    <option key={s} value={s}>
                      {label(SEVERITY_LABELS, s)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {Object.keys(r.params).length > 0 ? (
                  <input
                    className="mono"
                    defaultValue={JSON.stringify(r.params)}
                    onBlur={(e) => {
                      try {
                        const p = JSON.parse(e.target.value) as Record<string, unknown>;
                        if (JSON.stringify(p) !== JSON.stringify(r.params)) save.mutate({ id: r.id, body: { params: p } });
                      } catch {
                        e.target.value = JSON.stringify(r.params);
                      }
                    }}
                  />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function DetectSection() {
  const fury = useQuery({ queryKey: qk.fury, queryFn: () => get<FuryStatus>('/internal/fury') });
  const [form, setForm] = useState({ furyVersion: '', bindingId: '', passed: true, summary: '' });
  useEffect(() => {
    if (fury.data?.currentVersion) setForm((f) => (f.furyVersion ? f : { ...f, furyVersion: fury.data.currentVersion ?? '' }));
  }, [fury.data]);
  const save = useSave(() => post('/internal/detect-suite', { furyVersion: form.furyVersion, bindingId: form.bindingId || undefined, passed: form.passed, summary: form.summary || undefined }), [qk.overview, qk.inbox], 'Đã ghi kết quả detect-suite');
  return (
    <Section title="Nhập kết quả fury-detect gate">
      <div className="form-grid">
        <label className="field">
          Phiên bản Fury
          <input value={form.furyVersion} onChange={(e) => setForm({ ...form, furyVersion: e.target.value })} />
        </label>
        <label className="field">
          Binding (để trống = mọi profile)
          <input value={form.bindingId} placeholder="ab_…" onChange={(e) => setForm({ ...form, bindingId: e.target.value.trim() })} />
        </label>
        <label className="field">
          Kết quả
          <select value={String(form.passed)} onChange={(e) => setForm({ ...form, passed: e.target.value === 'true' })}>
            <option value="true">Đạt (xanh)</option>
            <option value="false">Trượt (đỏ) — dừng job mọi binding liên quan</option>
          </select>
        </label>
        <label className="field">
          Tóm tắt
          <textarea rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        </label>
      </div>
      <button className="primary" disabled={!form.furyVersion} onClick={() => save.mutate(undefined)}>
        Ghi
      </button>
    </Section>
  );
}

function AsnSection() {
  const q = useQuery({ queryKey: ['asn'], queryFn: () => get<{ attestations: { asn: number; asnType: string; note: string | null; createdAt: string }[] }>('/internal/asn-attestations') });
  const [form, setForm] = useState({ asn: '', asnType: 'isp', note: '' });
  const save = useSave(() => post('/internal/asn-attestations', { asn: Number(form.asn), asnType: form.asnType, note: form.note || undefined }), [['asn'], qk.inbox, qk.overview], 'Đã xác nhận loại ASN; đã kiểm lại các kênh liên quan');
  return (
    <Section title="Xác nhận loại ASN">
      <div className="form-row">
        <input placeholder="Số ASN" value={form.asn} onChange={(e) => setForm({ ...form, asn: e.target.value.replace(/\D/g, '') })} />
        <select value={form.asnType} onChange={(e) => setForm({ ...form, asnType: e.target.value })}>
          {['isp', 'residential', 'mobile', 'hosting'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input placeholder="Ghi chú" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button className="primary" disabled={!form.asn} onClick={() => save.mutate(undefined)}>
          Lưu
        </button>
      </div>
      {(q.data?.attestations ?? []).length === 0 ? (
        <Empty>Chưa có ASN nào được xác nhận.</Empty>
      ) : (
        <table className="table">
          <tbody>
            {q.data!.attestations.map((a) => (
              <tr key={a.asn}>
                <td>AS{a.asn}</td>
                <td>{a.asnType}</td>
                <td>{a.note ?? ''}</td>
                <td>{formatDateTime(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function RunnerSection() {
  const q = useQuery({ queryKey: ['settings', 'runner'], queryFn: () => get<{ runner: RunnerSettings }>('/internal/settings/runner') });
  const [v, setV] = useState<RunnerSettings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data.runner);
  }, [q.data]);
  const save = useSave((r: RunnerSettings) => put('/internal/settings/runner', r), [['settings', 'runner']], 'Đã lưu cài đặt Runner');
  if (!v) return <Loading />;
  const num = (k: keyof RunnerSettings, text: string) => (
    <label className="field" key={k}>
      {text}
      <input type="number" min={0} value={(v[k] as number | undefined) ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} />
    </label>
  );
  return (
    <Section title="Runner">
      <div className="form-grid">
        {num('maxConcurrentIdle', 'Đồng thời tối đa khi máy rảnh')}
        {num('maxConcurrentBusy', 'Đồng thời tối đa khi máy bận')}
        {num('ramPerProfileMb', 'RAM mỗi profile (MB)')}
        {num('profileBusyTimeoutMinutes', 'Chờ profile rảnh tối đa (phút)')}
        {num('humanGateTimeoutHours', 'Chờ người tối đa (giờ)')}
        {num('uploadsPerAccountPerDay', 'Upload tối đa mỗi kênh mỗi ngày')}
        <label className="field">
          Độ trễ thao tác (ms, min–max)
          <span className="form-row">
            <input type="number" value={v.humanize.actionDelayMs[0]} onChange={(e) => setV({ ...v, humanize: { ...v.humanize, actionDelayMs: [Number(e.target.value), v.humanize.actionDelayMs[1]] } })} />
            <input type="number" value={v.humanize.actionDelayMs[1]} onChange={(e) => setV({ ...v, humanize: { ...v.humanize, actionDelayMs: [v.humanize.actionDelayMs[0], Number(e.target.value)] } })} />
          </span>
        </label>
        <label className="field">
          Độ trễ gõ phím (ms, min–max)
          <span className="form-row">
            <input type="number" value={v.humanize.typingDelayMs[0]} onChange={(e) => setV({ ...v, humanize: { ...v.humanize, typingDelayMs: [Number(e.target.value), v.humanize.typingDelayMs[1]] } })} />
            <input type="number" value={v.humanize.typingDelayMs[1]} onChange={(e) => setV({ ...v, humanize: { ...v.humanize, typingDelayMs: [v.humanize.typingDelayMs[0], Number(e.target.value)] } })} />
          </span>
        </label>
        <label>
          <input type="checkbox" checked={v.traceAlways} onChange={(e) => setV({ ...v, traceAlways: e.target.checked })} /> Luôn lưu trace (kể cả khi không lỗi)
        </label>
      </div>
      <button className="primary" onClick={() => save.mutate(v)}>
        Lưu
      </button>
    </Section>
  );
}

const SCOPES: ClientScope[] = ['accounts.read', 'jobs.read', 'jobs.write', 'ops.read', 'ops.write'];

function ClientsSection() {
  const action = useAction();
  const { confirm } = useUi();
  const q = useQuery({ queryKey: ['clients'], queryFn: () => get<{ clients: Client[] }>('/internal/clients') });
  const [form, setForm] = useState({ name: '', scopes: ['jobs.read'] as ClientScope[], flowFilter: '*', bindingFilter: '*' });
  const [shown, setShown] = useState<string | null>(null);
  const create = useSave(
    () =>
      post<{ token: string }>('/internal/clients', { name: form.name, scopes: form.scopes, flowFilter: form.flowFilter.split(',').map((s) => s.trim()).filter(Boolean), bindingFilter: form.bindingFilter.split(',').map((s) => s.trim()).filter(Boolean) }).then((r) => setShown(r.token)),
    [['clients']],
    'Đã tạo token',
  );
  const revoke = useSave((id: string) => post(`/internal/clients/${id}/revoke`), [['clients']], 'Đã thu hồi token');
  return (
    <Section title="Ứng dụng kết nối (token cho M1)">
      <div className="form-grid">
        <label className="field">
          Tên
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <fieldset className="field">
          <legend>Scope</legend>
          {SCOPES.map((s) => (
            <label key={s}>
              <input type="checkbox" checked={form.scopes.includes(s)} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, s] : form.scopes.filter((x) => x !== s) })} /> {label(SCOPE_LABELS, s)} <code>{s}</code>
            </label>
          ))}
        </fieldset>
        <label className="field">
          Bộ lọc flow (phân cách dấu phẩy)
          <input value={form.flowFilter} onChange={(e) => setForm({ ...form, flowFilter: e.target.value })} />
        </label>
        <label className="field">
          Bộ lọc binding (phân cách dấu phẩy)
          <input value={form.bindingFilter} onChange={(e) => setForm({ ...form, bindingFilter: e.target.value })} />
        </label>
      </div>
      <button className="primary" disabled={!form.name || form.scopes.length === 0} onClick={() => create.mutate(undefined)}>
        Tạo token
      </button>
      {shown && (
        <Modal title="Token mới — chỉ hiển thị một lần" onClose={() => setShown(null)}>
          <p>Sao chép và lưu token ngay. ProfileVault chỉ giữ bản băm, không hiển thị lại.</p>
          <pre className="mono token">{shown}</pre>
          <div className="modal-actions">
            <button onClick={() => void navigator.clipboard?.writeText(shown)}>Sao chép</button>
            <button className="primary" onClick={() => setShown(null)}>
              Đã lưu
            </button>
          </div>
        </Modal>
      )}
      <h4>Token hiện có</h4>
      {(q.data?.clients ?? []).length === 0 ? (
        <Empty>Chưa có token.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Prefix</th>
              <th>Scope</th>
              <th>Tạo</th>
              <th>Dùng lần cuối</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data!.clients.map((c) => (
              <tr key={c.id} className={c.revokedAt ? 'muted' : undefined}>
                <td>{c.name}</td>
                <td>
                  <code>pv_{c.tokenPrefix}_…</code>
                </td>
                <td>{c.scopes.join(', ')}</td>
                <td>{formatDateTime(c.createdAt)}</td>
                <td>{formatDateTime(c.lastUsedAt)}</td>
                <td>
                  {c.revokedAt ? (
                    `thu hồi ${formatDateTime(c.revokedAt)}`
                  ) : (
                    <button className="small danger" onClick={action(async () => (await confirm({ title: 'Thu hồi token?', body: `Ứng dụng "${c.name}" sẽ không gọi được ProfileVault nữa.`, danger: true, confirmLabel: 'Thu hồi' })) && revoke.mutate(c.id))}>
                      Thu hồi
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

const DATASETS = [
  { id: 'events', label: 'Sự kiện' },
  { id: 'proxy_checks', label: 'Kiểm proxy' },
  { id: 'runs', label: 'Run' },
  { id: 'level_changes', label: 'Đổi mức' },
  { id: 'consistency_results', label: 'Kết quả nhất quán' },
];

function ExportSection() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = new URLSearchParams();
  if (from) qs.set('from', fromLocalInput(`${from}T00:00`));
  if (to) qs.set('to', fromLocalInput(`${to}T23:59:59.999`));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return (
    <Section title="Xuất CSV">
      <div className="form-row">
        <label>
          Từ <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Đến <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <ul>
        {DATASETS.map((d) => (
          <li key={d.id}>
            <a href={`/internal/export/${d.id}.csv${suffix}`} download>
              {d.label} (.csv)
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
