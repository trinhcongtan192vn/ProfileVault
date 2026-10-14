# Feature Specification: FuryClient (002)

**Feature Branch**: `002-fury-client`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Triển khai packages/fury-client: giao diện, adapter HTTP theo SPEC-01 (ánh xạ endpoint để sau TODO(SPIKE-P2)), bộ theo dõi trạng thái, FakeFury theo SPEC-01; SPEC-09 §3.1. Tài liệu đó là nguồn sự thật; spec.md chỉ chốt phạm vi feature này, liệt kê yêu cầu PRD liên quan và trỏ tới mục của spec gốc, không chép lại toàn bộ."

**Spec gốc (nguồn sự thật)**: `docs/specs/SPEC-01-fury-client.md` (§2 nguyên tắc, §3 giao diện, §4 ánh xạ nguồn [SPIKE-P2, P5], §5 kết nối, §6 phiên bản, §7 poller, §8 lỗi, §9 kiểm thử); `docs/specs/SPEC-09-testing.md` §3.1 FakeFury; SPEC-00 §9 mã lỗi, §10 sự kiện `fury.status_changed`, §7.1 `fury.profile_opened/closed`, `fury.version_changed`. PRD: F3 (kiểm proxy qua Fury), F9 (Runner hỏi trạng thái profile), §11 bảo mật.

## Clarifications

### Session 2026-10-14

- Q: Định dạng endpoint/JSON thật của automation API Fury chưa có (SPIKE-P2) — cài thế nào? → A: Tách **bộ ánh xạ endpoint** (`FuryEndpointMap`: method, đường dẫn, hàm chuyển đổi phản hồi thô → kiểu SPEC-01 §3) thành một module duy nhất `src/adapter/endpoint-map.ts` có `TODO(SPIKE-P2)`; `HttpFuryClient` chỉ dùng bộ ánh xạ. FakeFury cài đúng bộ ánh xạ giả định đó. Sau spike chỉ sửa module này và FakeFury. (SPEC-01 §1, §4.)
- Q: Kiểu dữ liệu `FuryHealth`, `FuryProfileDetail`, `ExitInfo`… đặt ở đâu? → A: Zod trong `packages/contract/src/fury.ts` (SPEC-00 §2: mọi schema vào/ra ở contract); `fury-client` chỉ nhập kiểu.
- Q: Kiểm semver range `config.fury.supportedVersions` bằng gì? → A: thêm dependency `semver` (nhỏ, chuẩn; ghi `docs/decisions.md`). Tự viết parser range là rủi ro không cần thiết.
- Q: Poller phát `fury.profile_opened/closed` ra đâu, khi bus SPEC-00 §10 chỉ có `fury.status_changed`? → A: Poller nhận `onProfileStatusChanged(profileId, open, at)` qua DI; Health service (003) nối callback này để ghi `health_events`. `fury.status_changed` phát qua bus đúng §10. (SPEC-01 §7, SPEC-02 §5.)
- Q: FakeFury đặt ở `packages/fury-client/test/fake-fury.ts` (SPEC-09 §3.1) nhưng health/runner cũng cần — làm sao? → A: Mã nguồn ở `src/testing/fake-fury.ts`, xuất qua subpath `@sctech/profilevault-fury-client/testing`; file `test/fake-fury.ts` của package chỉ tái xuất. Giả định ghi ở `docs/progress.md`.
- Q: `launch` trong FakeFury có khởi Chromium thật (SPEC-09 §3.1) ở 002 không? → A: Không ở 002: FakeFury có `launchHandler` tiêm được; mặc định trả `cdpEndpoint` giả `ws://127.0.0.1:0/fake/<profileId>`. Feature 007 tiêm handler khởi Chromium thật cho test Runner.

## Phạm vi

