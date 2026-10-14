import type { ChartResponse } from '@sctech/profilevault-contract';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { CHART_LABELS, label } from '../lib/labels';
import { qk } from '../lib/sse';
import { Loading } from './ui';

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

/** Chuyển `points` → hàng phẳng cho Recharts + danh sách series. */
export function flatten(points: NonNullable<ChartResponse['points']>): { rows: Record<string, number | string>[]; keys: string[] } {
  const keys = new Set<string>();
  const rows = points.map((p) => {
    for (const k of Object.keys(p.series)) keys.add(k);
    return { bucket: p.bucket, ...p.series };
  });
  return { rows, keys: [...keys].sort() };
}

const STACKED = new Set(['uploads_by_mode', 'needs_user_by_reason']);

export function ChartPanel({ bindingId, name, bucket, from = '', to = '' }: { bindingId: string; name: string; bucket: 'day' | 'week'; from?: string; to?: string }) {
  const params = new URLSearchParams({ bindingId, bucket });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const q = useQuery({ queryKey: [...qk.chart(bindingId, name, bucket), from, to], queryFn: () => get<ChartResponse>(`/internal/charts/${name}?${params.toString()}`) });
  return (
    <div className="chart">
      <h4>{label(CHART_LABELS, name)}</h4>
      {q.isLoading ? <Loading /> : q.data ? <ChartBody data={q.data} /> : <p className="error">Không tải được biểu đồ</p>}
    </div>
  );
}

export function ChartBody({ data }: { data: ChartResponse }) {
  if (data.kind === 'spans') {
    const spans = data.spans ?? [];
    if (spans.length === 0) return <p className="muted">Chưa có dữ liệu.</p>;
    return (
      <ol className="timeline-bands">
        {spans.map((s, i) => (
          <li key={i} className={s.ok === false ? 'band band-red' : 'band'}>
            <strong>{s.label}</strong> {s.value && <code>{s.value}</code>} <span className="muted">{formatDateTime(s.from)} → {formatDateTime(s.to)}</span>
            {i > 0 && spans[i - 1]?.label !== s.label && <span className="chip chip-yellow">đổi</span>}
          </li>
        ))}
      </ol>
    );
  }
  const { rows, keys } = flatten(data.points ?? []);
  if (rows.length === 0) return <p className="muted">Chưa có dữ liệu.</p>;
  if (STACKED.has(data.name)) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bucket" fontSize={11} />
          <YAxis allowDecimals={false} fontSize={11} />
          <Tooltip />
          <Legend />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="a" fill={PALETTE[i % PALETTE.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="bucket" fontSize={11} />
        <YAxis fontSize={11} />
        <Tooltip />
        <Legend />
        {keys.map((k, i) => (
          <Line key={k} dataKey={k} type={data.name === 'session_age' ? 'stepAfter' : 'monotone'} stroke={PALETTE[i % PALETTE.length]} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
