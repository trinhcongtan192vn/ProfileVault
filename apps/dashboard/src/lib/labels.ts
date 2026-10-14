/** Nhãn tiếng Việt cố định (SPEC-07 §2). */

export const LEVEL_LABELS: Record<number, string> = { 0: 'L0 Thủ công', 1: 'L1 Quan sát', 2: 'L2 Bán tự động', 3: 'L3 Tự động' };

export const PAUSE_REASON_LABELS: Record<string, string> = {
  red_event: 'Cờ đỏ tài khoản',
  proxy_changed: 'Exit proxy đổi',
  detect_suite_failed: 'Detect-suite chưa đạt',
  consistency_block: 'Luật nhất quán chặn trượt',
  duplicate_exit_ip: 'Trùng exit IP',
  manual: 'Tạm dừng tay',
};

/** Lý do dừng người gỡ được (SPEC-02 §4.1 R1, R2, R7). */
export const USER_CLEARABLE = new Set(['red_event', 'proxy_changed', 'manual']);

export const EVENT_LABELS: Record<string, string> = {
  'manual.upload': 'Đã upload',
  'manual.verification_request': 'Yêu cầu xác minh',
  'manual.captcha': 'CAPTCHA',
  'manual.platform_warning': 'Cảnh báo từ nền tảng',
  'manual.logged_out': 'Bị đăng xuất',
  'manual.note': 'Ghi chú',
  'fury.profile_opened': 'Profile được mở',
  'fury.profile_closed': 'Profile được đóng',
  'fury.version_changed': 'Fury đổi phiên bản',
  'proxy.country_changed': 'Exit đổi quốc gia',
  'proxy.asn_changed': 'Exit đổi ASN',
  'proxy.check_failed': 'Kiểm proxy lỗi',
  'session_check.ok': 'Session-check đạt',
  'session_check.logged_out': 'Session-check: đăng xuất',
  'session_check.wrong_account': 'Session-check: sai tài khoản',
  'session_check.failed': 'Session-check lỗi kỹ thuật',
  'probe.imported': 'Nhập probe',
  'detect_suite.recorded': 'Kết quả detect-suite',
  'run.done': 'Run xong',
  'run.failed': 'Run lỗi',
  'run.needs_user': 'Run chờ bạn',
  'run.challenge': 'Run gặp CAPTCHA/xác minh',
  'flow.site_changed': 'Giao diện nền tảng đổi',
  'level.promoted': 'Lên mức',
  'level.demoted': 'Hạ mức',
  'binding.paused': 'Dừng',
  'binding.resumed': 'Gỡ dừng',
};

export const CONDITION_LABELS: Record<string, string> = {
  days_at_level: 'Số ngày ở mức',
  event_count: 'Số sự kiện',
  no_red_events: 'Không có cờ đỏ',
  session_check_rate: 'Tỉ lệ session-check',
  proxy_stable: 'Exit proxy ổn định',
  detect_suite_pass: 'Detect-suite đạt',
  consistency_clear: 'Nhất quán: không luật chặn trượt',
  checklist_valid: 'Checklist còn hạn',
  flow_success_rate: 'Tỉ lệ flow thành công',
  l2_correct_rate: 'Tỉ lệ điền đúng (L2)',
  event_count_by_mode: 'Số upload theo chế độ',
  no_open_site_changed: 'Không còn SITE_CHANGED',
};

export const LAYER_LABELS: Record<string, string> = {
  A: 'A. Profile ↔ mạng',
  B: 'B. Profile ↔ máy chạy',
  C: 'C. Profile ↔ tài khoản',
  D: 'D. Giữa các profile',
  E: 'E. Theo thời gian',
};

export const RULE_STATUS_LABELS: Record<string, string> = { pass: 'Đạt', fail: 'Trượt', unknown: 'Chưa rõ', info: 'Thông tin', skipped: 'Bỏ qua' };
export const SEVERITY_LABELS: Record<string, string> = { block: 'Chặn', warn: 'Cảnh báo', info: 'Thông tin' };

export const RUN_STATUS_LABELS: Record<string, string> = {
  queued: 'Đang đợi',
  waiting_profile: 'Chờ profile rảnh',
  launching: 'Đang mở profile',
  running: 'Đang chạy',
  needs_user: 'Chờ bạn',
  finalizing: 'Đang kết thúc',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
  rejected: 'Bị từ chối',
};

export const CHART_LABELS: Record<string, string> = {
  uploads_by_mode: 'Upload theo chế độ',
  success_rates: 'Tỉ lệ thành công',
  needs_user_by_reason: 'Chờ người theo lý do',
  session_age: 'Tuổi phiên (ngày)',
  exit_timeline: 'Exit proxy theo thời gian',
  detect_suite_timeline: 'Detect-suite theo phiên bản Fury',
  consistency_score: 'Điểm nhất quán',
};

export const INBOX_KIND_LABELS: Record<string, string> = {
  run: 'Run chờ bạn',
  pause: 'Dừng chờ gỡ',
  checklist_expiring: 'Checklist sắp hết hạn',
  asn_unclassified: 'ASN chưa phân loại',
  fury_no_detect_suite: 'Thiếu detect-suite',
};

export const SCOPE_LABELS: Record<string, string> = {
  'accounts.read': 'Xem tài khoản',
  'jobs.read': 'Xem job',
  'jobs.write': 'Gửi/hủy job',
  'ops.read': 'Đọc dashboard',
  'ops.write': 'Thao tác vận hành',
};

export function label(map: Record<string, string>, key: string | number | null | undefined): string {
  if (key === null || key === undefined) return '—';
  return map[String(key)] ?? String(key);
}
