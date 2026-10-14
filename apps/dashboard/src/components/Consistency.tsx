import { useAction } from './ui';
import type { ChecklistInput, ChecklistStatus, ConsistencyResultRow, ConsistencyScore, ProbeResult } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent } from 'react';
import { api, errorMessage, get, post, put } from '../lib/api';
import { formatDateTime, json } from '../lib/format';
import { LAYER_LABELS, SEVERITY_LABELS, label } from '../lib/labels';
import { qk } from '../lib/sse';
import { StatusChip } from './bits';
import { Empty, Loading, useUi } from './ui';

export interface ConsistencyView {
  bindingId: string;
  runId: string | null;
  trigger: string | null;
  finishedAt: string | null;
  score: ConsistencyScore | null;
  results: ConsistencyResultRow[];
}

/** Nhóm kết quả theo lớp A–E (SPEC-07 §4.2 thẻ Nhất quán). */
export function groupByLayer(results: ConsistencyResultRow[]): [string, ConsistencyResultRow[]][] {
  const map = new Map<string, ConsistencyResultRow[]>();
  for (const r of [...results].sort((a, b) => a.ruleId.localeCompare(b.ruleId, 'en', { numeric: true }))) {
    const layer = r.ruleId.charAt(0);
    map.set(layer, [...(map.get(layer) ?? []), r]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function ConsistencyTable({ view }: { view: ConsistencyView }) {
  if (view.results.length === 0) return <Empty>Chưa chạy kiểm tra nhất quán cho kênh này.</Empty>;
  return (
    <div>
      {view.score && (
        <p>
          Điểm nhất quán: <strong>{view.score.passed}/{view.score.total}</strong> · luật chặn trượt: <strong className={view.score.blockFailing > 0 ? 'red' : undefined}>{view.score.blockFailing}</strong> · chặn chưa rõ: {view.score.blockUnknown} · lần kiểm: {formatDateTime(view.finishedAt)} ({view.trigger})
        </p>
      )}
      {groupByLayer(view.results).map(([layer, rows]) => (
        <div key={layer} className="layer">
          <h4>{label(LAYER_LABELS, layer)}</h4>
          <table className="table">
            <thead>
              <tr>
                <th>Luật</th>
                <th>Trạng thái</th>
                <th>Mức</th>
                <th>Thực tế</th>
                <th>Kỳ vọng</th>
                <th>Gợi ý sửa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ruleId} className={r.status === 'fail' && r.severity === 'block' ? 'row-red' : undefined}>
                  <td>
                    <code>{r.ruleId}</code>
                  </td>
                  <td>
                    <StatusChip status={r.status} />
                  </td>
                  <td>{label(SEVERITY_LABELS, r.severity)}</td>
                  <td className="mono small">{json(r.actual)}</td>
                  <td className="mono small">{json(r.expected)}</td>
                  <td>{r.hint ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const FIELDS: { key: keyof ChecklistInput; label: string; kind: 'country' | 'text' | 'secret' | 'bool' }[] = [
  { key: 'accountRegion', label: 'Vùng tài khoản Google (ISO2)', kind: 'country' },
  { key: 'channelCountry', label: 'Quốc gia kênh YouTube (ISO2)', kind: 'country' },
  { key: 'accountLanguage', label: 'Ngôn ngữ tài khoản (BCP-47)', kind: 'text' },
  { key: 'recoveryEmail', label: 'Email khôi phục', kind: 'secret' },
  { key: 'recoveryPhone', label: 'Số điện thoại khôi phục (E.164, ví dụ +49151…)', kind: 'secret' },
  { key: 'twofaEnabled', label: 'Đã bật 2FA', kind: 'bool' },
  { key: 'exclusiveLoginConfirmed', label: 'Tài khoản chỉ đăng nhập trong profile Fury này', kind: 'bool' },
  { key: 'studioLanguageSet', label: 'Đã đặt ngôn ngữ Studio = English', kind: 'bool' },
];

/** Checklist tài khoản (SPEC-02 §6.8): email/số không bao giờ hiển thị lại. */
export function ChecklistForm({ bindingId, onSaved, showConfirm = true }: { bindingId: string; onSaved?: () => void; showConfirm?: boolean }) {
  const action = useAction();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const q = useQuery({ queryKey: qk.checklist(bindingId), queryFn: () => get<ChecklistStatus>(`/internal/bindings/${bindingId}/checklist`) });
  const [form, setForm] = useState<ChecklistInput>({});
  const save = useMutation({
    mutationFn: () => put<ChecklistStatus>(`/internal/bindings/${bindingId}/checklist`, form),
    onSuccess: () => {
      toast('Đã lưu checklist');
      setForm({});
      void qc.invalidateQueries({ queryKey: qk.checklist(bindingId) });
      void qc.invalidateQueries({ queryKey: qk.consistency(bindingId) });
      onSaved?.();
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  const confirmM = useMutation({
    mutationFn: () => post<ChecklistStatus>(`/internal/bindings/${bindingId}/checklist/confirm`),
    onSuccess: () => {
      toast('Đã xác nhận checklist (hiệu lực 90 ngày)');
      void qc.invalidateQueries({ queryKey: qk.checklist(bindingId) });
      void qc.invalidateQueries({ queryKey: qk.readiness(bindingId) });
      onSaved?.();
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  if (q.isLoading || !q.data) return <Loading />;
  const s = q.data;
  const current = (k: keyof ChecklistInput): string => {
    if (k === 'recoveryEmail') return s.hasRecoveryEmail ? 'Đã lưu' : 'Chưa có';
    if (k === 'recoveryPhone') return s.hasRecoveryPhone ? 'Đã lưu' : 'Chưa có';
    const v = (s as unknown as Record<string, unknown>)[k];
    return v === null || v === undefined ? 'Chưa có' : typeof v === 'boolean' ? (v ? 'Có' : 'Không') : typeof v === 'string' ? v : JSON.stringify(v);
  };
  return (
    <div className="checklist">
      <p>
        Trạng thái: {s.complete ? 'đủ trường' : `thiếu ${s.missing.join(', ')}`} · {s.confirmedAt ? `xác nhận ${formatDateTime(s.confirmedAt)}, hết hạn ${formatDateTime(s.expiresAt)}` : 'chưa xác nhận'}
        {s.expired && s.confirmedAt && <strong className="red"> · đã hết hạn</strong>}
      </p>
      <div className="form-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>
              {f.label} <span className="muted">({current(f.key)})</span>
            </span>
            {f.kind === 'bool' ? (
              <select value={form[f.key] === undefined ? '' : String(form[f.key])} onChange={(e) => setForm({ ...form, [f.key]: e.target.value === '' ? undefined : e.target.value === 'true' })}>
                <option value="">— giữ nguyên —</option>
                <option value="true">Có</option>
                <option value="false">Không</option>
              </select>
            ) : (
              <input
                type={f.kind === 'secret' ? 'password' : 'text'}
                autoComplete="off"
                placeholder={f.kind === 'secret' ? 'Nhập để thay (chỉ lưu dạng băm)' : ''}
                value={(form[f.key] as string | undefined) ?? ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value === '' ? undefined : f.kind === 'country' ? e.target.value.toUpperCase() : e.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      <div className="actions">
        <button className="primary" disabled={Object.keys(form).length === 0 || save.isPending} onClick={() => save.mutate()}>
          Lưu
        </button>
        {showConfirm && (
          <button
            disabled={!s.complete || confirmM.isPending}
            onClick={action(async () => {
              if (await confirm({ title: 'Xác nhận checklist', body: 'Bạn xác nhận các thông tin trên là đúng? Checklist có hiệu lực 90 ngày.' })) confirmM.mutate();
            })}
          >
            Xác nhận
          </button>
        )}
      </div>
    </div>
  );
}

interface ProbeList {
  probes: Pick<ProbeResult, 'id' | 'furyVersion' | 'source' | 'capturedAt' | 'createdAt'>[];
  comparison: { latestId: string; previousId: string; changes: { path: string; before: unknown; after: unknown }[] } | null;
}

/** Nhập file probe (kéo thả hoặc chọn file) + danh sách + so sánh (SPEC-07 §4.2 thẻ Probe). */
export function ProbePanel({ bindingId, onImported }: { bindingId: string; onImported?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const [drag, setDrag] = useState(false);
  const list = useQuery({ queryKey: qk.probes(bindingId), queryFn: () => get<ProbeList>(`/internal/bindings/${bindingId}/probes`) });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<ProbeResult>('POST', `/internal/bindings/${bindingId}/probes`, { form: fd });
    },
    onSuccess: (p) => {
      toast(`Đã nhập probe (Fury ${p.furyVersion}); đã chạy kiểm tra nhất quán`);
      for (const k of [qk.probes(bindingId), qk.consistency(bindingId), qk.overview, qk.readiness(bindingId)]) void qc.invalidateQueries({ queryKey: k });
      onImported?.();
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error', ttlMs: 10_000 }),
  });
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) upload.mutate(f);
  };
  return (
    <div>
      <div className={drag ? 'dropzone over' : 'dropzone'} onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <p>Mở profile trong Fury → trang probe → xuất file → kéo thả vào đây</p>
        <label className="button">
          Chọn file…
          <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        </label>
        {upload.isPending && <p className="muted">Đang nhập…</p>}
      </div>
      {list.data && list.data.probes.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Thời điểm đo</th>
              <th>Phiên bản Fury</th>
              <th>Nguồn</th>
            </tr>
          </thead>
          <tbody>
            {list.data.probes.map((p) => (
              <tr key={p.id}>
                <td>{formatDateTime(p.capturedAt)}</td>
                <td>{p.furyVersion}</td>
                <td>{p.source === 'flow' ? 'Flow' : 'Nhập tay'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>Chưa có probe.</Empty>
      )}
      {list.data?.comparison && (
        <div>
          <h4>So sánh probe gần nhất với lần trước</h4>
          {list.data.comparison.changes.length === 0 ? (
            <p>Không có trường nào đổi.</p>
          ) : (
            <ul>
              {list.data.comparison.changes.map((c) => (
                <li key={c.path}>
                  <code>{c.path}</code>: <span className="mono small">{json(c.before)}</span> → <span className="mono small">{json(c.after)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
