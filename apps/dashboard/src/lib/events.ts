/** Menu khai báo một chạm (SPEC-07 §5). */

export interface OneTapEvent {
  type: string;
  label: string;
  /** Sự kiện đỏ: cần hộp xác nhận, hạ mức về L0 (SPEC-02 R1). */
  red: boolean;
  undoable: boolean;
}

export const ONE_TAP_EVENTS: OneTapEvent[] = [
  { type: 'manual.upload', label: 'Đã upload', red: false, undoable: true },
  { type: 'manual.verification_request', label: 'Yêu cầu xác minh', red: true, undoable: false },
  { type: 'manual.captcha', label: 'CAPTCHA', red: true, undoable: false },
  { type: 'manual.platform_warning', label: 'Cảnh báo từ nền tảng', red: true, undoable: false },
  { type: 'manual.logged_out', label: 'Bị đăng xuất', red: true, undoable: false },
  { type: 'manual.note', label: 'Ghi chú', red: false, undoable: true },
];

export const RED_CONSEQUENCE = 'Kênh sẽ về L0 và dừng mọi job cho tới khi bạn bấm "Đã xử lý".';
export const UNDO_SECONDS = 10;
export const MAX_BACKDATE_DAYS = 7;

export function findEvent(type: string): OneTapEvent | undefined {
  return ONE_TAP_EVENTS.find((e) => e.type === type);
}

/** Kiểm thời điểm khai báo: không quá 7 ngày lùi, không ở tương lai (SPEC-02 §5). */
export function validateOccurredAt(iso: string, now: number = Date.now()): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Thời điểm không hợp lệ';
  if (now - t > MAX_BACKDATE_DAYS * 86_400_000) return 'Chỉ được khai lùi tối đa 7 ngày';
  if (t - now > 5 * 60_000) return 'Thời điểm ở tương lai';
  return null;
}

/** Phím tắt trang chi tiết: `U` = Đã upload (bỏ qua khi đang gõ trong ô nhập). */
export function shortcutFor(key: string, targetTag: string | undefined, modifiers: boolean): string | null {
  if (modifiers) return null;
  if (targetTag && ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag.toUpperCase())) return null;
  return key === 'u' || key === 'U' ? 'manual.upload' : null;
}
