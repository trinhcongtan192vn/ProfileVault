# Tiến độ triển khai ProfileVault

**Cập nhật:** 2026-10-14 (sau 005) · **Giai đoạn:** M0 · **Nguồn sự thật:** `docs/prd.md` (= `profilevault-prd.md`), `docs/architecture.md` (= `profilevault-agent-architecture.md`), `docs/specs/SPEC-00…09`, `docs/specs/SPIKE-ke-hoach.md`.

File này để một phiên làm việc mới tiếp tục được từ chỗ dừng. Cập nhật sau mỗi feature.

## 1. Quy trình mỗi feature

1. `/speckit-specify` → `specs/NNN-<tên>/spec.md` (chỉ chốt phạm vi, trỏ về spec gốc trong `docs/`).
2. `/speckit-clarify` → trả lời từ `docs/`; câu nào `docs/` không trả lời → ghi vào mục 4 "Giả định khi triển khai".
3. `/speckit-plan` (stack cố định theo SPEC-00 §3) → `/speckit-tasks` → `/speckit-analyze` (sửa mâu thuẫn trước khi code).
4. `/speckit-implement` ↔ `/speckit-converge` lặp tới khi converge báo xong.
5. `pnpm lint && pnpm test` xanh → commit `feat(NNN): <tên>` → cập nhật file này.

## 2. Danh sách feature M0

| # | Feature | Spec gốc | Trạng thái | Ghi chú |
|---|---|---|---|---|
| — | Bước 1–3: đọc docs, Spec Kit, CLAUDE.md, constitution | — | ✅ xong | commit `chore: init spec kit`, `docs: constitution and CLAUDE.md` |
| 001 | Monorepo pnpm, `packages/contract`, `packages/db` (schema + migration SQLite đầy đủ), config, bí mật DPAPI, bus sự kiện, khóa một phiên bản, bootstrap `apps/service` | SPEC-00 toàn bộ | ✅ xong | 66 test; `specs/001-foundation-monorepo/`; thêm `packages/core` (decisions.md) |
| 002 | `packages/fury-client`: giao diện, adapter HTTP (ánh xạ endpoint `TODO(SPIKE-P2)`), bộ theo dõi trạng thái, FakeFury | SPEC-01; SPEC-09 §3.1 | ✅ xong | 26 test; `specs/002-fury-client/`; endpoint giả định G8 |
| 003 | `packages/health` phần 1: binding, sự kiện, kiểm proxy theo lịch, ngưỡng, lên mức, hạ mức/dừng R1–R7, detect-suite, đồng hồ giả | SPEC-02 §1–5, §7–10 (trừ §6) | ✅ xong | 27 test; `specs/003-health-levels/`; R1–R7, readiness, proxy check, scheduler, nối bootstrap |
| 004 | `packages/health` phần 2: chuẩn hóa probe (`TODO(SPIKE-P3)`), 22 luật (SPEC-02 §6.4 có 22, không phải 21), checklist HMAC, `packages/host-info` (`TODO(SPIKE-P6)`) | SPEC-02 §6 | ✅ xong | 56 test health; `specs/004-consistency-rules/` |
| 005 | `packages/gateway` M0: Fastify loopback, kiểm Host/Origin, phiên dashboard `/auth/open`, toàn bộ `/internal/*`, SSE, audit, mã lỗi HTTP | SPEC-05 §2–4.1, §5.2, §7, §9–11 | ✅ xong | 21 test; `specs/005-gateway-internal/`; Runner facade chờ 007 |
| 006 | `apps/dashboard` + tray + toast: 8 trang, wizard gắn kênh, khai báo một chạm, biểu đồ, Chờ bạn, Cài đặt | SPEC-07 | 🔄 đang làm | |
| 007 | `packages/runner`: Flow contract, `ctx.ui`, humanGate, Runner, lịch + chạy bù, linter `tools/eslint-plugin-pv`; pack `generic/session-check` và `youtube/session-check` với fixture HTML | SPEC-03; SPEC-04 §2.1–2.2, §3, §4 | ⏳ chưa làm | |
| — | Bước 5: `spikes/` P1–P7 + `docs/specs/SPIKE-bao-cao.md` (mẫu trống) | SPIKE-ke-hoach | ⏳ chưa làm | Không chạy spike |

