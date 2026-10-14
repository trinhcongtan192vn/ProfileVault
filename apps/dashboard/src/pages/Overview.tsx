import type { LevelChange, Overview as OverviewData, OverviewRow } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LevelBadge, PauseChip, Progress } from '../components/bits';
import { DataTable } from '../components/DataTable';
import { EventMenu } from '../components/EventMenu';
import { ErrorBox, Loading, useUi } from '../components/ui';
import { errorMessage, get, post } from '../lib/api';
import { formatDateTime, relative } from '../lib/format';
import { CONDITION_LABELS, EVENT_LABELS, LEVEL_LABELS, label } from '../lib/labels';
import { qk } from '../lib/sse';

/** Lọc dòng tổng quan (SPEC-07 §4.1). Hàm thuần để test. */
export function filterRows(rows: OverviewRow[], f: { platform: string; level: string; pausedOnly: boolean }): OverviewRow[] {
  return rows.filter((r) => (f.platform === '' || r.binding.platform === f.platform) && (f.level === '' || String(r.binding.level) === f.level) && (!f.pausedOnly || r.openPauses.length > 0));
}

export function usePromote() {
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const m = useMutation({
    mutationFn: (id: string) => post<LevelChange>(`/internal/bindings/${id}/promote`),
    onSuccess: (c) => {
      toast(`Đã lên ${label(LEVEL_LABELS, c.toLevel)}`);
      for (const k of [qk.overview, qk.binding(c.bindingId), qk.readiness(c.bindingId)]) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  return async (row: { id: string; displayName: string; level: number }) => {
    const ok = await confirm({
      title: `Lên ${label(LEVEL_LABELS, row.level + 1)}?`,
      body: (
        <p>
          Kênh <strong>{row.displayName}</strong> sẽ chuyển từ {label(LEVEL_LABELS, row.level)} lên {label(LEVEL_LABELS, row.level + 1)}. Hệ thống được phép làm nhiều hơn trên profile này (ví dụ L1: tự mở Studio kiểm phiên theo lịch). Cửa sổ quan sát của mức mới bắt đầu từ bây giờ.
        </p>
      ),
      confirmLabel: 'Lên mức',
    });
    if (ok) m.mutate(row.id);
  };
}

export function OverviewTable({ rows }: { rows: OverviewRow[] }) {
  const promote = usePromote();
  const columns = useMemo<ColumnDef<OverviewRow, unknown>[]>(
    () => [
      {
        id: 'channel',
        header: 'Kênh',
        accessorFn: (r) => r.binding.displayName,
        cell: ({ row: { original: r } }) => (
          <div>
            <Link to={`/bindings/${r.binding.id}`}>
              <strong>{r.binding.displayName}</strong>
            </Link>
            <div className="muted small">
              {r.binding.platform} · {r.binding.accountId} · profile {r.binding.furyProfileId}
            </div>
          </div>
        ),
      },
      {
        id: 'level',
        header: 'Mức',
        accessorFn: (r) => r.binding.level,
        cell: ({ row: { original: r } }) => (
          <div>
            <LevelBadge level={r.binding.level} />
            <div className="muted small">{r.daysAtLevel} ngày</div>
          </div>
        ),
      },
      {
        id: 'progress',
        header: 'Tiến độ',
        accessorFn: (r) => r.readiness.progress ?? -1,
        cell: ({ row: { original: r } }) =>
          r.readiness.nextLevel === null ? (
            <span className="muted">Mức cao nhất</span>
          ) : (
            <div>
              <Progress value={r.readiness.progress} />
              {r.readiness.missing.length > 0 && <div className="muted small">còn thiếu: {r.readiness.missing.slice(0, 2).map((k) => label(CONDITION_LABELS, k)).join(', ')}</div>}
            </div>
          ),
      },
      {
        id: 'pauses',
        header: 'Dừng',
        accessorFn: (r) => r.openPauses.length,
        cell: ({ row: { original: r } }) => (r.openPauses.length === 0 ? <span className="muted">—</span> : r.openPauses.map((p) => <PauseChip key={p.id} reason={p.reason} />)),
      },
      {
        id: 'red',
        header: 'Cờ đỏ gần nhất',
        accessorFn: (r) => r.lastRed?.at ?? '',
        cell: ({ row: { original: r } }) =>
          r.lastRed ? (
            <Link to={`/bindings/${r.binding.id}?tab=timeline`} className="red">
              {label(EVENT_LABELS, r.lastRed.type)}
              <div className="small">{relative(r.lastRed.at)}</div>
            </Link>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        id: 'consistency',
        header: 'Điểm nhất quán',
        accessorFn: (r) => (r.consistency ? r.consistency.passed / Math.max(1, r.consistency.total) : -1),
        cell: ({ row: { original: r } }) =>
          r.consistency ? (
            <Link to={`/bindings/${r.binding.id}?tab=consistency`}>
              {r.consistency.passed}/{r.consistency.total}
              {(r.consistency.blockFailing > 0 || r.consistency.blockUnknown > 0) && (
                <div className="small red">
                  chặn: {r.consistency.blockFailing} trượt · {r.consistency.blockUnknown} chưa rõ
                </div>
              )}
            </Link>
          ) : (
            <span className="muted">chưa kiểm</span>
          ),
      },
      {
        id: 'exit',
        header: 'Exit',
        enableSorting: false,
        cell: ({ row: { original: r } }) =>
          r.exit ? (
            <div>
              {r.exit.country ?? '?'} · AS{r.exit.asn ?? '?'}
              <div className="muted small">{relative(r.exit.checkedAt)}</div>
            </div>
          ) : (
            <span className="muted">chưa kiểm</span>
          ),
      },
      {
        id: 'fury',
        header: 'Fury',
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <div>
            {r.fury.version ?? '?'}
            <div className={r.fury.detectSuitePassed ? 'small green' : 'small red'}>detect-suite {r.fury.detectSuitePassed ? 'đạt' : 'chưa'}</div>
          </div>
        ),
      },
      {
        id: 'actions',
        header: 'Hành động',
        enableSorting: false,
        cell: ({ row: { original: r } }) => (
          <div className="row-actions">
            <EventMenu bindingId={r.binding.id} compact />
            <button className="small primary" disabled={!r.readiness.canPromote} title={r.readiness.canPromote ? 'Đạt ngưỡng' : 'Chưa đạt ngưỡng'} onClick={() => void promote(r.binding)}>
              Lên mức
            </button>
            <Link to={`/bindings/${r.binding.id}`} className="button small">
              Chi tiết
            </Link>
          </div>
        ),
      },
    ],
    [promote],
  );
  return <DataTable data={rows} columns={columns} empty="Chưa gắn kênh nào. Bấm “Gắn kênh mới”." initialSort={[{ id: 'progress', desc: true }]} rowClass={(r) => (r.openPauses.length > 0 ? 'row-paused' : undefined)} />;
}

export default function Overview() {
  const q = useQuery({ queryKey: qk.overview, queryFn: () => get<OverviewData>('/internal/overview'), refetchInterval: 60_000 });
  const [f, setF] = useState({ platform: '', level: '', pausedOnly: false });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows = q.data?.rows ?? [];
  const platforms = [...new Set(rows.map((r) => r.binding.platform))];
  return (
    <div>
      <div className="page-head">
        <h1>Tổng quan</h1>
        <Link to="/bindings/new" className="button primary">
          + Gắn kênh mới
        </Link>
      </div>
      <div className="filters">
        <select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
          <option value="">Mọi nền tảng</option>
          {platforms.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
          <option value="">Mọi mức</option>
          {[0, 1, 2, 3].map((l) => (
            <option key={l} value={l}>
              {label(LEVEL_LABELS, l)}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={f.pausedOnly} onChange={(e) => setF({ ...f, pausedOnly: e.target.checked })} /> Đang dừng
        </label>
        <span className="muted small">Cập nhật {formatDateTime(q.data?.now)}</span>
      </div>
      <OverviewTable rows={filterRows(rows, f)} />
    </div>
  );
}
