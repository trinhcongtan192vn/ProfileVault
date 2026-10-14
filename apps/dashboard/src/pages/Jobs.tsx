import { useAction } from '../components/ui';
import type { JobRecord, RunRecord } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Section } from '../components/bits';
import { DataTable } from '../components/DataTable';
import { Empty, ErrorBox, Loading, useUi } from '../components/ui';
import { errorMessage, get, post } from '../lib/api';
import { formatDateTime, json } from '../lib/format';
import { RUN_STATUS_LABELS, label } from '../lib/labels';
import { qk } from '../lib/sse';
import { GateButtons } from './Inbox';

export function Jobs() {
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: [...qk.jobs, status], queryFn: () => get<{ jobs: JobRecord[] }>(`/internal/jobs?limit=200${status ? `&status=${status}` : ''}`) });
  const columns = useMemo<ColumnDef<JobRecord, unknown>[]>(
    () => [
      { header: 'Tạo lúc', accessorKey: 'createdAt', cell: (c) => formatDateTime(c.getValue() as string) },
      { header: 'Client', accessorKey: 'clientId' },
      { header: 'Flow', accessorKey: 'flowId' },
      { header: 'Kênh', accessorKey: 'bindingId', cell: (c) => <Link to={`/bindings/${String(c.getValue())}`}>{String(c.getValue())}</Link> },
      { header: 'Chế độ', accessorKey: 'mode', cell: (c) => (c.getValue() as string | null) ?? '—' },
      { header: 'Trạng thái', accessorKey: 'status', cell: (c) => label(RUN_STATUS_LABELS, c.getValue() as string) },
      { header: 'Kết quả / lỗi', id: 'result', cell: ({ row: { original: j } }) => (j.errorCode ? <span className="red">{j.errorCode}</span> : <span className="mono small">{json(j.result)}</span>) },
    ],
    [],
  );
  return (
    <div>
      <h1>Job &amp; run</h1>
      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Mọi trạng thái</option>
          {['queued', 'running', 'needs_user', 'done', 'failed', 'cancelled', 'rejected'].map((s) => (
            <option key={s} value={s}>
              {label(RUN_STATUS_LABELS, s)}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : <DataTable data={q.data?.jobs ?? []} columns={columns} empty="Chưa có job nào (Runner tạo job khi có lịch session-check ở L1)." />}
    </div>
  );
}

export function RunDetail() {
  const action = useAction();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const q = useQuery({ queryKey: qk.run(id), queryFn: () => get<RunRecord>(`/internal/runs/${id}`), refetchInterval: 10_000 });
  const cancel = useMutation({ mutationFn: () => post(`/internal/runs/${id}/cancel`), onSuccess: () => (toast('Đã yêu cầu hủy'), void qc.invalidateQueries({ queryKey: qk.run(id) })), onError: (e) => toast(errorMessage(e), { kind: 'error' }) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? 'Không có run'} />;
  const r = q.data;
  const finished = ['done', 'failed', 'cancelled'].includes(r.status);
  return (
    <div>
      <div className="page-head">
        <h1>
          Run {r.flowId} <span className="chip">{label(RUN_STATUS_LABELS, r.status)}</span>
        </h1>
        {!finished && <button className="danger" onClick={action(async () => (await confirm({ title: 'Hủy run?', body: 'Run dừng sau bước hiện tại; bước không chạy lại được sẽ được chạy hết.', danger: true })) && cancel.mutate())}>Hủy</button>}
      </div>
      <p className="muted">
        Kênh <Link to={`/bindings/${r.bindingId}`}>{r.bindingId}</Link> · phiên bản flow {r.flowVersion} · lần thử {r.attempt} · xếp hàng {formatDateTime(r.queuedAt)} · bắt đầu {formatDateTime(r.startedAt)} · kết thúc {formatDateTime(r.finishedAt)}
      </p>
      {r.errorCode && (
        <p className="error">
          Lỗi {r.errorCode} <span className="mono small">{json(r.errorDetail)}</span>
        </p>
      )}
      {r.needsUser && (
        <Section title="Đang chờ bạn">
          <p>{r.needsUser.message}</p>
          <GateButtons runId={r.id} choices={r.needsUser.choices} />
        </Section>
      )}
      <Section title="Các bước">
        {r.steps.length === 0 ? (
          <Empty>Chưa có bước nào.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Bước</th>
                <th>Trạng thái</th>
                <th>Số lần thử</th>
                <th>Bắt đầu</th>
                <th>Kết thúc</th>
                <th>Mã lỗi</th>
              </tr>
            </thead>
            <tbody>
              {r.steps.map((s) => (
                <tr key={s.seq} className={s.status === 'failed' ? 'row-red' : undefined}>
                  <td>{s.seq}</td>
                  <td>{s.name}</td>
                  <td>{s.status}</td>
                  <td>{s.attempts}</td>
                  <td>{formatDateTime(s.startedAt)}</td>
                  <td>{formatDateTime(s.finishedAt)}</td>
                  <td>{s.errorCode ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Log và artifact">
        {(r.logTail ?? []).length > 0 && <pre className="log">{r.logTail!.join('\n')}</pre>}
        <p>
          <a href={`/internal/runs/${r.id}/artifacts/log.ndjson`}>Tải log.ndjson</a>
          {r.steps
            .filter((s) => s.status === 'failed')
            .map((s) => (
              <span key={s.seq}>
                {' · '}
                <a href={`/internal/runs/${r.id}/artifacts/trace-${s.name}.zip`}>trace {s.name}</a> · <a href={`/internal/runs/${r.id}/artifacts/screenshot-${s.name}.png`}>ảnh {s.name}</a>
              </span>
            ))}
        </p>
      </Section>
      {r.input !== undefined && (
        <Section title="Đầu vào">
          <pre className="mono small">{JSON.stringify(r.input, null, 2)}</pre>
        </Section>
      )}
    </div>
  );
}