Ký hiệu: ⏳ chưa làm · 🔄 đang làm · ✅ xong · ⚠️ xong có ghi chú.

**Không làm trong phiên này:** M1 (`youtube/upload`, Job service + `/api/v1`, MCP, token app ngoài, `generic/probe`), M2 (skill).

## 3. Câu hỏi mở

| # | Câu hỏi | Liên quan | Trạng thái |
|---|---|---|---|
| Q1 | Định dạng thật của Automation API Fury (endpoint, JSON) | SPEC-01 §4, SPIKE-P2 | Chờ spike P2; adapter HTTP có `TODO(SPIKE-P2)` |
| Q2 | Định dạng file probe của Fury | SPEC-02 §6.3, SPIKE-P3 | Chờ spike P3; `parseFuryCapture` có `TODO(SPIKE-P3)` |
| Q3 | Fury có kiểm exit proxy không mở trình duyệt và phân loại ASN không | SPEC-01 §4, SPIKE-P5 | Chờ spike P5; mặc định `asnType = unknown` + `asn_attestations` |
| Q4 | Đọc GPU/màn hình trên Windows không cần admin | SPIKE-P6 | Chờ spike P6; `host-info` có fallback `unknown` |
| Q5 | Yêu cầu triển khai ghi "21 luật" nhưng SPEC-02 §6.4 liệt kê 22 (A1–A6, B1–B4, C1–C3, D1–D5, E1–E4) | SPEC-02 §6.4 | Đã cài 22; người duyệt xác nhận |

## 4. Giả định khi triển khai

Những điểm `docs/` không trả lời; đã chọn phương án nhất quán với kiến trúc. Người duyệt xem lại và sửa `docs/` nếu không đồng ý.

