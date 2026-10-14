# Feature Specification: Dashboard, tray, toast (006)

**Feature Branch**: `006-dashboard-tray`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Triển khai apps/dashboard + tray + toast: 8 trang, wizard gắn kênh, khai báo một chạm, biểu đồ, Chờ bạn, Cài đặt theo SPEC-07. Tài liệu đó là nguồn sự thật; spec.md chỉ chốt phạm vi feature này, liệt kê yêu cầu PRD liên quan và trỏ tới mục của spec gốc, không chép lại toàn bộ."

**Spec gốc (nguồn sự thật)**: `docs/specs/SPEC-07-dashboard.md` toàn bộ (§2 nguyên tắc giao diện, §3 điều hướng 8 trang + thanh trên, §4.1–4.8 các trang, §5 khai báo một chạm, §6 tray, §7 toast, §8 dữ liệu biểu đồ, §9 nghiệm thu). Dữ liệu qua `/internal/*` (SPEC-05 §7, feature 005). PRD §8 (dashboard độ sẵn sàng), F2, F7, F12, §7.2–7.6, §13 (nhắc khai báo hằng ngày).

## Clarifications

### Session 2026-10-14

- Q: "Hoàn tác" khai báo một chạm (§5) = "ghi sự kiện bù, không xóa" — sự kiện bù là gì và ngưỡng có trừ không? → A: Ghi `manual.note` với `payload.undoOf = <eventId>` qua `POST /internal/bindings/:id/events/:eventId/undo` (chỉ `manual.upload`/`manual.note`, trong 10 phút theo đồng hồ server); điều kiện `event_count` của ngưỡng bỏ qua sự kiện đã bị hoàn tác. `health_events` vẫn chỉ thêm.
- Q: Tổng quan cần nhiều dữ liệu cho mỗi dòng (readiness, dừng, cờ đỏ, điểm, exit, Fury) — gọi N endpoint? → A: Thêm endpoint tổng hợp `GET /internal/overview` (một dòng/binding) và `GET /internal/inbox` (mục Chờ bạn ngoài run) trong gateway; dữ liệu lấy từ HealthService, không thêm logic nghiệp vụ mới.
- Q: Kiểm thử UI khi không có jsdom/Playwright cho dashboard ở M0? → A: Test thuần (định dạng, ánh xạ SSE → khóa cache, logic menu sự kiện/hoàn tác, ánh xạ trạng thái tray/toast) bằng Vitest node; dựng các trang chính bằng `react-dom/server` `renderToString` với dữ liệu mẫu để bắt lỗi render; nghiệm thu UI thủ công theo SPEC-09 (AT-M0-1, AT-M0-2 "Integration + thủ công").
- Q: Tray "Thoát" phải "hỏi xác nhận nếu có run đang chạy" nhưng menu khay không có hộp thoại? → A: Lần bấm đầu đổi nhãn thành "Thoát? Có N run đang chạy — bấm lại để xác nhận" trong 10 giây; bấm lần hai thì hủy an toàn và thoát.
- Q: Biểu tượng tray đổi màu cần file icon? → A: Sinh 4 icon `.ico` 16×16 (xám, xanh, cam, đỏ) bằng mã (không thêm file nhị phân vào repo).
- Q: Khởi động cùng Windows? → A: `reg add/delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v ProfileVault` trỏ tới lệnh khởi động hiện tại (`node.exe <main.js>`); trình cài NSIS (SPEC-00 §11) thay sau.

## Phạm vi

**Trong phạm vi:** `apps/dashboard` (React 19 + Vite + React Router + TanStack Query/Table + Recharts): 8 trang SPEC-07 §3, thanh trên, SSE cập nhật thời gian thực, khai báo một chạm + hoàn tác + phím `U`, hộp xác nhận cho hành động có hệ quả, wizard 6 bước, biểu đồ 7 loại, Chờ bạn, Job/run (dữ liệu từ Runner facade, rỗng tới 007), Hệ thống (ma trận chéo), Lịch, Cài đặt 8 mục, giao diện sáng/tối theo hệ thống; gateway: `/internal/overview`, `/internal/inbox`, undo; `apps/service`: tray (`systray2`) và notifier (`node-notifier`) theo §6, §7.

