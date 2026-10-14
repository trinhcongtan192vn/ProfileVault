# SPEC-05 — Gateway: REST, MCP, xác thực, chính sách

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M0 (REST nội bộ + phiên dashboard), M1 (MCP, token app ngoài) · **Yêu cầu PRD:** F12, F20 · **Phụ thuộc:** SPEC-00, SPEC-02, SPEC-03, SPEC-06

## 1. Mục đích

Một server Fastify duy nhất trên loopback phục vụ: dashboard (file tĩnh + API nội bộ), Integration API `profilevault/v1` (REST) cho app ngoài, và MCP (Streamable HTTP) cho Claude và agent khác. Gateway xác thực, kiểm quyền, giới hạn tần suất, ghi audit; logic nghiệp vụ nằm ở Health service, Runner, Job service.

## 2. Mạng

- Lắng nghe `config.gateway.host:port` (mặc định `127.0.0.1:50410`). Khởi động thất bại nếu host không phải địa chỉ loopback.
- Từ chối request có `Host` khác `127.0.0.1:<port>` hoặc `localhost:<port>` (chống DNS rebinding).
- Không bật CORS. Request có header `Origin` phải bằng origin của chính Gateway, ngược lại 403.
- Giới hạn body 1 MB (file không đi qua API — chỉ đường dẫn).

## 3. Bề mặt

| Tiền tố | Dùng cho | Xác thực |
|---|---|---|
| `/` | Dashboard SPA (file tĩnh) | Phiên dashboard (§4.1) |
| `/internal/*` | API cho dashboard | Phiên dashboard |
| `/internal/stream` | Server-Sent Events cập nhật thời gian thực | Phiên dashboard |
| `/api/v1/*` | Integration API `profilevault/v1` (SPEC-06) | Token client (§4.2) |
| `/mcp` | MCP Streamable HTTP (§6) | Token client |
| `/auth/open` | Đổi mã dùng một lần lấy phiên dashboard | Mã dùng một lần |

## 4. Xác thực

### 4.1 Phiên dashboard
- Tray "Mở dashboard" sinh mã ngẫu nhiên 32 byte, hiệu lực 60 giây, dùng một lần; mở trình duyệt mặc định tới `http://127.0.0.1:50410/auth/open?code=<mã>`.
- Đổi mã → cookie `pv_session` (`HttpOnly`, `SameSite=Strict`, `Path=/`), hiệu lực 12 giờ, gia hạn khi dùng.
- Mọi request ghi từ dashboard kèm header `X-PV-CSRF` khớp giá trị đọc qua `GET /internal/session`.
- Phiên dashboard có toàn quyền, gồm các hành động chỉ dành cho người (§5.2).

### 4.2 Token client
- Định dạng `pv_<prefix 8 ký tự>_<bí mật 32 byte base64url>`. Lưu `token_prefix` và `argon2id(bí mật)`; hiển thị token đầy đủ **một lần** khi tạo.
- Gửi qua `Authorization: Bearer <token>` cho cả REST và MCP.
- Tra theo prefix → so hash → kiểm `revoked_at IS NULL` → cập nhật `last_used_at`.
- Tạo/thu hồi trên dashboard (Cài đặt → Ứng dụng kết nối): tên, scope, bộ lọc flow, bộ lọc binding, giới hạn tần suất.

## 5. Phân quyền

### 5.1 Scope cho client

| Scope | Cho phép |
|---|---|
| `accounts.read` | Liệt kê tài khoản đã gắn (`platform`, `accountId`, tên, mức, trạng thái dừng, flow dùng được) |
| `jobs.read` | Xem job của chính client |
| `jobs.write` | Gửi và hủy job (trong phạm vi bộ lọc flow/binding) |
| `ops.read` | Đọc dashboard: độ sẵn sàng, sự kiện, kết quả nhất quán, lịch, run — cho skill |
| `ops.write` | Tạo binding, khai báo sự kiện thủ công, nhập probe, chạy kiểm nhất quán — cho skill |

Bộ lọc: `flow_filter_json` (mẫu glob trên `flowId`, ví dụ `["youtube/upload"]`), `binding_filter_json` (danh sách `bindingId` hoặc `["*"]`). Ngoài bộ lọc → `FORBIDDEN_SCOPE`.

### 5.2 Hành động chỉ dành cho người (chỉ phiên dashboard)
Lên mức; gỡ dừng có lý do do người gỡ (R1, R2, R7); xác nhận checklist tài khoản; xác nhận loại ASN; nhập kết quả detect-suite; sửa ngưỡng và luật nhất quán; tạo/thu hồi token; trả lời gate `review_before_final` của chế độ L2. Không có tool MCP hay endpoint `/api/v1` nào làm các việc này.

### 5.3 Mức rủi ro
| Mức | Ví dụ | Điều kiện |
|---|---|---|
| `read` | Liệt kê, xem trạng thái | Scope đọc tương ứng |
| `write_local` | Tạo binding, khai báo sự kiện, nhập probe | `ops.write` |
| `act_on_site` | Gửi job (mọi flow) | `jobs.write` + bộ lọc + kiểm mức binding (Runner, Job service) |
| `human_only` | §5.2 | Phiên dashboard |

## 6. MCP

- Transport Streamable HTTP tại `/mcp` (`@modelcontextprotocol/sdk`), không trạng thái phiên phía server ngoài cái SDK yêu cầu.
- Danh sách tool chỉ gồm tool mà scope của token cho phép (client không thấy tool ngoài quyền).