| # | Giả định | Feature | Lý do |
|---|---|---|---|
| G1 | Migration: schema Drizzle + SQL sinh bằng `drizzle-kit generate` đổi tên có số thứ tự (`0001_init.sql`); bộ áp migration riêng với bảng `pv_migrations(seq, name, applied_at)`, mỗi file một giao dịch; `max(seq)` trong CSDL > số file lớn nhất trong mã → từ chối mở | 001 | SPEC-00 §8 chỉ nói "bằng Drizzle, có số thứ tự, từ chối nếu CSDL mới hơn mã"; cách theo dõi phiên bản không nêu |
| G2 | Khóa một phiên bản: `service.lock` ghi `{pid, startedAt}`; PID không còn tồn tại → coi hết hạn, chiếm lại | 001 | SPEC-00 §11 chỉ nói "khóa file" |
| G3 | `${TÊN}` trong chuỗi cấu hình được thay bằng biến môi trường lúc tải; thiếu biến → giữ nguyên + cảnh báo | 001 | SPEC-00 §5 dùng `${FURY_API_PORT}` nhưng không nói cơ chế |
| G4 | Thư mục dữ liệu ghi đè được bằng `PV_APPDATA_DIR`, `PV_LOCALAPPDATA_DIR` (cho test và chạy dev) | 001 | Cần để test không đụng `%APPDATA%` thật |
| G5 | Kho bí mật: `DpapiSecretStore` (sản phẩm, Windows) + `MemorySecretStore` (chỉ test); định dạng `secrets.bin` = JSON `{ version: 1, entries: { key: base64(DPAPI blob) } }` | 001 | SPEC-00 §5 chỉ nói "mã hóa DPAPI" |
| G6 | Log tiến trình dạng NDJSON `service-YYYY-MM-DD.log`, xoay theo ngày, xóa > 7 ngày, che mọi giá trị đang có trong kho bí mật | 001 | SPEC-00 §5 chỉ nói "xoay vòng 7 ngày" |
| G8 | Bộ ánh xạ endpoint Fury giả định (GET `/api/status`, `/api/profiles`, `/api/profiles/:id`, `/api/profiles/:id/status`; POST `/api/profiles/:id/launch`, `/stop`, `/check-exit`) nằm ở `packages/fury-client/src/adapter/endpoint-map.ts` với `TODO(SPIKE-P2)`; FakeFury cài đúng bộ này | 002 | SPIKE-P2 chưa chạy; SPEC-01 §1 đòi chỉ `fury-client` đổi sau spike |
| G9 | Kiểu dữ liệu Fury (SPEC-01 §3) đặt ở `packages/contract/src/fury.ts` dạng Zod | 002 | SPEC-00 §2: mọi schema vào/ra ở contract |
| G10 | Thêm dependency `semver` để kiểm `config.fury.supportedVersions` | 002 | SPEC-00 §3 không liệt kê; ghi `docs/decisions.md` |
| G11 | Poller báo profile mở/đóng qua callback `onProfileStatusChanged` (DI) thay vì sự kiện bus; Health 003 nối để ghi `health_events` | 002 | SPEC-00 §10 không có sự kiện bus cho việc này |
| G12 | FakeFury ở `src/testing/fake-fury.ts`, xuất `@sctech/profilevault-fury-client/testing`; `test/fake-fury.ts` tái xuất; `launchHandler` tiêm được (007 tiêm Chromium thật) | 002 | SPEC-09 §3.1 đặt ở `test/` nhưng health/runner cũng cần dùng |
| G13 | R3 (trùng exit IP) phát hiện ngay sau mỗi kiểm proxy từ `proxy_checks` ok gần nhất của mọi binding; luật D1 (004) chỉ báo cáo cùng dữ liệu | 003 | SPEC-02 R3 "tự gỡ khi lần kiểm kế tiếp" = kiểm proxy |
| G14 | `consistency_clear`, `checklist_valid` là evaluator tiêm (004 đăng ký); mặc định chưa đạt | 003 | Hai điều kiện thuộc §6 |
| G15 | Toast "đạt ngưỡng" qua `onReadinessReached` (DI), không qua bus | 003 | SPEC-00 §10 không có sự kiện này |
| G16 | Số liệu run cho ngưỡng (`flow_success_rate`, `l2_correct_rate`, `event_count_by_mode`, `no_open_site_changed`) tính từ `health_events` do `recordRunOutcome` ghi, không đọc bảng `runs` | 003 | Health độc lập với Runner |
| G17 | Phiên bản Fury hiện tại lưu `settings['fury.currentVersion']` do poller cập nhật; chưa biết → `detect_suite_pass` chưa đạt | 003 | SPEC-02 không nói nguồn "phiên bản hiện tại" |
| G18 | Lịch kiểm proxy: RNG seed, giờ địa phương bằng `Intl` theo `config.ui.timezone`; lượt lỡ khi tắt tiến trình không chạy bù | 003 | SPEC-02 §7 chỉ nêu 4 khung giờ |
| G19 | Probe: `parseFuryCapture` thử các bộ chuyển đổi; bộ `furyCaptureV1` là giả định `TODO(SPIKE-P3)`; test dùng probe giả dạng chuẩn hóa | 004 | SPIKE-P3 chưa chạy |
| G20 | host-info: PowerShell CIM + `System.Windows.Forms.Screen`, timeout 3 s, lỗi → mảng rỗng và luật B2/B3 `unknown` | 004 | SPIKE-P6 chưa chạy |
| G21 | A4: `geolocation` `off`/`auto` → pass; `manual` cần tọa độ exit từ `city-coords.json`, thiếu → `unknown` | 004 | `ExitInfo` không có lat/lon |
| G22 | A2: múi giờ → quốc gia bằng `timezone-countries.json`; không có → `unknown` | 004 | SPEC-02 không nêu nguồn ánh xạ |
| G23 | A6: WebRTC IP nội bộ (RFC1918, mDNS) không coi là rò | 004 | SPEC-02 nói "⊆ {exit.ip} hoặc rỗng" không bàn IP nội bộ |
| G24 | D1/E1 chỉ báo cáo; R2/R3 đã áp ở kiểm proxy (003); R4 loại trừ D1/E1 | 004 | SPEC-02 §4.1 |
| G25 | Lịch sử sửa luật ghi `settings_history` key `consistency_rule:<id>`; `periodicDays` ở `settings.consistency` | 004 | SPEC-02 chỉ nói "có lịch sử thay đổi" |
| G26 | Gateway M0 chỉ phiên dashboard; `/internal/clients` (tạo/thu hồi token argon2id) cài sẵn cho trang Cài đặt, nhưng xác thực Bearer `/api/v1`/`/mcp` để M1 | 005 | SPEC-05 §1 (M0 REST nội bộ + phiên dashboard) |
| G27 | Endpoint job/run/lịch ủy quyền `RunnerFacade` tiêm được; chưa có Runner → 422 `FLOW_DISABLED` "Runner chưa sẵn sàng" | 005 | Runner ở 007 |
| G28 | Mã `/auth/open` và phiên dashboard giữ trong bộ nhớ (mất khi khởi động lại); `createOpenUrl()` cho tray | 005 | SPEC-05 §4.1 không nói lưu trữ |
| G29 | Nhập probe nhận cả multipart `file` lẫn JSON `{ raw }` | 005 | SPEC-05 §7 ghi multipart; JSON tiện cho skill/test |
| G30 | Biểu đồ SPEC-07 §8 tổng hợp trong gateway từ bảng §8; `settings.runner` gộp mặc định từ `config.runner`+`limits` để dashboard sửa | 005 | SPEC-07 §8 nói "server tổng hợp bằng SQL" |
| G7 | Cơ chế seed lần chạy đầu: `registerSeeder` idempotent; 003/004 đăng ký ngưỡng và luật mặc định | 001 | SPEC-00 §11 nói "ghi luật nhất quán và ngưỡng mặc định" nhưng nội dung ở SPEC-02 |

