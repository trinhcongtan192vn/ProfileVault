import { useAction } from '../components/ui';
import type { Schedule, ScheduleInput } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Section } from '../components/bits';
import { Empty, ErrorBox, Loading, useUi } from '../components/ui';
import { del, errorMessage, get, patch, post } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { qk } from '../lib/sse';

const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export function daysLabel(days: string): string {
  return days.length === 7 ? 'Mọi ngày' : [...days].map((d) => DOW[Number(d) - 1] ?? d).join(', ');
}

export default function Schedules() {
  const action = useAction();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const q = useQuery({ queryKey: qk.schedules, queryFn: () => get<{ schedules: Schedule[] }>('/internal/schedules') });
  const [form, setForm] = useState({ flowId: 'youtube/session-check', days: '1234567', start: '07:00', end: '22:00' });
  const refresh = () => void qc.invalidateQueries({ queryKey: qk.schedules });
  const create = useMutation({
    mutationFn: () => post<Schedule>('/internal/schedules', { flowId: form.flowId, target: { all: true, platform: form.flowId.split('/')[0] === 'generic' ? undefined : form.flowId.split('/')[0] }, daysOfWeek: form.days, windowStart: form.start, windowEnd: form.end } satisfies ScheduleInput),
    onSuccess: () => (toast('Đã tạo lịch'), refresh()),
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  const toggle = useMutation({ mutationFn: (s: Schedule) => patch(`/internal/schedules/${s.id}`, { enabled: !s.enabled }), onSuccess: refresh, onError: (e) => toast(errorMessage(e), { kind: 'error' }) });
  const remove = useMutation({ mutationFn: (s: Schedule) => del(`/internal/schedules/${s.id}`), onSuccess: refresh, onError: (e) => toast(errorMessage(e), { kind: 'error' }) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const list = q.data?.schedules ?? [];
  return (
    <div>
      <h1>Lịch</h1>
      <p className="muted">Lịch session-check mặc định được tạo khi kênh lên L1. Mỗi kênh nhận một giờ ngẫu nhiên trong khung.</p>
      {list.length === 0 ? (
        <Empty>Chưa có lịch.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Flow</th>
              <th>Mục tiêu</th>
              <th>Ngày</th>
              <th>Khung giờ</th>
              <th>Lượt kế tiếp</th>
              <th>Bật</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>{s.flowId}</td>
                <td className="mono small">{JSON.stringify(s.target)}</td>
                <td>{daysLabel(s.daysOfWeek)}</td>
                <td>
                  {s.windowStart}–{s.windowEnd}
                </td>
                <td>
                  {(s.nextRuns ?? []).length > 0 ? (
                    <ul className="compact">
                      {s.nextRuns!.map((n) => (
                        <li key={n.bindingId}>
                          {n.bindingId}: {formatDateTime(n.at)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    formatDateTime(s.nextRunAt)
                  )}
                </td>
                <td>
                  <input type="checkbox" checked={s.enabled} onChange={() => toggle.mutate(s)} />
                </td>
                <td>
                  <button className="small danger" onClick={action(async () => (await confirm({ title: 'Xóa lịch?', body: s.flowId, danger: true })) && remove.mutate(s))}>
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Section title="Tạo lịch">
        <div className="form-row">
          <input value={form.flowId} onChange={(e) => setForm({ ...form, flowId: e.target.value })} placeholder="pack/flow" />
          <input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value.replace(/[^1-7]/g, '') })} title="1=Thứ Hai … 7=Chủ nhật" />
          <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
          <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          <button className="primary" onClick={() => create.mutate()}>
            Tạo
          </button>
        </div>
      </Section>
    </div>
  );
}