| Tool | Scope | Ánh xạ |
|---|---|---|
| `pv_accounts_list` | accounts.read | `GET /api/v1/accounts` |
| `pv_flows_list` | jobs.read | `GET /api/v1/flows` |
| `pv_jobs_submit` | jobs.write | `POST /api/v1/jobs` |
| `pv_jobs_get` | jobs.read | `GET /api/v1/jobs/:id` |
| `pv_jobs_list` | jobs.read | `GET /api/v1/jobs` |
| `pv_jobs_cancel` | jobs.write | `POST /api/v1/jobs/:id/cancel` |
| `pv_jobs_wait` | jobs.read | Chờ tới khi job đổi trạng thái hoặc hết `timeoutSeconds` (≤ 50) |
| `pv_readiness_overview` | ops.read | Bảng tổng quan dashboard |
| `pv_binding_detail` | ops.read | Chi tiết binding: mức, điều kiện, dừng, sự kiện gần đây |
| `pv_consistency_report` | ops.read | Kết quả nhất quán gần nhất của binding |
| `pv_events_list` | ops.read | Sự kiện theo binding/khoảng thời gian |
| `pv_binding_create` | ops.write | `HealthService.createBinding` |
| `pv_event_record` | ops.write | `HealthService.recordManualEvent` |
| `pv_probe_import` | ops.write | `HealthService.importProbe` (đường dẫn file) |
| `pv_consistency_run` | ops.write | `HealthService.runConsistency` |

- Khi client giữ phiên MCP và gọi `pv_jobs_submit` có `progressToken`, Gateway gửi `notifications/progress` khi run đổi bước/trạng thái.
- Lỗi tool trả `isError: true` với nội dung JSON `{ code, message, detail }` theo SPEC-00 §9.

## 7. API nội bộ cho dashboard (`/internal`)

Nhóm endpoint (chi tiết dữ liệu theo SPEC-07):

| Nhóm | Endpoint chính |
|---|---|
| Phiên | `GET /internal/session` |
| Fury | `GET /internal/fury` (health, capabilities), `PUT /internal/fury/token`, `GET /internal/fury/profiles` |
| Binding | `GET/POST /internal/bindings`, `GET/PATCH/DELETE /internal/bindings/:id` |
| Mức | `GET /internal/bindings/:id/readiness`, `POST /internal/bindings/:id/promote` |
| Dừng | `POST /internal/bindings/:id/pause`, `POST /internal/pauses/:id/clear` |
| Sự kiện | `POST /internal/bindings/:id/events`, `GET /internal/bindings/:id/events` |
| Probe | `POST /internal/bindings/:id/probes` (multipart file), `GET /internal/bindings/:id/probes` |
| Checklist | `GET/PUT /internal/bindings/:id/checklist`, `POST /internal/bindings/:id/checklist/confirm` |
| Nhất quán | `POST /internal/consistency/run`, `GET /internal/bindings/:id/consistency`, `GET /internal/consistency/matrix` |
| Detect-suite | `POST /internal/detect-suite` |
| ASN | `POST /internal/asn-attestations` |
| Job/run | `GET /internal/jobs`, `GET /internal/runs/:id`, `POST /internal/runs/:id/cancel`, `POST /internal/runs/:id/resolve`, `GET /internal/runs/:id/artifacts/:name` |
| Lịch | `GET/POST /internal/schedules`, `PATCH/DELETE /internal/schedules/:id` |
| Cài đặt | `GET/PUT /internal/settings/thresholds`, `GET /internal/rules`, `PATCH /internal/rules/:id`, `GET/PUT /internal/settings/runner` |
| Client | `GET/POST /internal/clients`, `POST /internal/clients/:id/revoke` |
| Biểu đồ | `GET /internal/charts/:name?bindingId=&from=&to=&bucket=day|week` |
| Xuất | `GET /internal/export/:dataset.csv` |
| Hệ thống | `GET /internal/system` (hàng đợi, profile đang chạy, RAM, chế độ bận, tạm dừng toàn cục), `POST /internal/system/global-pause` |

Nhập/xuất dữ liệu đều theo schema Zod trong `packages/contract`.

## 8. Giới hạn tần suất
- Theo client: `rate_limit_per_min` (mặc định 120); vượt → 429 `RATE_LIMITED` với `retryAfter` (giây).
- Phiên dashboard: không giới hạn.

## 9. Audit
Ghi `audit_events` cho: mọi request ghi (REST, MCP, nội bộ), đăng nhập dashboard, tạo/thu hồi token, request bị từ chối do quyền. `detail_json` không chứa token, giá trị checklist gốc, hay nội dung file.

## 10. Lỗi HTTP

| Mã lỗi | HTTP |
|---|---|
| `INPUT_INVALID` | 400 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN_SCOPE` | 403 |
| `ACCOUNT_NOT_BOUND`, `FLOW_NOT_FOUND` | 404 |
| `DUPLICATE_JOB` | 200 (trả job cũ, header `X-PV-Duplicate: true`) |
| `BINDING_PAUSED`, `LEVEL_TOO_LOW`, `FLOW_DISABLED`, `DAILY_LIMIT_REACHED`, `FILE_*` | 422 |
| `RATE_LIMITED` | 429 |
| `FURY_OFFLINE`, `FURY_VERSION_UNSUPPORTED` | 503 |
| `INTERNAL` | 500 |

## 11. Nghiệm thu
- Request từ `Host: evil.com` bị từ chối.
- Token chỉ có `jobs.read` gọi `pv_jobs_submit` → không thấy tool; gọi REST → 403.
- Không có cách nào lên mức ngoài phiên dashboard.
- Mã `/auth/open` dùng lần hai hoặc sau 60 giây → từ chối.
