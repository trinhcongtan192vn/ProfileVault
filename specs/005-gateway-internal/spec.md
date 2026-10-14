# Feature Specification: Gateway M0 — REST loopback cho dashboard (005)

**Feature Branch**: `005-gateway-internal`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Triển khai packages/gateway phần M0: Fastify loopback, kiểm Host/Origin, phiên dashboard /auth/open, toàn bộ /internal/*, SSE, audit, mã lỗi HTTP theo SPEC-05 §2–4.1, §5.2, §7, §9–11. Tài liệu đó là nguồn sự thật; spec.md chỉ chốt phạm vi feature này, liệt kê yêu cầu PRD liên quan và trỏ tới mục của spec gốc, không chép lại toàn bộ."

**Spec gốc (nguồn sự thật)**: `docs/specs/SPEC-05-gateway.md` §1 mục đích, §2 mạng, §3 bề mặt (`/`, `/internal/*`, `/internal/stream`, `/auth/open`), §4.1 phiên dashboard, §5.2 hành động chỉ dành cho người, §7 API nội bộ, §8 (phiên dashboard không giới hạn), §9 audit, §10 lỗi HTTP, §11 nghiệm thu. SPEC-07 §8 dữ liệu biểu đồ, §4.8 xuất CSV. SPEC-00 §9 định dạng lỗi, §10 bus → SSE. PRD F12 (REST loopback + token cục bộ), §11 bảo mật, F7 xuất CSV.

## Clarifications

### Session 2026-10-14

- Q: `/api/v1/*`, `/mcp`, token client (§4.2, §5.1, §6, §8 giới hạn theo client) thuộc M1 — 005 có cài không? → A: Không. 005 chỉ phiên dashboard. Tuy nhiên `/internal/clients` (§7 "Client") và bảng `clients` dùng ở M1 — cài tạo/thu hồi token (argon2id) để dashboard 006 có trang "Ứng dụng kết nối"; xác thực Bearer cho `/api/v1` để M1.
- Q: Endpoint job/run/lịch (§7) cần Runner (007) chưa có — làm sao? → A: Gateway nhận `RunnerFacade` tùy chọn qua DI (`listJobs`, `getRun`, `cancelRun`, `resolveGate`, `listFlows`, `systemInfo`, `setGlobalPause`, lịch CRUD). Chưa nối → endpoint trả danh sách rỗng / `503 FLOW_DISABLED` với thông điệp "Runner chưa sẵn sàng". 007 cài facade; test 005 dùng facade giả.
- Q: Tray "Mở dashboard" (SPEC-07 §6) sinh mã thế nào? → A: Gateway xuất `createOpenUrl()` → `http://127.0.0.1:<port>/auth/open?code=<32 byte base64url>` hiệu lực 60 s, dùng một lần; tray 006 gọi và mở trình duyệt. Khi không có phiên, `GET /` trả trang HTML tối thiểu "Mở dashboard từ biểu tượng tray" (401).
- Q: Dashboard SPA chưa có (006) — `/` phục vụ gì? → A: `@fastify/static` phục vụ `apps/dashboard/dist` nếu có (đường dẫn tiêm `staticDir`), ngược lại trang HTML tối thiểu. SPA fallback cho mọi đường dẫn không phải `/internal|/auth|/api|/mcp`.
- Q: Nhập probe qua `multipart file` hay JSON? → A: Cả hai: `multipart/form-data` (trường `file`) và `application/json` `{ raw: object }`; multipart lưu file tạm trong `probesDir/incoming/` rồi `importProbe({ filePath })`.
- Q: Biểu đồ (SPEC-07 §8) tổng hợp ở đâu? → A: Trong gateway (`charts.ts`) bằng SQL/JS trên bảng SPEC-00 §8, trả `{ bucket, series }[]` hoặc dải thời gian; `bucket ∈ day|week`.

## Phạm vi

**Trong phạm vi:** `packages/gateway`: `createGateway(deps)` → Fastify instance + `listen()`; kiểm loopback/Host/Origin/body 1 MB; `/auth/open` + cookie phiên 12 giờ gia hạn + CSRF; toàn bộ nhóm `/internal` §7 (Fury, Binding, Mức, Dừng, Sự kiện, Probe, Checklist, Nhất quán, Detect-suite, ASN, Job/run, Lịch, Cài đặt (ngưỡng, luật, runner), Client, Biểu đồ, Xuất CSV, Hệ thống); SSE `/internal/stream`; audit §9; ánh xạ lỗi §10; schema Zod request/response trong contract; test API §11.

**Ngoài phạm vi:** `/api/v1`, `/mcp`, rate limit theo client (M1); SPA React (006); Runner thật (007).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Chỉ loopback, chỉ phiên dashboard (Priority: P1)

Gateway chỉ nghe trên loopback, từ chối Host/Origin lạ, chỉ cho phiên dashboard mở từ tray dùng API nội bộ.

**Why this priority**: PRD §11 bảo mật; Constitution V, VIII.

**Independent Test**: API test với `fastify.inject` và một lần `listen` thật.

**Acceptance Scenarios**:

1. **Given** `config.gateway.host = '0.0.0.0'`, **When** `listen()`, **Then** từ chối khởi động với lỗi rõ ràng; `127.0.0.1` → nghe được, cổng theo config.
2. **Given** request `Host: evil.com`, **Then** 403 `FORBIDDEN_SCOPE`-tương-đương nội bộ `HOST_REJECTED` (`code: 'UNAUTHORIZED'`, `detail.reason: 'host'`); `Host: 127.0.0.1:<port>` hoặc `localhost:<port>` → qua.
3. **Given** header `Origin: http://evil.com`, **Then** 403; `Origin: http://127.0.0.1:<port>` → qua; không có Origin → qua; không có header CORS nào trong phản hồi.
4. **Given** `createOpenUrl()`, **When** `GET /auth/open?code=<mã>`, **Then** 302 → `/` kèm `Set-Cookie: pv_session=…; HttpOnly; SameSite=Strict; Path=/`, audit `dashboard.login`; dùng lại mã → 401; sau 60 giây (FakeClock) → 401; mã sai → 401.
5. **Given** không cookie, **When** `GET /internal/bindings`, **Then** 401 `UNAUTHORIZED`; có cookie hợp lệ → 200; cookie quá 12 giờ không dùng → 401; dùng ở giờ thứ 11 → gia hạn thêm 12 giờ.
6. **Given** `POST /internal/bindings` có cookie nhưng thiếu `X-PV-CSRF` hoặc sai, **Then** 403 `FORBIDDEN_SCOPE` `detail.reason: 'csrf'`; đúng (giá trị từ `GET /internal/session`) → xử lý.
7. **Given** body > 1 MB, **Then** 413 → `INPUT_INVALID`.

---

### User Story 2 - API nội bộ đầy đủ cho dashboard (Priority: P1)

Mọi nhóm endpoint §7 nối với HealthService (003/004), Fury, Runner facade; dữ liệu vào/ra theo Zod.

**Why this priority**: F7, F12; dashboard 006 cần.

**Independent Test**: API test với Health thật (SQLite tạm, FakeFury) và Runner facade giả.

**Acceptance Scenarios** (mỗi dòng một endpoint nhóm; mã lỗi theo §10):

1. **Fury**: `GET /internal/fury` → `{ health, capabilities }`; `PUT /internal/fury/token { token }` → lưu `fury.token` vào SecretStore, audit, không log token; `GET /internal/fury/profiles` → danh sách profile kèm `bound: boolean`.
2. **Binding**: `GET/POST /internal/bindings`, `GET/PATCH/DELETE /internal/bindings/:id` (DELETE = archive); `POST` sai schema → 400 `INPUT_INVALID` kèm `issues`; trùng → 400; `:id` lạ → 404 `ACCOUNT_NOT_BOUND`.
3. **Mức**: `GET /internal/bindings/:id/readiness`; `POST /internal/bindings/:id/promote` → 200 `LevelChange` hoặc 422 `BINDING_PAUSED` / 400 `INPUT_INVALID` (thiếu điều kiện).
4. **Dừng**: `POST /internal/bindings/:id/pause { note? }`; `POST /internal/pauses/:id/clear` → 403 `FORBIDDEN_ACTION` nếu lý do hệ thống.
5. **Sự kiện**: `POST /internal/bindings/:id/events { type, occurredAt?, note? }` → 201 `HealthEventRecord`; `GET /internal/bindings/:id/events?types=&since=&until=&limit=`.
6. **Probe**: `POST /internal/bindings/:id/probes` (multipart `file` hoặc JSON `{ raw }`) → 201 `ProbeResult`; thiếu trường → 400 với `missing`; `GET /internal/bindings/:id/probes` → danh sách + `comparison` (probe gần nhất vs trước).
7. **Checklist**: `GET /internal/bindings/:id/checklist` (không giá trị gốc), `PUT` (upsert), `POST .../confirm`.
8. **Nhất quán**: `POST /internal/consistency/run { bindingId? }` → `ConsistencyRunSummary`; `GET /internal/bindings/:id/consistency`; `GET /internal/consistency/matrix`.
9. **Detect-suite**: `POST /internal/detect-suite { furyVersion, bindingId?, passed, summary? }` → 204. **ASN**: `POST /internal/asn-attestations { asn, asnType, note? }` → 204; `GET` danh sách.
10. **Job/run/lịch**: `GET /internal/jobs`, `GET /internal/runs/:id`, `POST /internal/runs/:id/cancel`, `POST /internal/runs/:id/resolve { choice, note? }`, `GET /internal/runs/:id/artifacts/:name`, `GET/POST /internal/schedules`, `PATCH/DELETE /internal/schedules/:id` → ủy quyền facade; không facade → 503 `FLOW_DISABLED`.
11. **Cài đặt**: `GET/PUT /internal/settings/thresholds`; `GET /internal/rules`, `PATCH /internal/rules/:id`; `GET/PUT /internal/settings/runner` (`settings.runner`, Zod: `humanize.actionDelayMs [min,max]`, `typingDelayMs`, `traceAlways`, cộng `maxConcurrentIdle/Busy`, `ramPerProfileMb`, `profileBusyTimeoutMinutes`, `humanGateTimeoutHours`, `uploadsPerAccountPerDay` ghi đè config).
12. **Client**: `GET /internal/clients`, `POST /internal/clients { name, scopes, flowFilter?, bindingFilter?, rateLimitPerMin? }` → 201 `{ client, token }` (token đầy đủ chỉ một lần, dạng `pv_<prefix8>_<32 byte base64url>`, lưu `argon2id`), `POST /internal/clients/:id/revoke`.
13. **Biểu đồ**: `GET /internal/charts/:name?bindingId=&from=&to=&bucket=day|week` cho 7 tên SPEC-07 §8; tên lạ → 404.
14. **Xuất**: `GET /internal/export/:dataset.csv?bindingId=&from=&to=` cho `events`, `proxy_checks`, `runs`, `level_changes`, `consistency_results`; số dòng khớp CSDL; `Content-Type: text/csv; charset=utf-8`, BOM UTF-8, `Content-Disposition`.
15. **Hệ thống**: `GET /internal/system` → `{ fury, queue, runningProfiles, ramFreeMb, busyMode, globalPause, packs, counts }`; `POST /internal/system/global-pause { paused }`.
16. **Phiên**: `GET /internal/session` → `{ csrfToken, expiresAt }`.

---

### User Story 3 - Cập nhật thời gian thực và audit (Priority: P2)

Dashboard nhận SSE; mọi request ghi được audit; từ chối quyền cũng audit.

**Acceptance Scenarios**:

1. **Given** phiên, **When** `GET /internal/stream`, **Then** `text/event-stream`, sự kiện `health.event_recorded`, `binding.level_changed`, `binding.pause_changed`, `run.status_changed`, `run.needs_user`, `fury.status_changed` được đẩy dạng `event: <tên>\ndata: <json>`; `: heartbeat` mỗi 15 s (timer tiêm); đóng kết nối → hủy đăng ký.
2. **Given** `POST` thành công, **Then** `audit_events` có dòng `actor_type user`, `action http.<method> <route>`, `detail_json` không chứa token/giá trị checklist/nội dung file.
3. **Given** request bị 401/403, **Then** audit `http.denied` với lý do.

### Edge Cases

- `GET /` không phiên → 401 HTML tối thiểu; có phiên nhưng không có `staticDir` → HTML tối thiểu "Dashboard chưa build".
- Lỗi không phải PvError → 500 `INTERNAL`, thông điệp chung, chi tiết vào log.
- Request `/internal/*` với `Accept: text/html` vẫn trả JSON.
- Query `limit` > 1000 → cắt 1000.
- CSV: giá trị chứa dấu phẩy/ngoặc kép/xuống dòng được bọc đúng.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Contract `packages/contract/src/internal-api.ts`: schema request/response cho §7 (params, query, body), `RunnerSettingsSchema`, `ClientCreateInputSchema`, `ClientSchema` (không hash), `ChartQuerySchema`, `ChartSeriesPointSchema`, `ChartSpanSchema`, `SystemInfoSchema`, `SessionInfoSchema`, `FuryStatusSchema`, `ExportDatasetSchema`.
- **FR-002**: `createGateway(deps)` với `deps = { config, clock, timers?, bus, logger, health, fury, poller, secrets, audit, settings, database, paths, runner?: RunnerFacade, staticDir?, random? }` trả `{ app: FastifyInstance, listen(): Promise<string>, close(), createOpenUrl(): string }`.
- **FR-003**: Hook `onRequest` toàn cục: loopback-only bind kiểm ở `listen`; Host whitelist; Origin bằng origin gateway; không header CORS; `bodyLimit = 1 MiB`.
- **FR-004**: Phiên: `OpenCodeStore` (mã 32 byte base64url, TTL 60 s, một lần), `SessionStore` (id 32 byte, TTL 12 giờ gia hạn, CSRF token 32 byte), cookie `pv_session` HttpOnly SameSite=Strict Path=/; `preHandler` cho `/internal/*` yêu cầu phiên; phương thức ghi yêu cầu `X-PV-CSRF`.
- **FR-005**: Route §7 theo US2 với Zod validate (sai → 400 `INPUT_INVALID` `issues`); ánh xạ `PvError` → HTTP §10; lỗi lạ → 500.
- **FR-006**: SSE `/internal/stream` relay 6 sự kiện bus + heartbeat 15 s.
- **FR-007**: Audit mọi request ghi (`http.write`), đăng nhập, từ chối (`http.denied`), tạo/thu hồi token; `detail` tối giản (route, params id, mã kết quả).
- **FR-008**: `RunnerFacade` interface (gateway) + `NoRunner` mặc định trả 503 `FLOW_DISABLED`.
- **FR-009**: Client token: `argon2id` hash bí mật, `token_prefix` 8 ký tự; `GET` không trả hash; thu hồi đặt `revoked_at`.
- **FR-010**: Charts 7 tên theo SPEC-07 §8 từ `health_events`, `proxy_checks`, `detect_suite_results`, `consistency_runs/results`; CSV 5 dataset.
- **FR-011**: `apps/service` nối gateway: tạo khi bootstrap, `listen` sau seed, đóng khi shutdown; `ServiceContext.gateway`.
- **FR-012**: Test API phủ US1–US3 và §11; không cần trình duyệt.

### Key Entities

- Phiên dashboard, mã mở một lần (bộ nhớ, không lưu CSDL).
- `clients` (SPEC-00 §8).
- `audit_events` hành động `dashboard.login`, `http.write`, `http.denied`, `client.create`, `client.revoke`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Không route nào ngoài `/auth/open` và `/` truy cập được khi thiếu phiên (test duyệt toàn bộ bảng route).
- **SC-002**: Không có endpoint `/api/v1` hay `/mcp` trong M0; `promote`/`clearPause` chỉ qua `/internal` (grep route).
- **SC-003**: Mọi endpoint §7 (ngoài M1) có ít nhất một test.
- **SC-004**: Token client, token Fury, giá trị checklist không xuất hiện trong audit/log (test grep).

## Assumptions

- Mã `/auth/open` và phiên giữ trong bộ nhớ; khởi động lại dịch vụ → phải mở lại từ tray.
- `GET /internal/fury/profiles` gọi `FuryClient.listProfiles` trực tiếp (không cache).
- `settings.runner` gộp mặc định từ `config.runner` + `limits` để dashboard sửa được (ghi `settings_history`), Runner 007 đọc `settings.runner` trước, `config` sau.