**Trong phạm vi:** schema Zod kiểu Fury trong contract; giao diện `FuryClient`; `HttpFuryClient` (timeout §5, thử lại §5, mã lỗi §8, kiểm phiên bản §6, bearer token từ `SecretStore`, bộ ánh xạ endpoint `TODO(SPIKE-P2)`, fallback đọc file profile `TODO(SPIKE-P2)` dạng adapter, `capabilities()` theo bộ ánh xạ); `FuryStatusPoller` §7; `FakeFury` §9 / SPEC-09 §3.1 (HTTP server giả, kịch bản chỉnh được); test unit + integration.

**Ngoài phạm vi:** trang "Kết nối Fury" (006), ghi sự kiện vào CSDL (003), khởi Chromium thật trong FakeFury (007), test `@fury-live` với Fury thật (người chạy sau spike), phân loại ASN bằng `.mmdb` (SPIKE-P5; 002 trả `asnType` từ Fury hoặc `unknown`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gọi Fury qua một lớp duy nhất (Priority: P1)

Các package khác gọi `FuryClient` (health, list/get profile, status, launch, stop, checkExit, capabilities) và nhận kiểu SPEC-01 §3 với mã lỗi SPEC-00 §9, không cần biết endpoint của Fury.

**Why this priority**: SPEC-01 §1 — lớp duy nhất nói chuyện với Fury; health 003 và runner 007 phụ thuộc.

**Independent Test**: integration với FakeFury: mỗi phương thức trả đúng kiểu; mỗi tình huống lỗi §8 ra đúng mã.

**Acceptance Scenarios**:

1. **Given** FakeFury phiên bản `0.2.23` chạy, **When** gọi `health()`, **Then** `{ reachable: true, version: '0.2.23', supported: true, checkedAt }`.
2. **Given** FakeFury tắt, **When** gọi `health()`, **Then** `{ reachable: false, supported: false }` (không ném); gọi `listProfiles()` → ném `PvError('FURY_OFFLINE')`.
3. **Given** FakeFury trả 401, **When** gọi `listProfiles()`, **Then** `FURY_OFFLINE` với `detail.reason = 'auth'`.
4. **Given** FakeFury phiên bản `0.5.0` (ngoài `>=0.2.21 <0.4.0`), **When** `health()`, **Then** `supported = false`; `launch()` ném `FURY_VERSION_UNSUPPORTED`; `listProfiles()` vẫn chạy.
5. **Given** profile `p1` có persona/múi giờ/ngôn ngữ trong FakeFury, **When** `getProfile('p1')`, **Then** trả đủ trường có; trường FakeFury không có → `undefined`; profile không tồn tại → `INPUT_INVALID`.
6. **Given** năng lực `checkExit` đánh dấu `missing` trong bộ ánh xạ, **When** gọi `checkExit()`, **Then** `FURY_CAPABILITY_MISSING`; `capabilities()` liệt kê đúng `native/fallback/missing` cho 8 năng lực.
7. **Given** FakeFury trả 500 hai lần rồi 200, **When** `getStatus()`, **Then** thành công sau thử lại (tối đa 2 lần, backoff 1 s → 3 s, đo bằng đồng hồ/timer giả); trả 500 ba lần → `FURY_OFFLINE`.
8. **Given** profile đang mở, **When** `launch()`, **Then** không gọi endpoint launch (gọi `getStatus` trước) và ném `PROFILE_BUSY`; không bao giờ thử lại `launch`.
9. **Given** `fetch` treo quá timeout (`health` 3 s, `getStatus` 5 s, `checkExit` 30 s, `launch` 60 s, `stop` 15 s), **When** gọi, **Then** hủy và trả `FURY_OFFLINE` (hoặc `reachable: false` với `health`).

---

### User Story 2 - Bộ theo dõi trạng thái Fury (Priority: P2)

Tiến trình nền biết Fury online/offline, phiên bản đổi, và profile nào vừa được mở/đóng ngoài ProfileVault (để nhắc khai báo).

**Why this priority**: SPEC-01 §7; nguồn cho `fury.status_changed`, `fury.version_changed`, `fury.profile_opened/closed`.

**Independent Test**: unit với FakeFury + đồng hồ/timer giả: điều khiển `tick()`.

**Acceptance Scenarios**:

1. **Given** poller chạy, **When** Fury từ offline → online, **Then** phát `fury.status_changed { reachable: true, version, supported }` đúng một lần; không đổi → không phát.
2. **Given** phiên bản đổi `0.2.23 → 0.2.24`, **When** tick `health`, **Then** phát `fury.status_changed` và gọi `onVersionChanged(old, new)`.
3. **Given** 2 profile có binding, `p1` đang đóng, **When** FakeFury mở `p1` rồi tick `status` (5 phút), **Then** gọi `onProfileStatusChanged('p1', true, at)`; tick tiếp không đổi → không gọi; đóng → gọi với `false`.
4. **Given** Fury offline, **When** tick `status`, **Then** không gọi `onProfileStatusChanged` nào (giữ trạng thái cuối).
5. **Given** poller `start()`, **Then** `health` mỗi 60 s, `status` mỗi 5 phút (timer tiêm được); `stop()` dừng mọi timer.

---

### User Story 3 - FakeFury cho kiểm thử (Priority: P2)

Mọi test của ProfileVault chạy được không cần Fury thật.

**Why this priority**: SPEC-09 §3.1; nguyên tắc không gọi Fury thật trong phiên phát triển.

**Independent Test**: `FakeFury.start()` trên cổng ngẫu nhiên loopback; API kịch bản.

**Acceptance Scenarios**:

1. **Given** FakeFury, **When** `setProfiles([...])`, `setOpen('p1', true, 'app')`, `setVersion('0.2.24')`, `setExit('p1', {...})`, `failNext(n, status)`, `setAuthRequired(true)`, `setCapability('checkExit', false)`, `setLatency(ms)`, **Then** các phương thức `HttpFuryClient` phản ánh đúng.
2. **Given** `launchHandler` tùy chỉnh, **When** `launch`, **Then** FakeFury gọi handler và trả `cdpEndpoint` của handler; mặc định trả endpoint giả; `stop` gọi `stopHandler`.
3. **Given** FakeFury, **Then** ghi lại mọi request (`requests()`), để test kiểm "không gọi launch khi đang mở".

### Edge Cases

- `config.fury.apiBaseUrl` còn `${FURY_API_PORT}` chưa thay → `health()` trả `reachable: false` kèm `error: 'url_invalid'`; phương thức khác → `FURY_OFFLINE` `detail.reason = 'url_invalid'`.
- Thiếu token Fury trong `SecretStore` → vẫn gọi (Fury có thể không cần token); 401 → `auth`.
- Fury trả JSON không khớp bộ ánh xạ (thiếu trường bắt buộc) → `FURY_OFFLINE` `detail.reason = 'bad_response'` kèm đường dẫn trường (không crash, không log thân phản hồi nếu có thể chứa bí mật).
- `stop()` cho profile đã đóng → không lỗi (idempotent).
- Phản hồi profile có trường proxy chứa user/pass → bộ chuyển đổi chỉ giữ `proxyRef` (định danh), bỏ mọi trường khác; test kiểm không có chuỗi mật khẩu trong kết quả.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `packages/contract/src/fury.ts` định nghĩa Zod: `FuryHealthSchema`, `FuryProfileSummarySchema`, `FuryProfileDetailSchema`, `FuryProfileStatusSchema`, `FuryLaunchResultSchema`, `ExitInfoSchema`, `FuryCapabilitiesSchema` (8 năng lực × `native|fallback|missing`), `AsnTypeSchema` đúng SPEC-01 §3.
- **FR-002**: `FuryClient` interface đúng 8 phương thức SPEC-01 §3.
- **FR-003**: `HttpFuryClient` dùng `fetch` tiêm được, bearer token từ hàm `getToken()` (nối `SecretStore['fury.token']`), timeout theo SPEC-01 §5 (`health` 3 s; `listProfiles`/`getProfile`/`getStatus` 5 s; `checkExit` 30 s; `launch` 60 s; `stop` 15 s), thử lại chỉ lỗi mạng/5xx tối đa 2 lần backoff 1 s → 3 s (timer tiêm được), **không** thử lại `launch`; `launch` gọi `getStatus` trước, đang mở → `PROFILE_BUSY`.
- **FR-004**: Mã lỗi theo SPEC-01 §8: không kết nối/timeout → `FURY_OFFLINE`; 401/403 → `FURY_OFFLINE` + `detail.reason='auth'`; phiên bản ngoài khoảng → `FURY_VERSION_UNSUPPORTED` cho `launch`; năng lực `missing` → `FURY_CAPABILITY_MISSING`; profile không tồn tại (404) → `INPUT_INVALID`.
- **FR-005**: Kiểm phiên bản bằng semver range `config.fury.supportedVersions`; `health().supported` phản ánh; thao tác chỉ đọc vẫn chạy khi không hỗ trợ.
- **FR-006**: Bộ ánh xạ endpoint `src/adapter/endpoint-map.ts` là nơi duy nhất biết đường dẫn/định dạng Fury; mỗi năng lực khai `{ source: 'native'|'fallback'|'missing', request(...), parse(raw) }`; chú thích `TODO(SPIKE-P2)` / `TODO(SPIKE-P5)` ở từng mục chưa xác minh; `capabilities()` suy từ bộ ánh xạ (và từ cấu hình `fury.dataDir` cho fallback `profileConfig`).
- **FR-007**: Fallback `getProfile` khi API không có cấu hình: adapter `ProfileConfigFileSource` đọc file trong `fury.dataDir` (chỉ đọc), định dạng `TODO(SPIKE-P2)` — 002 cài khung nhận hàm parse tiêm được và trả `undefined` cho trường chưa biết.
- **FR-008**: Bộ chuyển đổi không bao giờ đưa thông tin đăng nhập proxy, cookie, mật khẩu vào kết quả hay log; chỉ giữ `proxyRef`.
- **FR-009**: `FuryStatusPoller({ client, bus, clock, timers, listBoundProfileIds, onProfileStatusChanged, onVersionChanged })`: `health()` 60 s, `getStatus()` mọi profile có binding 5 phút; phát `fury.status_changed` khi reachable/version/supported đổi; offline → giữ trạng thái cuối, không sinh sự kiện mở/đóng; `start()/stop()/tickHealth()/tickStatus()`.
- **FR-010**: `FakeFury` HTTP server loopback cổng ngẫu nhiên với API kịch bản US3; export qua `@sctech/profilevault-fury-client/testing`.
- **FR-011**: Test: unit cho bộ chuyển đổi, kiểm phiên bản, lỗi; integration `HttpFuryClient` × FakeFury cho mọi AC US1; poller với timer giả; mọi test không cần Fury thật.

### Key Entities

- **FuryHealth, FuryProfileSummary/Detail, FuryProfileStatus, FuryLaunchResult, ExitInfo, FuryCapabilities**: theo SPEC-01 §3.
- **EndpointMap entry**: năng lực → `{ source, method, path(params), body?, parse }`.
- **PollerState**: `lastHealth`, `lastOpen: Map<profileId, boolean>`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mọi gói khác chỉ import `FuryClient` từ `@sctech/profilevault-fury-client`; `grep` không thấy chuỗi `apiBaseUrl`/`fetch(` tới Fury ngoài package này (kiểm bằng test đọc mã ở feature sau).
- **SC-002**: Đổi ánh xạ endpoint sau spike P2 chỉ cần sửa `endpoint-map.ts` và `fake-fury.ts`; test giao diện không đổi.
- **SC-003**: Toàn bộ test 002 chạy ≤ 10 s, không cần mạng ngoài loopback.
- **SC-004**: Không có giá trị token hay thông tin proxy trong log/kết quả (test grep).

## Assumptions

- Bộ ánh xạ endpoint giả định (ghi ở research.md) dựa trên "6 endpoint automation API" trong SPIKE-P2; sẽ sửa sau spike.
- `checkExit` giả định `native` qua endpoint của Fury (SPIKE-P5 chưa chốt); nếu Fury không có, đổi `source` sang `missing` và Health 003 ghi `proxy.check_failed`.
- Timer/backoff tiêm được để test không chờ thật.
