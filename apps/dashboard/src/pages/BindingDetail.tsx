import { useAction } from '../components/ui';
import type { Binding, HealthEventRecord, LevelChange, Pause, ProxyCheck, Readiness } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LevelBadge, PauseChip, Section, Tabs } from '../components/bits';
import { ChartPanel } from '../components/Charts';
import { ChecklistForm, ConsistencyTable, ProbePanel, type ConsistencyView } from '../components/Consistency';
import { EventMenu, useRecordEvent } from '../components/EventMenu';
import { Empty, ErrorBox, Loading, useUi } from '../components/ui';
import { del, errorMessage, get, patch, post } from '../lib/api';
import { formatDateTime, fromLocalInput, json } from '../lib/format';
import { findEvent, shortcutFor } from '../lib/events';
import { CHART_LABELS, CONDITION_LABELS, EVENT_LABELS, LEVEL_LABELS, PAUSE_REASON_LABELS, USER_CLEARABLE, label } from '../lib/labels';
import { qk } from '../lib/sse';
import { usePromote } from './Overview';

export default function BindingDetail() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const b = useQuery({ queryKey: qk.binding(id), queryFn: () => get<Binding>(`/internal/bindings/${id}`) });
  const readiness = useQuery({ queryKey: qk.readiness(id), queryFn: () => get<Readiness>(`/internal/bindings/${id}/readiness`) });
  const record = useRecordEvent(id);

  // Phím tắt U = Đã upload (SPEC-07 §5)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const type = shortcutFor(e.key, (e.target as HTMLElement | null)?.tagName, e.ctrlKey || e.metaKey || e.altKey);
      const ev = type ? findEvent(type) : undefined;
      if (ev) {
        e.preventDefault();
        record.mutate({ event: ev });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [record]);

  if (b.isLoading) return <Loading />;
  if (b.error || !b.data) return <ErrorBox error={b.error ?? 'Không có binding'} />;
  const binding = b.data;
  return (
    <div>
      <Header binding={binding} readiness={readiness.data} />
      <Tabs
        initial={params.get('tab') ?? 'timeline'}
        tabs={[
          { id: 'timeline', label: 'Dòng thời gian', render: () => <Timeline id={id} /> },
          { id: 'charts', label: 'Biểu đồ', render: () => <ChartsTab id={id} /> },
          { id: 'thresholds', label: 'Ngưỡng', render: () => <ThresholdTab readiness={readiness.data} /> },
          { id: 'consistency', label: 'Nhất quán', render: () => <ConsistencyTab id={id} /> },
          { id: 'checklist', label: 'Checklist', render: () => <ChecklistForm bindingId={id} /> },
          { id: 'probe', label: 'Probe', render: () => <ProbePanel bindingId={id} /> },
          { id: 'config', label: 'Cấu hình', render: () => <ConfigTab binding={binding} /> },
        ]}
      />
    </div>
  );
}

