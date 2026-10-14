import { BUS_EVENTS, PvError, type BusEventMap, type BusEventName } from '@sctech/profilevault-contract';

export type BusListener<K extends BusEventName> = (payload: BusEventMap[K]) => void | Promise<void>;

export interface EventBusOptions {
  /** Nhận lỗi từ listener (mặc định ghi `console.error`). */
  onListenerError?: (event: BusEventName, err: unknown) => void;
}

/**
 * Bus sự kiện nội bộ có kiểm kiểu (SPEC-00 §10): payload kiểm bằng Zod trước khi phát;
 * lỗi của một listener không chặn listener khác.
 */
export class EventBus {
  private readonly listeners = new Map<BusEventName, Set<BusListener<BusEventName>>>();
  private readonly onListenerError: (event: BusEventName, err: unknown) => void;

  constructor(opts: EventBusOptions = {}) {
    this.onListenerError =
      opts.onListenerError ??
      ((event, err) => {
        console.error(`[event-bus] listener của ${event} lỗi:`, err);
      });
  }

  on<K extends BusEventName>(event: K, listener: BusListener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as BusListener<BusEventName>);
    return () => this.off(event, listener);
  }

  once<K extends BusEventName>(event: K, listener: BusListener<K>): () => void {
    const wrapped: BusListener<K> = (payload) => {
      this.off(event, wrapped);
      return listener(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends BusEventName>(event: K, listener: BusListener<K>): void {
    this.listeners.get(event)?.delete(listener as BusListener<BusEventName>);
  }

  listenerCount(event: BusEventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Phát sự kiện; payload sai schema → `PvError('INPUT_INVALID')`, không listener nào được gọi. */
  emit<K extends BusEventName>(event: K, payload: BusEventMap[K]): void {
    const schema = BUS_EVENTS[event];
    const r = schema.safeParse(payload);
    if (!r.success) {
      throw new PvError('INPUT_INVALID', `payload sự kiện ${event} sai schema`, {
        event,
        issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        const out = listener(r.data);
        if (out instanceof Promise) {
          out.catch((err: unknown) => this.onListenerError(event, err));
        }
      } catch (err) {
        this.onListenerError(event, err);
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
