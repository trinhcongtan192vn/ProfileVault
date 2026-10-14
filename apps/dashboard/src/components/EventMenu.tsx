import type { HealthEventRecord } from '@sctech/profilevault-contract';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, post } from '../lib/api';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { ONE_TAP_EVENTS, RED_CONSEQUENCE, validateOccurredAt, type OneTapEvent } from '../lib/events';
import { qk } from '../lib/sse';
import { Modal, useUi } from './ui';

/** Khai báo sự kiện một chạm (SPEC-07 §5). */
export function useRecordEvent(bindingId: string) {
  const qc = useQueryClient();
  const { toast } = useUi();
  const undo = useMutation({
    mutationFn: (eventId: string) => post<HealthEventRecord>(`/internal/bindings/${bindingId}/events/${eventId}/undo`),
    onSuccess: () => {
      toast('Đã hoàn tác (ghi sự kiện bù).', { kind: 'info' });
      void qc.invalidateQueries({ queryKey: qk.overview });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  return useMutation({
    mutationFn: (v: { event: OneTapEvent; occurredAt?: string; note?: string }) => post<HealthEventRecord>(`/internal/bindings/${bindingId}/events`, { type: v.event.type, occurredAt: v.occurredAt, note: v.note }),
    onSuccess: (rec, v) => {
      toast(`Đã ghi: ${v.event.label}`, v.event.undoable ? { action: { label: 'Hoàn tác', run: () => undo.mutate(rec.id) } } : { kind: v.event.red ? 'error' : 'ok' });
      for (const key of [qk.overview, qk.events(bindingId), qk.readiness(bindingId), qk.pauses(bindingId), qk.binding(bindingId), qk.inbox]) void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
}

export function EventMenu({ bindingId, compact }: { bindingId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<OneTapEvent | null>(null);
  const record = useRecordEvent(bindingId);

  const choose = (e: OneTapEvent) => {
    setOpen(false);
    if (e.red || e.type === 'manual.note') setDialog(e);
    else record.mutate({ event: e });
  };

  return (
    <span className="menu">
      <button className={compact ? 'small' : undefined} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        + Sự kiện
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {ONE_TAP_EVENTS.map((e) => (
            <button key={e.type} role="menuitem" className={e.red ? 'menu-item red' : 'menu-item'} onClick={() => choose(e)}>
              {e.red ? '● ' : ''}
              {e.label}
            </button>
          ))}
        </div>
      )}
      {dialog && <EventDialog event={dialog} onClose={() => setDialog(null)} onSubmit={(occurredAt, note) => record.mutate({ event: dialog, occurredAt, note }, { onSuccess: () => setDialog(null) })} />}
    </span>
  );
}

function EventDialog({ event, onClose, onSubmit }: { event: OneTapEvent; onClose: () => void; onSubmit: (occurredAt: string | undefined, note: string | undefined) => void }) {
  const [when, setWhen] = useState(toLocalInput(new Date().toISOString()));
  const [note, setNote] = useState('');
  const iso = fromLocalInput(when);
  const err = validateOccurredAt(iso);
  return (
    <Modal title={event.label} onClose={onClose}>
      {event.red && <p className="warning">{RED_CONSEQUENCE}</p>}
      <label className="field">
        Thời điểm (tối đa lùi 7 ngày)
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <label className="field">
        Ghi chú
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {err && <p className="error">{err}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>Hủy</button>
        <button className={event.red ? 'danger' : 'primary'} disabled={!!err || (event.type === 'manual.note' && note.trim() === '')} onClick={() => onSubmit(iso, note.trim() || undefined)}>
          {event.red ? 'Xác nhận và hạ về L0' : 'Ghi'}
        </button>
      </div>
    </Modal>
  );
}