## 5. TODO(SPIKE-Pn) còn lại

Cập nhật sau mỗi feature (lệnh: `grep -rn --exclude-dir=dist "TODO(SPIKE-" packages apps packs tools`).

| Spike | File | Nội dung |
|---|---|---|
| SPIKE-P2 | `packages/fury-client/src/adapter/endpoint-map.ts:4` | * TODO(SPIKE-P2): toàn bộ đường dẫn, phương thức và tên trường dưới đây là GIẢ ĐỊNH (docs/progress.md G8). |
| SPIKE-P2 | `packages/fury-client/src/adapter/endpoint-map.ts:47` | /** `getProfile` có trả `seed` không. TODO(SPIKE-P2) */ |
| SPIKE-P5 | `packages/fury-client/src/adapter/endpoint-map.ts:49` | /** `checkExit` có trả `asnType` không. TODO(SPIKE-P5) */ |
| SPIKE-P2 | `packages/fury-client/src/adapter/endpoint-map.ts:76` | // ---- Schema thô (lỏng, passthrough) — TODO(SPIKE-P2) tên trường giả định ---- |
| SPIKE-P2 | `packages/fury-client/src/adapter/endpoint-map.ts:186` | /** Bộ ánh xạ mặc định — TODO(SPIKE-P2): xác minh từng route với Fury thật. */ |
| SPIKE-P5 | `packages/fury-client/src/adapter/endpoint-map.ts:238` | // TODO(SPIKE-P5): Fury có kiểm exit không mở trình duyệt không; định dạng asnType. |
| SPIKE-P2 | `packages/fury-client/src/adapter/endpoint-map.ts:259` | seed: 'missing', // TODO(SPIKE-P2) |
| SPIKE-P5 | `packages/fury-client/src/adapter/endpoint-map.ts:260` | asnType: 'fallback', // TODO(SPIKE-P5): nếu Fury trả asnType → native |
| SPIKE-P2 | `packages/fury-client/src/adapter/profile-config-file.ts:3` | * CHỈ ĐỌC. TODO(SPIKE-P2): vị trí file và định dạng là giả định; tiêm `locate`/`parse` sau spike. |
| SPIKE-P2 | `packages/fury-client/src/adapter/profile-config-file.ts:15` | /** Đường dẫn file cấu hình của profile. Mặc định `<dataDir>/profiles/<id>/profile.json` — TODO(SPIKE-P2). */ |
| SPIKE-P2 | `packages/fury-client/src/adapter/profile-config-file.ts:17` | /** Chuyển JSON thô → trường của FuryProfileDetail. Mặc định chỉ lấy các trường trùng tên — TODO(SPIKE-P2). */ |
| SPIKE-P2 | `packages/fury-client/src/testing/fake-fury.ts:3` | * Cài ĐÚNG bộ ánh xạ giả định ở src/adapter/endpoint-map.ts. TODO(SPIKE-P2): cập nhật cùng endpoint-map sau sp |
| SPIKE-P2 | `packages/fury-client/src/testing/fake-fury.ts:158` | // ---- xử lý HTTP (bộ ánh xạ giả định — TODO(SPIKE-P2)) ---- |
| SPIKE-P2 | `packages/fury-client/test/http-client.test.ts:87` | it('getProfile hợp nhất fallback file cấu hình (TODO(SPIKE-P2)) cho trường còn thiếu', async () => { |
| SPIKE-P2 | `packages/fury-client/test/version-adapter.test.ts:20` | describe('bộ ánh xạ endpoint mặc định (TODO(SPIKE-P2))', () => { |
| SPIKE-P3 | `packages/health/src/probe/converters.ts:3` | * TODO(SPIKE-P3): định dạng xuất thật của trang probe Fury chưa biết; `furyCaptureV1Converter` là giả định. |
| SPIKE-P3 | `packages/health/src/probe/converters.ts:31` | * TODO(SPIKE-P3): giả định trang probe Fury xuất `{ meta: { furyVersion, capturedAt }, fingerprint: { ... } }` |
| SPIKE-P3 | `packages/health/src/probe/normalize.ts:25` | * `converters` tiêm được (TODO(SPIKE-P3)). |
| SPIKE-P3 | `packages/health/test/probe.test.ts:13` | describe('chuẩn hóa probe (SPEC-02 §6.3, TODO(SPIKE-P3))', () => { |
| SPIKE-P6 | `packages/host-info/src/capture.ts:10` | * TODO(SPIKE-P6): xác nhận hai lệnh dưới trả đủ trường trong < 3 giây trên máy đích. |
| SPIKE-P6 | `packages/host-info/src/parse.ts:3` | /** Parse đầu ra `Get-CimInstance Win32_VideoController / Select Name, AdapterRAM / ConvertTo-Json`. TODO(SPIK |
| SPIKE-P6 | `packages/host-info/src/parse.ts:26` | /** Parse đầu ra `[System.Windows.Forms.Screen]::AllScreens / Select Primary, Bounds / ConvertTo-Json`. TODO(S |
| SPIKE-P6 | `packages/host-info/test/host-info.test.ts:57` | it.skipIf(process.platform !== 'win32')('đọc máy thật trên Windows trong < 3 s (TODO(SPIKE-P6))', async () =>  |

## 6. Thay đổi với `docs/`

Xem `docs/decisions.md`.

## 7. Lệnh

```powershell
pnpm install
pnpm build          # tsc -b mọi package
pnpm lint           # eslint type-checked
pnpm test           # build + vitest (unit + integration)
pnpm dev            # apps/service qua tsx (PV_APPDATA_DIR / PV_LOCALAPPDATA_DIR để đổi thư mục dữ liệu)
```

Mở dashboard: menu tray → "Mở dashboard" (hoặc xem mục "Lệnh" sau khi feature 005/006 xong).
