import type { Binding, CrossMatrix, SystemInfo } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Section } from '../components/bits';
import { Empty, ErrorBox, Loading, useUi } from '../components/ui';
import { errorMessage, get, post } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { qk } from '../lib/sse';

/** Ô ma trận chéo: màu nặng nhất của các cặp (SPEC-07 §4.6). Hàm thuần để test. */
export function matrixCell(m: CrossMatrix, a: string, b: string): { level: 'red' | 'yellow' | null; details: string[] } {
  const cells = m.cells.filter((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  const level = cells.some((c) => c.level === 'red') ? 'red' : cells.length > 0 ? 'yellow' : null;
  return { level, details: cells.map((c) => `${c.kind}: ${c.detail}`) };
}

export default function System() {
  const qc = useQueryClient();
  const { toast } = useUi();
  const sys = useQuery({ queryKey: qk.system, queryFn: () => get<SystemInfo>('/internal/system') });
  const matrix = useQuery({ queryKey: qk.matrix, queryFn: () => get<CrossMatrix>('/internal/consistency/matrix') });
  const bindings = useQuery({ queryKey: qk.bindings, queryFn: () => get<{ bindings: Binding[] }>('/internal/bindings') });
  const toggle = useMutation({
    mutationFn: (v: { path: string; body: Record<string, boolean> }) => post(v.path, v.body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.system }),
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  if (sys.isLoading) return <Loading />;
  if (sys.error || !sys.data) return <ErrorBox error={sys.error} />;
  const s = sys.data;
  const names = new Map((bindings.data?.bindings ?? []).map((b) => [b.id, b.displayName]));
  const ids = matrix.data?.bindingIds ?? [];
  return (
    <div>
      <h1>Hệ thống</h1>
      <div className="grid-2">
        <Section title="Trạng thái">
          <ul>
            <li>Dịch vụ {s.service.version}, chạy từ {formatDateTime(s.service.startedAt)}</li>
            <li>Fury: {s.fury ? (s.fury.reachable ? `online ${s.fury.version ?? ''}${s.fury.supported ? '' : ' (ngoài khoảng hỗ trợ)'}` : 'offline') : '?'}</li>
            <li>
              Hàng đợi: {s.queue.queued} đợi · {s.queue.running} chạy · {s.queue.needsUser} chờ bạn
            </li>
            <li>Profile đang chạy: {s.runningProfiles}</li>
            <li>
              RAM trống: {s.ramFreeMb} / {s.ramTotalMb} MB
            </li>
            <li>
              {s.bindings} kênh · {s.openPauses} dừng đang mở
            </li>
          </ul>
          <div className="actions">
            <label>
              <input type="checkbox" checked={s.busyMode} onChange={(e) => toggle.mutate({ path: '/internal/system/busy-mode', body: { busy: e.target.checked } })} /> Chế độ bận
            </label>
            <label>
              <input type="checkbox" checked={s.globalPause} onChange={(e) => toggle.mutate({ path: '/internal/system/global-pause', body: { paused: e.target.checked } })} /> Tạm dừng mọi job
            </label>
          </div>
        </Section>
        <Section title="Flow pack">
          {s.packs.length === 0 ? (
            <Empty>Chưa nạp pack nào (Runner).</Empty>
          ) : (
            <ul>
              {s.packs.map((p) => (
                <li key={p.id} className={p.status === 'disabled' ? 'red' : undefined}>
                  {p.id} {p.version} — {p.status === 'enabled' ? 'bật' : `tắt: ${p.reason ?? ''}`} ({p.flows.join(', ')})
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title="Ma trận chéo giữa các kênh">
        {matrix.isLoading ? (
          <Loading />
        ) : ids.length < 2 ? (
          <Empty>Cần ít nhất hai kênh.</Empty>
        ) : (
          <table className="matrix">
            <thead>
              <tr>
                <th />
                {ids.map((b) => (
                  <th key={b}>{names.get(b) ?? b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ids.map((a) => (
                <tr key={a}>
                  <th>{names.get(a) ?? a}</th>
                  {ids.map((b) => {
                    if (a === b) return <td key={b} className="self" />;
                    const c = matrixCell(matrix.data!, a, b);
                    return (
                      <td key={b} className={c.level ? `cell-${c.level}` : undefined} title={c.details.join('\n')}>
                        {c.details.length > 0 ? c.details.length : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Đỏ: trùng exit IP hoặc email/số khôi phục · Vàng: cùng dải mạng, hoặc cùng ASN + persona. Rê chuột để xem chi tiết.</p>
      </Section>
    </div>
  );
}