function Header({ binding, readiness }: { binding: Binding; readiness: Readiness | undefined }) {
  const action = useAction();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const promote = usePromote();
  const pauses = useQuery({ queryKey: qk.pauses(binding.id), queryFn: () => get<{ pauses: Pause[] }>(`/internal/bindings/${binding.id}/pauses?open=true`) });
  const refresh = () => {
    for (const k of [qk.pauses(binding.id), qk.readiness(binding.id), qk.overview, qk.inbox]) void qc.invalidateQueries({ queryKey: k });
  };
  const pause = useMutation({ mutationFn: () => post(`/internal/bindings/${binding.id}/pause`, {}), onSuccess: () => (toast('Đã tạm dừng'), refresh()), onError: (e) => toast(errorMessage(e), { kind: 'error' }) });
  const clear = useMutation({ mutationFn: (pid: string) => post(`/internal/pauses/${pid}/clear`), onSuccess: () => (toast('Đã gỡ dừng'), refresh()), onError: (e) => toast(errorMessage(e), { kind: 'error' }) });
  const open = pauses.data?.pauses ?? [];
  return (
    <div className="detail-head">
      <div>
        <h1>
          {binding.displayName} <LevelBadge level={binding.level} />
        </h1>
        <p className="muted">
          {binding.platform} · {binding.accountId} · profile {binding.furyProfileId} · thị trường {binding.marketCountry} · ở mức từ {formatDateTime(binding.levelSince)}
        </p>
      </div>
      <div className="row-actions">
        <EventMenu bindingId={binding.id} />
        <button className="primary" disabled={!readiness?.canPromote} onClick={() => void promote(binding)}>
          Lên mức
        </button>
        <button onClick={action(async () => (await confirm({ title: 'Tạm dừng kênh?', body: 'Runner sẽ không bắt đầu run mới cho kênh này cho tới khi bạn bấm "Tiếp tục".', confirmLabel: 'Tạm dừng', danger: true })) && pause.mutate())}>Tạm dừng</button>
      </div>
      {open.length > 0 && (
        <ul className="pause-list">
          {open.map((p) => (
            <li key={p.id}>
              <PauseChip reason={p.reason} /> từ {formatDateTime(p.createdAt)} <span className="mono small">{json(p.detail)}</span>
              {USER_CLEARABLE.has(p.reason) ? (
                <button
                  className="small"
                  onClick={action(async () =>
                    (await confirm({ title: p.reason === 'manual' ? 'Tiếp tục?' : 'Đã xử lý?', body: `Gỡ dừng "${label(PAUSE_REASON_LABELS, p.reason)}". Mức không tự tăng lại; kênh tiếp tục ở mức hiện tại.`, confirmLabel: p.reason === 'manual' ? 'Tiếp tục' : 'Đã xử lý' })) && clear.mutate(p.id))
                  }
                >
                  {p.reason === 'manual' ? 'Tiếp tục' : p.reason === 'proxy_changed' ? 'Xác nhận exit mới' : 'Đã xử lý'}
                </button>
              ) : (
                <span className="muted small"> (tự gỡ khi lần kiểm kế tiếp đạt)</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Timeline({ id }: { id: string }) {
  const [type, setType] = useState('');
  const events = useQuery({ queryKey: qk.events(id), queryFn: () => get<{ events: HealthEventRecord[] }>(`/internal/bindings/${id}/events?limit=500`) });
  const changes = useQuery({ queryKey: qk.levelChanges(id), queryFn: () => get<{ levelChanges: LevelChange[] }>(`/internal/bindings/${id}/level-changes`) });
  const proxy = useQuery({ queryKey: qk.proxyChecks(id), queryFn: () => get<{ proxyChecks: ProxyCheck[] }>(`/internal/bindings/${id}/proxy-checks`) });
  if (events.isLoading) return <Loading />;
  const list = (events.data?.events ?? []).filter((e) => type === '' || e.type.startsWith(type));
  return (
    <div className="grid-2">
      <Section
        title="Sự kiện"
        actions={
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Mọi loại</option>
            {['manual', 'proxy', 'session_check', 'run', 'flow', 'level', 'binding', 'fury', 'probe', 'detect_suite'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        }
      >
        {list.length === 0 ? (
          <Empty>Chưa có sự kiện.</Empty>
        ) : (
          <ol className="timeline">
            {list.map((e) => (
              <li key={e.id} className={`sev-${e.severity}`}>
                <span className="when">{formatDateTime(e.occurredAt)}</span> <strong>{label(EVENT_LABELS, e.type)}</strong>
                {Object.keys(e.payload).length > 0 && <span className="mono small"> {json(e.payload)}</span>}
              </li>
            ))}
          </ol>
        )}
      </Section>
      <div>
        <Section title="Đổi mức">
          {(changes.data?.levelChanges ?? []).length === 0 ? (
            <Empty>Chưa đổi mức.</Empty>
          ) : (
            <ul>
              {changes.data!.levelChanges.map((c) => (
                <li key={c.id}>
                  {formatDateTime(c.createdAt)}: {label(LEVEL_LABELS, c.fromLevel)} → {label(LEVEL_LABELS, c.toLevel)} ({c.reason}, {c.actor === 'user' ? 'người vận hành' : 'hệ thống'})
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Kiểm proxy" actions={<ProxyNow id={id} />}>
          {(proxy.data?.proxyChecks ?? []).length === 0 ? (
            <Empty>Chưa kiểm.</Empty>
          ) : (
            <table className="table">
              <tbody>
                {proxy.data!.proxyChecks.slice(0, 20).map((c) => (
                  <tr key={c.id} className={c.ok ? undefined : 'row-red'}>
                    <td>{formatDateTime(c.checkedAt)}</td>
                    <td>{c.ok ? `${c.exitIp ?? ''} · ${c.country ?? '?'} · AS${c.asn ?? '?'} ${c.asnType ?? ''}` : `Lỗi: ${c.error ?? ''}`}</td>
                    <td>{c.latencyMs !== null ? `${c.latencyMs} ms` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </div>
  );
}

function ProxyNow({ id }: { id: string }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const m = useMutation({
    mutationFn: () => post<ProxyCheck>(`/internal/bindings/${id}/proxy-check`),
    onSuccess: (c) => {
      toast(c.ok ? `Exit ${c.exitIp ?? ''} (${c.country ?? '?'})` : `Kiểm proxy lỗi: ${c.error ?? ''}`, { kind: c.ok ? 'ok' : 'error' });
      for (const k of [qk.proxyChecks(id), qk.overview, qk.consistency(id)]) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  return (
    <button className="small" disabled={m.isPending} onClick={() => m.mutate()}>
      Kiểm ngay
    </button>
  );
}

function ChartsTab({ id }: { id: string }) {
  const [bucket, setBucket] = useState<'day' | 'week'>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const invalidRange = !!from && !!to && from > to;
  return (
    <div>
      <div className="filters">
        <label>Từ ngày <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Đến ngày <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <label>
          <input type="radio" checked={bucket === 'day'} onChange={() => setBucket('day')} /> Theo ngày
        </label>
        <label>
          <input type="radio" checked={bucket === 'week'} onChange={() => setBucket('week')} /> Theo tuần
        </label>
      </div>
      {invalidRange && <p className="error">Ngày kết thúc phải sau ngày bắt đầu.</p>}
      <div className="charts">
        {!invalidRange && Object.keys(CHART_LABELS).map((name) => (
          <ChartPanel key={name} bindingId={id} name={name} bucket={bucket} from={from ? fromLocalInput(`${from}T00:00`) : ''} to={to ? fromLocalInput(`${to}T23:59:59.999`) : ''} />
        ))}
      </div>
    </div>
  );
}

export function ThresholdTab({ readiness }: { readiness: Readiness | undefined }) {
  if (!readiness) return <Loading />;
  if (readiness.nextLevel === null) return <Empty>Kênh ở mức cao nhất (L3).</Empty>;
  return (
    <div>
      <p>
        Điều kiện lên {label(LEVEL_LABELS, readiness.nextLevel)} — đạt {readiness.conditions.filter((c) => c.met).length}/{readiness.conditions.length}
        {readiness.openPauses.length > 0 && <strong className="red"> · đang dừng nên chưa lên mức được</strong>}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Điều kiện</th>
            <th>Hiện tại</th>
            <th>Yêu cầu</th>
            <th>Đạt?</th>
          </tr>
        </thead>
        <tbody>
          {readiness.conditions.map((c, i) => (
            <tr key={i} className={c.met ? undefined : 'row-red'}>
              <td>
                {label(CONDITION_LABELS, c.condition.kind)}
                {'type' in c.condition && <span className="muted small"> ({c.condition.type})</span>}
              </td>
              <td>{c.current ?? '—'}</td>
              <td>{c.required ?? '—'}</td>
              <td>{c.met ? '✔' : '✘'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsistencyTab({ id }: { id: string }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const q = useQuery({ queryKey: qk.consistency(id), queryFn: () => get<ConsistencyView>(`/internal/bindings/${id}/consistency`) });
  const run = useMutation({
    mutationFn: () => post('/internal/consistency/run', { bindingId: id }),
    onSuccess: () => {
      toast('Đã kiểm tra lại');
      for (const k of [qk.consistency(id), qk.overview, qk.readiness(id), qk.pauses(id)]) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  return (
    <div>
      <div className="actions">
        <button disabled={run.isPending} onClick={() => run.mutate()}>
          Kiểm tra lại
        </button>
      </div>
      {q.isLoading ? <Loading /> : q.data ? <ConsistencyTable view={q.data} /> : <ErrorBox error={q.error} />}
      <h4>Probe</h4>
      <ProbePanel bindingId={id} />
    </div>
  );
}

function ConfigTab({ binding }: { binding: Binding }) {
  const action = useAction();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const [market, setMarket] = useState(binding.marketCountry);
  const [roots, setRoots] = useState(binding.allowedRoots.join('\n'));
  const visiblePack = Object.fromEntries(Object.entries(binding.packConfig).filter(([k]) => !k.startsWith('_')));
  const [pack, setPack] = useState(JSON.stringify(visiblePack, null, 2));
  const save = useMutation({
    mutationFn: () => patch<Binding>(`/internal/bindings/${binding.id}`, { marketCountry: market.toUpperCase(), allowedRoots: roots.split('\n').map((s) => s.trim()).filter(Boolean), packConfig: JSON.parse(pack) as Record<string, unknown> }),
    onSuccess: () => {
      toast('Đã lưu cấu hình; đã kiểm tra nhất quán lại');
      void qc.invalidateQueries({ queryKey: qk.binding(binding.id) });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  const archive = useMutation({ mutationFn: () => del(`/internal/bindings/${binding.id}`), onSuccess: () => (toast('Đã lưu trữ binding'), void qc.invalidateQueries({ queryKey: qk.overview })) });
  return (
    <div className="form-grid">
      <label className="field">
        Thị trường (ISO2)
        <input value={market} onChange={(e) => setMarket(e.target.value)} maxLength={2} />
      </label>
      <label className="field">
        Thư mục file cho phép (mỗi dòng một thư mục)
        <textarea rows={3} value={roots} onChange={(e) => setRoots(e.target.value)} />
      </label>
      <label className="field">
        Cấu hình pack (JSON, ví dụ <code>{'{"studioLanguage":"en"}'}</code>)
        <textarea rows={5} className="mono" value={pack} onChange={(e) => setPack(e.target.value)} />
      </label>
      <div className="actions">
        <button className="primary" onClick={() => save.mutate()}>
          Lưu
        </button>
        <button className="danger" onClick={action(async () => (await confirm({ title: 'Lưu trữ binding?', body: 'Kênh sẽ ẩn khỏi tổng quan và không còn được kiểm. Lịch sử được giữ.', danger: true, confirmLabel: 'Lưu trữ' })) && archive.mutate())}>
          Lưu trữ
        </button>
        <Link to="/">Về tổng quan</Link>
      </div>
    </div>
  );
}