**Ngoài phạm vi:** Runner thật (007) — các trang job/run/lịch hiển thị dữ liệu facade; MCP/API v1 (M1); trình cài NSIS.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tổng quan và khai báo một chạm (Priority: P1)

Người vận hành mở dashboard từ tray, thấy mọi kênh với mức, tiến độ, dừng, cờ đỏ, điểm nhất quán, exit, Fury; khai báo sự kiện một chạm, thấy ngay trên dòng thời gian.

**Independent Test**: `/internal/overview` + test render; thủ công AT-M0-2.

**Acceptance Scenarios**:
1. **Given** 2 binding, **When** mở `/`, **Then** bảng 2 dòng với cột SPEC-07 §4.1; lọc theo nền tảng/mức/đang dừng; sắp xếp theo tiến độ/cờ đỏ; "Lên mức" chỉ bật khi `canPromote`.
2. **Given** bấm "+ Sự kiện" → "Đã upload", **Then** ghi ngay, thông báo "Đã ghi" + "Hoàn tác" 10 giây; hoàn tác ghi sự kiện bù; dòng thời gian cập nhật qua SSE không tải lại.
3. **Given** "CAPTCHA", **Then** hộp xác nhận nêu "Kênh sẽ về L0 và dừng mọi job", có ô thời điểm (≤ 7 ngày lùi) và ghi chú; xác nhận → mức về L0, dòng tổng quan cập nhật.
4. **Given** trang chi tiết, **When** nhấn `U`, **Then** ghi "Đã upload".

### User Story 2 - Chi tiết kênh, wizard, Chờ bạn (Priority: P1)

**Acceptance Scenarios**:
1. Chi tiết: đầu trang (mức, Lên mức/Tạm dừng/Tiếp tục, dừng đang mở + nút gỡ cho R1/R2/R7); 7 thẻ §4.2; thẻ Ngưỡng chỉ đúng điều kiện thiếu; thẻ Nhất quán bảng 22 luật theo lớp + "Kiểm tra lại" + so sánh probe; Checklist không hiển thị lại email/số; Probe kéo thả file.
2. Wizard 6 bước §4.3: profile (ẩn đã gắn) → tài khoản → cấu hình pack + thư mục → checklist → probe (bỏ qua được) → kết quả kiểm nhất quán + gợi ý; binding tạo ở L0.
3. Chờ bạn: run `needs_user` (từ facade) với nút lựa chọn gate; dừng chờ gỡ; checklist sắp hết hạn; ASN chưa phân loại; phiên bản Fury chưa có detect-suite.

### User Story 3 - Hệ thống, Lịch, Cài đặt, Job (Priority: P2)

**Acceptance Scenarios**:
1. Hệ thống: ma trận chéo tô đỏ cặp trùng exit IP/khôi phục, vàng dải mạng/ASN+persona; hàng đợi, profile đang chạy, RAM, chế độ bận, pack.
2. Cài đặt: Kết nối Fury (token, năng lực), Ngưỡng (sửa + lịch sử), Luật (bật/tắt, mức, tham số), Detect-suite, ASN, Runner, Ứng dụng kết nối (token hiển thị một lần, thu hồi), Xuất CSV.
3. Lịch/Job/Run: danh sách và thao tác qua facade; thông báo "Runner chưa sẵn sàng" khi facade trả `FLOW_DISABLED`.

### User Story 4 - Tray và toast (Priority: P2)

