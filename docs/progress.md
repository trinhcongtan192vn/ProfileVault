# Tiến độ triển khai ProfileVault

**Cập nhật:** 2026-10-15 (M1 + M2 xong code) · **Giai đoạn:** chờ spike live (P1, P4, P7) và nghiệm thu thủ công · **Nguồn sự thật:** `docs/prd.md` (= `profilevault-prd.md`), `docs/architecture.md` (= `profilevault-agent-architecture.md`), `docs/specs/SPEC-00…09`, `docs/specs/SPIKE-ke-hoach.md`.

File này để một phiên làm việc mới tiếp tục được từ chỗ dừng. Cập nhật sau mỗi feature.

**Điểm dừng hiện tại:** code M0, M1, M2 xong, đã commit/push; `pnpm build`, `pnpm lint`, `pnpm test` xanh (300+ Vitest, 19 Playwright).
- Fury thật 0.3.22 đã cài trên máy dev; ProfileVault tự cài Fury (SPEC-00 §11.1), tự bật API (`FURY_API_PORT`) và đọc token.
- Spike: **P2** đạt một phần (adapter API thật), **P3** đạt một phần (bộ đọc probe theo mã nguồn; còn capture thật), **P5** đạt có giới hạn (tra exit; ASN xác nhận tay), **P6** đạt. **P1** đang chạy (người dùng theo dõi 7 ngày, profile test không proxy). **P4**, **P7** chưa chạy.
- **M1 viết trước khi P4 đạt** theo yêu cầu người dùng (2026-10-15, decisions.md): flow có chế độ L2/L3 (`youtube/upload`) **bị khóa trong code** tới khi người bấm "Xác nhận P4 đạt" ở Cài đặt → Runner (`settings['spike.p4Passed']`). Locator Studio còn `TODO(SPIKE-P4)`.
- Còn nghiệm thu thủ công: 006 T015 (tray, toast, autostart trên desktop), các kịch bản Live của SPEC-09 §6 (M-1, M1, M2).

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
| 004 | `packages/health` phần 2: chuẩn hóa probe (`TODO(SPIKE-P3)`), 22 luật (SPEC-02 §6.4 có 22, không phải 21), checklist HMAC, `packages/host-info` (P6 đã xác minh) | SPEC-02 §6 | ✅ xong | 56 test health; `specs/004-consistency-rules/` |
| 008 | Tự cài Fury: `FuryInstaller` (`packages/fury-client`), `GET/POST /internal/fury/install`, banner dashboard, `config.fury.autoInstall` | SPEC-00 §11.1 | ✅ xong | 8 test installer + wiring; quyết định trong decisions.md |
| 005 | `packages/gateway` M0: Fastify loopback, kiểm Host/Origin, phiên dashboard `/auth/open`, toàn bộ `/internal/*`, SSE, audit, mã lỗi HTTP | SPEC-05 §2–4.1, §5.2, §7, §9–11 | ✅ xong | 21 test; `specs/005-gateway-internal/`; Runner facade chờ 007 |
| 006 | `apps/dashboard` + tray + toast: 8 trang, wizard gắn kênh, khai báo một chạm, biểu đồ, Chờ bạn, Cài đặt | SPEC-07 | ⚠️ xong code | 17/18 task; T015 còn nghiệm thu desktop. Smoke Chromium đã kiểm wizard 2 kênh, upload/undo/SSE/CAPTCHA/CSV |
| 007 | `packages/runner`: Flow contract, `ctx.ui`, humanGate, Runner, lịch + chạy bù, linter `tools/eslint-plugin-pv`; pack `generic/session-check` và `youtube/session-check` với fixture HTML | SPEC-03; SPEC-04 §2.1–2.2, §3, §4 | ✅ xong code | 15/15 task; Runner thật nối bootstrap/gateway; CDP Chromium thật qua FakeFury, không Fury thật |
| — | Bước 5: `spikes/` P1–P7 + `docs/specs/SPIKE-bao-cao.md` (mẫu trống) | SPIKE-ke-hoach | ✅ chuẩn bị | Script/hướng dẫn và mẫu báo cáo; không chạy spike. Server mẫu MCP P7 cần chuẩn bị trong phiên spike/M1 |

Ký hiệu: ⏳ chưa làm · 🔄 đang làm · ✅ xong · ⚠️ xong có ghi chú.

## 2b. M1 và M2

Làm trực tiếp theo `docs/` (không qua chu trình Spec Kit cho từng phần, decisions.md 2026-10-15); mỗi phần một commit, lint + test xanh trước commit.

