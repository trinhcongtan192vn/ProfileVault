import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** Thông báo ngắn + hộp xác nhận dùng chung (SPEC-07 §2: hành động có hệ quả cần xác nhận). */

interface ToastItem {
  id: number;
  message: string;
  kind: 'ok' | 'error' | 'info';
  action?: { label: string; run: () => void };
  ttlMs: number;
}

interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiApi {
  toast: (message: string, opts?: { kind?: ToastItem['kind']; action?: ToastItem['action']; ttlMs?: number }) => void;
  confirm: (req: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
}

const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi ngoài UiProvider');
  return ctx;
}

/** Bắt lỗi của thao tác bất đồng bộ từ sự kiện DOM. */
export function useAction() {
  const { toast } = useUi();
  return (fn: () => Promise<unknown>) => () => { void fn().catch((err: unknown) => toast(err instanceof Error ? err.message : String(err), { kind: 'error' })); };
}

let nextId = 1;

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);

  const toast = useCallback<UiApi['toast']>((message, opts = {}) => {
    const item: ToastItem = { id: nextId++, message, kind: opts.kind ?? 'ok', action: opts.action, ttlMs: opts.ttlMs ?? (opts.action ? 10_000 : 4_000) };
    setToasts((t) => [...t, item]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== item.id)), item.ttlMs);
  }, []);

  const confirm = useCallback<UiApi['confirm']>((req) => new Promise<boolean>((resolve) => setConfirmReq({ ...req, resolve })), []);

  const close = (ok: boolean) => {
    confirmReq?.resolve(ok);
    setConfirmReq(null);
  };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="link"
                onClick={() => {
                  t.action?.run();
                  setToasts((all) => all.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {confirmReq && (
        <Modal title={confirmReq.title} onClose={() => close(false)}>
          <div className="modal-body">{confirmReq.body}</div>
          <div className="modal-actions">
            <button onClick={() => close(false)}>Hủy</button>
            <button className={confirmReq.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {confirmReq.confirmLabel ?? 'Xác nhận'}
            </button>
          </div>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Loading() {
  return <p className="muted">Đang tải…</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <p className="error">Lỗi: {msg}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted empty">{children}</p>;
}