**Acceptance Scenarios**:
1. Menu tray: Mở dashboard (mở trình duyệt tới URL `/auth/open`), trạng thái chỉ đọc (Fury, Đang chạy N, Chờ bạn M), Chế độ bận, Tạm dừng mọi job, Khởi động cùng Windows, Thoát (xác nhận khi có run).
2. Màu icon: xám Fury offline; đỏ có kênh bị hạ mức trong 24 giờ; cam có việc chờ; xanh bình thường.
3. Toast §7: needs_user, hạ mức/dừng R1–R5, đạt ngưỡng (≤ 1/ngày/kênh), L2 sẵn sàng, nhắc khai báo lúc `ui.dailyReminderLocalTime`, checklist sắp hết hạn, Fury offline > 10 phút/phiên bản ngoài khoảng; không trùng nội dung trong 30 phút.

### Edge Cases
- Phiên hết hạn trong lúc dùng → API 401 → trang báo "Mở lại dashboard từ tray".
- SSE mất kết nối → EventSource tự nối lại (retry 3 s); thanh trên hiện "Mất kết nối thời gian thực".
- Fury offline → thanh trên xám, trang Kết nối Fury hiện lỗi; dashboard vẫn dùng được.
- Không có `systray2` binary / không phải Windows → bỏ qua tray, log cảnh báo; dịch vụ vẫn chạy.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: `apps/dashboard` build bằng Vite ra `apps/dashboard/dist`, Gateway phục vụ (005); TypeScript strict; chỉ `import type` từ contract.
- **FR-002**: Lớp API (`fetch` + cookie + `X-PV-CSRF` từ `/internal/session`), xử lý lỗi `{ error }`, 401 → trạng thái "hết phiên".
- **FR-003**: SSE `/internal/stream` → vô hiệu khóa TanStack Query tương ứng (bảng ánh xạ sự kiện → khóa).
- **FR-004**: 8 trang + thanh trên theo SPEC-07 §3–4; thuật ngữ cố định §2; mọi số bấm được tới dữ liệu gốc (liên kết tới thẻ/trang tương ứng).
- **FR-005**: Khai báo một chạm §5 + hoàn tác (gateway undo) + phím `U`; hộp xác nhận cho sự kiện đỏ, lên mức, gỡ dừng, thu hồi token.
- **FR-006**: Biểu đồ 7 loại §4.2.1 bằng Recharts (cột chồng, đường, bậc thang, dải thời gian).
- **FR-007**: Gateway: `GET /internal/overview`, `GET /internal/inbox`, `POST /internal/bindings/:id/events/:eventId/undo`; Health: `undoManualEvent`, `event_count` bỏ sự kiện bị hoàn tác.
- **FR-008**: `apps/service/src/tray.ts`: `TrayController` (menu §6, màu icon, autostart registry, Thoát xác nhận) với backend tiêm được (`systray2` thật / giả cho test).
- **FR-009**: `apps/service/src/notifier.ts`: `Notifier` nghe bus + lịch nhắc (§7), dedupe 30 phút, giới hạn đạt ngưỡng 1/ngày/kênh, gửi qua `node-notifier` (tiêm được).
- **FR-010**: Test: thuần + render SSR các trang chính + tray/notifier với fake + gateway endpoint mới.

### Key Entities
- OverviewRow, InboxItem (contract `dashboard.ts`).

## Success Criteria *(mandatory)*
- **SC-001**: `pnpm build` tạo `apps/dashboard/dist/index.html`; dịch vụ phục vụ dashboard tại `/` sau khi mở từ tray.
- **SC-002**: Khai báo "Đã upload" hiện trên dòng thời gian ≤ 2 giây không tải lại trang (SSE).
- **SC-003**: Mọi toast §7 có test kích hoạt; không toast trùng trong 30 phút (test đồng hồ giả).

## Assumptions
- Màn hình ≥ 1280 px; không tối ưu di động.
- Giờ hiển thị theo `config.ui.timezone` (trả trong `/internal/overview` meta).