| Phần | Nội dung | Spec gốc | Trạng thái | Ghi chú |
|---|---|---|---|---|
| P3 | Bộ đọc probe `furyDetectSuiteConverter` theo `probe.js` của Fury | SPEC-02 §6.3 | ✅ | `9f3fef7`; còn capture thật để kiểm E2 |
| P5 | Kiểm exit bằng tra IP (máy / `last_ip` proxy của Fury), không phát cờ khi không có bằng chứng | SPEC-01 §4 | ✅ | `f60d4e8`; thử thật VN/AS45899 |
| F18 | `packages/jobs` Job service: kiểm SPEC-06 §3 bước 1–10, idempotency, file trong `allowed_roots` + SHA-256, giới hạn upload/ngày, accounts/flows/get/list/cancel | SPEC-06 | ✅ | `672e0a0`; 7 test |
| F20 | `/api/v1/*` + Bearer (argon2, cache, thu hồi tức thì) + 429; MCP `/mcp` 15 tool lọc scope; audit client | SPEC-05 §4.2, §6, §8; SPEC-06 §5 | ✅ | `672e0a0`; test tích hợp REST + client MCP SDK |
| F17/F19 | `youtube/upload` (L2/L3, 11 bước), `generic/probe`, `generic/read-page`, `generic/open-and-wait` | SPEC-04 | ✅ | `bc2af05`; 12 test Playwright trên trang giả lập |
| F20 | Contract package: `ProfileVaultClient`, `MockProfileVault`, `defineContractSuite` (chạy với server giả lập và thật) | SPEC-06 §7; SPEC-09 §5 | ✅ | `da23cb2` |
| M1 UI | Xác nhận P4, gửi job từ dashboard, tóm tắt metadata ở gate L2 | SPEC-07 | ✅ | `8201dd2` |
| F21 | Plugin skill `skills/profilevault` (router, account-setup, job-planner, health-check, flow-author) | SPEC-08 | ✅ | `03a3a9e`; test metadata + mẫu flow lint sạch |

**Chưa làm / để sau:** trace OpenTelemetry theo `source.traceparent` (SPEC-06 §8 — không thêm dependency khi chưa cần); `notifications/progress` chỉ gửi trong `pv_jobs_wait` (MCP không trạng thái); khai báo header MCP trên Claude Desktop chờ P7; trình cài đặt NSIS đóng gói `node.exe` (SPEC-00 §11) — hiện dùng script `Open-ProfileVault`.


## 3. Câu hỏi mở

