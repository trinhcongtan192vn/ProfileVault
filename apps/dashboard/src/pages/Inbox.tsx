import { useAction } from '../components/ui';
import type { InboxItem } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Loading, useUi } from '../components/ui';
import { errorMessage, get, post } from '../lib/api';
import { formatDateTime, json, relative } from '../lib/format';
import { INBOX_KIND_LABELS, label } from '../lib/labels';
import { qk } from '../lib/sse';

/** Đường dẫn xử lý cho từng loại mục (SPEC-07 §4.4). */
export function inboxLink(item: InboxItem): string {
  switch (item.kind) {
    case 'run':
      return `/runs/${String(item.data.runId)}`;
    case 'pause':
      return `/bindings/${item.bindingId ?? ''}`;
    case 'checklist_expiring':
      return `/bindings/${item.bindingId ?? ''}?tab=checklist`;
    case 'asn_unclassified':
      return '/settings?section=asn';
    case 'fury_no_detect_suite':
      return '/settings?section=detect';
  }
}

export function GateButtons({ runId, choices }: { runId: string; choices: { id: string; label: string }[] }) {
  const action = useAction();
  const qc = useQueryClient();
  const { toast, confirm } = useUi();
  const m = useMutation({
    mutationFn: (choice: string) => post(`/internal/runs/${runId}/resolve`, { choice }),
    onSuccess: () => {
      toast('Đã gửi lựa chọn');
      for (const k of [qk.inbox, qk.jobs, qk.run(runId)]) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  return (
    <span className="row-actions">
      {choices.map((c) => (
        <button key={c.id} className={c.id === 'cancel' ? 'small danger' : 'small primary'} disabled={m.isPending} onClick={action(async () => (await confirm({ title: c.label, body: 'Gửi lựa chọn này cho run?' })) && m.mutate(c.id))}>
          {c.label}
        </button>
      ))}
    </span>
  );
}

export default function Inbox() {
  const q = useQuery({ queryKey: qk.inbox, queryFn: () => get<{ items: InboxItem[] }>('/internal/inbox') });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const items = q.data?.items ?? [];
  return (
    <div>
      <h1>Chờ bạn</h1>
      {items.length === 0 ? (
        <Empty>Không có việc nào chờ bạn.</Empty>
      ) : (
        <ul className="inbox">
          {items.map((it, i) => (
            <li key={i} className={`inbox-item kind-${it.kind}`}>
              <div>
                <span className="chip">{label(INBOX_KIND_LABELS, it.kind)}</span> <strong>{it.bindingName ?? 'Hệ thống'}</strong> — {it.title}
                <div>{it.message}</div>
                {it.run?.needsUser?.summary && <div className="mono small">{json(it.run.needsUser.summary)}</div>}
                <div className="muted small">
                  {formatDateTime(it.at)} ({relative(it.at)})
                  {it.run?.needsUser?.expiresAt && <> · hết hạn {formatDateTime(it.run.needsUser.expiresAt)}</>}
                </div>
              </div>
              <div className="row-actions">
                {it.kind === 'run' && it.run?.needsUser && <GateButtons runId={it.run.id} choices={it.run.needsUser.choices} />}
                <Link to={inboxLink(it)} className="button small">
                  Mở
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