| # | Câu hỏi | Liên quan | Trạng thái |
|---|---|---|---|
| Q1 | Định dạng thật của Automation API Fury (endpoint, JSON) | SPEC-01 §4, SPIKE-P2 | **Đã trả lời** (P2, 2026-10-14): SPEC-01 §4 |
| Q2 | Định dạng file probe của Fury | SPEC-02 §6.3, SPIKE-P3 | **Đã trả lời** từ mã nguồn `probe.js` (2026-10-15); còn kiểm capture thật |
| Q3 | Fury có kiểm exit proxy không mở trình duyệt và phân loại ASN không | SPEC-01 §4, SPIKE-P5 | **Đã trả lời** (P5, 2026-10-15): Fury không có; ProfileVault tra exit; ASN xác nhận tay |
| Q4 | Đọc GPU/màn hình trên Windows không cần admin | SPIKE-P6 | **Đã trả lời 2026-10-14:** đọc được, ~170 ms, không cần admin; VRAM không đáng tin (trần 4 GB) — xem SPIKE-bao-cao |
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
| G8 | Bộ ánh xạ endpoint Fury giả định (GET `/api/status`, `/api/profiles`, `/api/profiles/:id`, `/api/profiles/:id/status`; POST `/api/profiles/:id/launch`, `/stop`, `/check-exit`) nằm ở `packages/fury-client/src/adapter/endpoint-map.ts` với `TODO(SPIKE-P2)`; FakeFury cài đúng bộ này | 002 | **Thay bằng API thật sau SPIKE-P2** (SPEC-01 §4) |
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
| G19 | Probe: `parseFuryCapture` thử các bộ chuyển đổi; bộ giả định `furyCaptureV1` đã thay bằng `furyDetectSuiteConverter` theo mã nguồn Fury | 004 | SPIKE-P3 (2026-10-15) |
| G20 | host-info: PowerShell CIM + `System.Windows.Forms.Screen`, timeout 3 s, lỗi → mảng rỗng và luật B2/B3 `unknown` | 004 | SPIKE-P6 đã xác minh 2026-10-14 |
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
| G31 | Hoàn tác khai báo một chạm = ghi `manual.note` với `payload.undoOf` (≤ 10 phút, chỉ upload/note); `event_count` bỏ sự kiện bị hoàn tác | 006 | SPEC-07 §5 "hoàn tác = ghi sự kiện bù, không xóa" |
| G32 | Thêm endpoint tổng hợp `/internal/overview`, `/internal/inbox`, undo; `/auth/open?next=` để toast mở đúng trang | 006 | Giảm số request; SPEC-05 §7 không cấm |
| G33 | UI kiểm bằng test thuần + SSR (`renderToString`); nghiệm thu giao diện thủ công | 006 | SPEC-09 AT-M0-1/2 ghi "thủ công"; không thêm jsdom |
| G34 | Tray "Thoát" xác nhận bằng bấm lần hai trong 10 s; icon .ico sinh bằng mã; autostart qua `reg add HKCU...Run` | 006 | systray2 không có hộp thoại; NSIS (SPEC-00 §11) để sau |
| G35 | Slots lịch theo binding/ngày lưu ở `settings['schedule.slots:<id>']`; bảng schedules giữ nextRunAt tổng hợp, client scheduler dùng idempotency key theo spec | 007 | Bảng nền tảng chỉ có một next_run_at cho lịch nhiều binding |
| G36 | Checkpoint phiên bản 1 giữ state, kết quả bước, tên bước, gate results và chỉ số gate cuối từng bước; replay flow bỏ bước đã xong | 007 | Cần khôi phục giá trị trả về của step/gate khi tiến trình tắt |
| G37 | Selector/URL session-check hiện dùng fixture + TODO(SPIKE-P4); test CDP dùng Chromium thường và FakeFury | 007 | Chưa có bằng chứng live P4 |
| G38 | Pack có dist/index.js xuất mảng flows; nạp pack chính thức và extensions/flows, lint TS/JS trước import, kiểm JSON Schema bằng Ajv | 007 | Cơ chế entry module chưa được SPEC-03 chốt; Ajv ghi trong decisions.md |
| G39 | Job service gửi `mode`: binding L3 + flow có L3 → `L3`, ngược lại `L2`; Runner kiểm lại mức trước khi mở profile | M1 | SPEC-06 §3 |
| G40 | Client đặc biệt `dashboard` gửi qua `POST /internal/jobs`, có mọi scope, đi qua cùng kiểm tra; `scheduler` gọi Runner trực tiếp như M0 | M1 | SPEC-06 §2 |
| G41 | Cache xác thực token theo sha256(token) trong bộ nhớ; thu hồi kiểm CSDL mỗi request; `last_used_at` ghi tối đa mỗi phút | M1 | argon2 mỗi request quá chậm |
| G42 | MCP không trạng thái: mỗi request một `McpServer` chỉ đăng ký tool trong scope; `pv_jobs_wait` nghe bus `run.status_changed` | M1 | SPEC-05 §6 |
| G43 | Phụ đề trong `youtube/upload` là file `{ path, sha256, language }` để đi qua kiểm SHA-256 | M1 | SPEC-04 §5.1 chỉ có `{ path, language }`; decisions.md |
| G44 | `generic/probe` gọi `window.furyProbe()` trên `probe_url` Fury trả khi mở profile; flow generic được thêm domain loopback của chính manifest | M1 | SPEC-04 §2.3 |
| G45 | Gate L2 kèm `summary` = input của job, file chỉ còn tên + 12 ký tự SHA | M1 | SPEC-07 §4.4 |
| G46 | Runner hủy vì dừng/hạ mức → run `cancelled`, job `rejected` | M1 | SPEC-06 §4 |
| G7 | Cơ chế seed lần chạy đầu: `registerSeeder` idempotent; 003/004 đăng ký ngưỡng và luật mặc định | 001 | SPEC-00 §11 nói "ghi luật nhất quán và ngưỡng mặc định" nhưng nội dung ở SPEC-02 |

## 5. TODO(SPIKE-Pn) còn lại

Cập nhật sau mỗi feature (lệnh: `grep -rn --exclude-dir=dist "TODO(SPIKE-" packages apps packs tools`).

| Spike | File | Nội dung |
|---|---|---|
| SPIKE-P4 | `packages/runner/src/runner.ts` | Vòng đời CDP Fury (launch → connectOverCDP → stop) chưa thử với Fury thật |
| SPIKE-P4 | `packs/youtube/data/locators.en.json`, `packs/youtube/src/flows/{session-check,upload}.ts` | Locator/URL/thời gian chờ YouTube Studio giả định; chốt bằng Playwright Inspector trên kênh test |

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

Mở app bản thử từ mã nguồn: bấm đúp `Open-ProfileVault.cmd` (hoặc `.vbs`; Git Bash: `./open-profilevault.sh`).
Script chạy `tools/launch-local.ps1`: lần đầu hỏi rồi `pnpm install`, mỗi lần `pnpm build`, khởi động dịch vụ với dữ liệu riêng
`.pv-data/local` (đã gitignore) và mở dashboard. Khi dịch vụ đang chạy, bấm lại chỉ mở dashboard. Cần Node 22 + pnpm 10.
Đang chạy: menu tray → "Mở dashboard" (hoặc bấm lại lối tắt).

Tích hợp app ngoài: tạo token ở Cài đặt → Ứng dụng kết nối; REST `http://127.0.0.1:50410/api/v1`, MCP `http://127.0.0.1:50410/mcp` (Bearer). Client mẫu và contract test: `@sctech/profilevault-contract` (`ProfileVaultClient`, `/testing`). Skill Claude: `skills/profilevault/README.md`.
