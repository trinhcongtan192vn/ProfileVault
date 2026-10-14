# Feature Specification: Nền tảng monorepo (001)

**Feature Branch**: `001-foundation-monorepo`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Triển khai Monorepo pnpm, packages/contract, packages/db (schema + migration SQLite đầy đủ), config, bí mật DPAPI, bus sự kiện, khóa một phiên bản, bootstrap apps/service theo SPEC-00 toàn bộ. Tài liệu đó là nguồn sự thật; spec.md chỉ chốt phạm vi feature này, liệt kê yêu cầu PRD liên quan và trỏ tới mục của spec gốc, không chép lại toàn bộ."

**Spec gốc (nguồn sự thật)**: `docs/specs/SPEC-00-nen-tang.md` (toàn bộ: §2 quy ước, §3 công nghệ, §4 cấu trúc repo, §5 thư mục và cấu hình, §6 định danh, §7 enum, §7.1 loại sự kiện, §8 schema CSDL, §9 mã lỗi, §10 bus sự kiện, §11 đóng gói — phần "lần chạy đầu" và "một phiên bản"). Liên quan: PRD §11 (bảo mật: bí mật qua DPAPI, dữ liệu cục bộ ≥ 12 tháng), kiến trúc §2 nguyên tắc 1, 6.

## Phạm vi

**Trong phạm vi:** khung monorepo pnpm chạy được (build, lint, test); `packages/contract` với enum, ID, mã lỗi, định dạng lỗi, schema cấu hình, schema sự kiện bus; `packages/db` với toàn bộ bảng SPEC-00 §8, migration có số thứ tự, mở CSDL đúng PRAGMA, từ chối CSDL mới hơn mã, repository cơ bản (settings + lịch sử, audit append-only, truy cập thô cho package sau); tải cấu hình `config.json` với giá trị mặc định và đường dẫn thư mục §5; kho bí mật `secrets.bin` qua DPAPI; bus sự kiện có kiểm kiểu; khóa một phiên bản `service.lock`; `apps/service` bootstrap lần chạy đầu (tạo thư mục, khởi tạo CSDL, sinh khóa HMAC, ghi cài đặt mặc định) và log xoay vòng 7 ngày.

**Ngoài phạm vi (feature sau):** nội dung nghiệp vụ của bảng (Health 003/004, Runner 007, Gateway 005), ngưỡng và luật mặc định (003/004 cung cấp bộ seed; 001 chỉ cung cấp cơ chế seed), tray/toast/dashboard (006), trình cài đặt NSIS và khóa tự khởi động (SPEC-00 §11 — hoãn tới khi đóng gói), MCP, OpenTelemetry (M1).

## Clarifications

### Session 2026-10-14

- Q: Migration dùng cơ chế nào để vừa "bằng Drizzle" vừa "có số thứ tự" và "từ chối CSDL mới hơn mã"? → A: Schema khai bằng Drizzle (`packages/db/src/schema.ts`); SQL migration sinh bằng `drizzle-kit generate` rồi đổi tên có số thứ tự `0001_init.sql`…; bộ áp migration riêng của ProfileVault (bảng `pv_migrations(seq, name, applied_at)`, mỗi file một giao dịch); `max(seq)` trong CSDL > số file lớn nhất trong mã → từ chối mở. (SPEC-00 §8 cuối; chi tiết là giả định, ghi ở `docs/progress.md`.)
- Q: Kho bí mật trên máy không phải Windows (CI Linux) làm gì? → A: `SecretStore` có hai bản: `DpapiSecretStore` (Windows, sản phẩm) và `MemorySecretStore` (chỉ test, phải truyền tường minh). Bootstrap sản phẩm trên nền tảng không phải Windows thoát với lỗi `FURY_CAPABILITY_MISSING`-tương-đương nội bộ `PLATFORM_UNSUPPORTED` (chỉ dùng nội bộ, không phải mã API). (SPEC-00 §3, §5; PRD §11 Nền tảng: Windows 10/11.)
- Q: Khóa `service.lock` còn sót sau crash xử lý thế nào? → A: File ghi `{ pid, startedAt }`; nếu PID không còn tồn tại (`process.kill(pid, 0)` ném `ESRCH`) thì coi hết hạn và chiếm lại; nếu còn → thoát. (SPEC-00 §11 chỉ nói "khóa file"; cách phát hiện là giả định.)
- Q: `${FURY_API_PORT}` trong `config.fury.apiBaseUrl` mặc định hiểu thế nào? → A: Thay thế `${TÊN}` bằng biến môi trường cùng tên lúc tải cấu hình; thiếu biến → giữ nguyên chuỗi, ghi cảnh báo, `FuryClient` (002) sẽ báo `FURY_OFFLINE` khi URL không hợp lệ. Người dùng có thể ghi URL cố định trong `config.json`. (SPEC-00 §5.)
- Q: Seed ngưỡng/luật mặc định lần chạy đầu (SPEC-00 §11) thuộc feature nào? → A: 001 cung cấp cơ chế `registerSeeder(name, fn)` idempotent chạy sau migration; nội dung ngưỡng (SPEC-02 §3.3) và luật (SPEC-02 §6.4) do 003/004 đăng ký. 001 seed `settings.schema_version` và `settings.runner` (`humanize`, `traceAlways`) với mặc định hợp lý ghi ở plan.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Khung monorepo chạy được (Priority: P1)

Người phát triển clone repo, cài dependency, build, lint, test; mọi lệnh xanh; cấu trúc thư mục đúng SPEC-00 §4; mọi package là TypeScript strict.

**Why this priority**: mọi feature sau xây trên khung này.

**Independent Test**: `pnpm install && pnpm build && pnpm lint && pnpm test` trên máy sạch Windows với Node 22 → exit 0.

**Acceptance Scenarios**:

1. **Given** repo mới clone, **When** chạy `pnpm install && pnpm build`, **Then** mọi package trong `apps/*`, `packages/*`, `packs/*`, `tools/*` biên dịch không lỗi.
2. **Given** một file TS dùng `any` ngầm hoặc thiếu kiểu, **When** chạy `pnpm lint`, **Then** lệnh thất bại (strict bật).
3. **Given** repo, **When** chạy `pnpm test`, **Then** Vitest chạy test của mọi package và xanh.

---

### User Story 2 - Package contract dùng chung (Priority: P1)

Mọi package nhập enum, kiểu ID, mã lỗi, định dạng lỗi, schema cấu hình và schema sự kiện từ một nơi duy nhất (`packages/contract`), suy kiểu từ Zod.

**Why this priority**: SPEC-00 §2 bắt buộc mọi schema ở `packages/contract`; các feature sau phụ thuộc.

**Independent Test**: unit test của `packages/contract` kiểm từng enum/ID/mã lỗi khớp SPEC-00 §6, §7, §7.1, §9.

**Acceptance Scenarios**:

1. **Given** chuỗi `ab_01J...` (ULID hợp lệ), **When** parse bằng schema `BindingId`, **Then** hợp lệ; chuỗi `xx_...` hoặc ULID sai → không hợp lệ.
2. **Given** hàm sinh ID cho tiền tố `he_`, **When** gọi 1000 lần, **Then** 1000 giá trị khác nhau, đúng tiền tố, phần ULID 26 ký tự Crockford base32, sắp xếp được theo thời gian.
3. **Given** mã lỗi `LEVEL_TOO_LOW`, **When** tạo đối tượng lỗi API, **Then** JSON có dạng `{ error: { code, message, detail } }`; mã ngoài danh sách SPEC-00 §9 và không khớp mẫu `<PACK>_<NAME>` → không hợp lệ.
4. **Given** bảng loại sự kiện SPEC-00 §7.1, **When** tra `he.type` → `{ source, severity }`, **Then** mọi loại trong bảng có mặt với đúng nguồn và mức.

---

### User Story 3 - CSDL SQLite đầy đủ với migration (Priority: P1)

Dịch vụ mở CSDL SQLite ở đường dẫn cấu hình với `journal_mode=WAL`, `foreign_keys=ON`, áp migration có số thứ tự tạo đủ 21 bảng và chỉ mục SPEC-00 §8; từ chối chạy nếu CSDL ghi phiên bản schema mới hơn mã.

**Why this priority**: mọi dữ liệu của hệ thống nằm ở đây; schema phải khớp spec từ đầu để feature sau không phải sửa.

**Independent Test**: integration test mở CSDL file tạm, chạy migration, truy vấn `sqlite_master` so với danh sách bảng/cột/chỉ mục/ràng buộc của SPEC-00 §8.

**Acceptance Scenarios**:

1. **Given** file CSDL chưa tồn tại, **When** mở và migrate, **Then** đủ 21 bảng: `settings`, `settings_history`, `bindings`, `binding_pauses`, `level_changes`, `health_events`, `proxy_checks`, `asn_attestations`, `probe_results`, `detect_suite_results`, `account_checklists`, `host_snapshots`, `consistency_rules`, `consistency_runs`, `consistency_results`, `jobs`, `runs`, `run_steps`, `schedules`, `clients`, `audit_events`, cộng bảng theo dõi migration; chỉ mục `ix_pauses_open`, `ix_events_binding_time`; ràng buộc `UNIQUE`, `CHECK`, `REFERENCES` đúng spec.
2. **Given** CSDL đã migrate, **When** mở lần hai, **Then** không chạy lại migration, dữ liệu giữ nguyên.
3. **Given** CSDL ghi phiên bản schema lớn hơn phiên bản mã biết, **When** mở, **Then** từ chối với lỗi rõ ràng, không sửa file.
4. **Given** chèn `binding_pauses` tham chiếu `binding_id` không tồn tại, **When** thực hiện, **Then** lỗi khóa ngoại (foreign_keys bật).
5. **Given** `health_events`, `level_changes`, `audit_events`, `settings_history`, **When** gọi repository, **Then** chỉ có thao tác thêm và đọc (không có hàm sửa/xóa, trừ dọn theo retention).
6. **Given** đổi `settings.thresholds`, **When** ghi qua repository với `actor`, **Then** có dòng `settings_history` với `old_json`, `new_json`, `actor`.

---

### User Story 4 - Cấu hình, thư mục, bí mật, khóa phiên bản (Priority: P2)

Dịch vụ đọc `config.json` (gộp với mặc định SPEC-00 §5), biết mọi đường dẫn §5, lưu/đọc bí mật qua DPAPI trong `secrets.bin`, và chỉ cho một tiến trình chạy tại một thời điểm.

**Why this priority**: cần trước khi có Fury token (002), khóa HMAC (004), artifact run (007); nhưng có thể test độc lập với US3.

**Independent Test**: unit test với thư mục dữ liệu tạm (ghi đè qua biến môi trường) cho cấu hình, bí mật, khóa.

**Acceptance Scenarios**:

1. **Given** không có `config.json`, **When** tải cấu hình, **Then** nhận đúng giá trị mặc định §5 (`gateway.port = 50410`, `runner.maxConcurrentIdle = 6`, `limits.uploadsPerAccountPerDay = 10`, `retention.dataMonths = 12`, `ui.timezone = "Asia/Bangkok"`…).
2. **Given** `config.json` ghi `{ "gateway": { "port": 50500 } }`, **When** tải, **Then** `gateway.port = 50500`, các khóa khác giữ mặc định; giá trị sai kiểu → lỗi `INPUT_INVALID` nêu đường dẫn khóa.
3. **Given** `fury.apiBaseUrl` chứa `${FURY_API_PORT}`, **When** tải với biến môi trường `FURY_API_PORT=9222`, **Then** URL thành `http://127.0.0.1:9222`; thiếu biến → giữ nguyên chuỗi và cảnh báo.
4. **Given** kho bí mật trống, **When** ghi `fury.token` rồi đọc lại, **Then** đúng giá trị; file `secrets.bin` trên đĩa không chứa giá trị gốc dạng văn bản.
5. **Given** tiến trình A đang giữ `service.lock`, **When** tiến trình B khởi động, **Then** B thoát với thông báo "đang chạy phiên bản khác"; khi A thoát (kể cả crash), B khởi động được.
6. **Given** mọi đường dẫn §5, **When** gọi bộ phân giải đường dẫn, **Then** trả `%APPDATA%\ProfileVault\{config.json, secrets.bin, profilevault.db, extensions\flows\}` và `%LOCALAPPDATA%\ProfileVault\{runs\, probes\, logs\}`; biến môi trường ghi đè gốc cho test.

---

### User Story 5 - Bus sự kiện và bootstrap lần chạy đầu (Priority: P2)

Các package giao tiếp qua một bus sự kiện có kiểm kiểu (tên sự kiện SPEC-00 §10, payload Zod); `apps/service` khởi động theo thứ tự: khóa → thư mục → cấu hình → bí mật (sinh khóa HMAC nếu chưa có) → CSDL + migration → seed cài đặt mặc định → bus → log; tắt an toàn khi nhận tín hiệu.

**Why this priority**: điểm nối của mọi feature sau; có thể test với module giả.

**Independent Test**: integration test khởi động bootstrap với thư mục tạm, kiểm trạng thái sau lần 1 và lần 2.

**Acceptance Scenarios**:

1. **Given** bus, **When** phát `binding.level_changed` với payload sai schema, **Then** ném lỗi và không có listener nào nhận; payload đúng → mọi listener nhận đúng thứ tự đăng ký.
2. **Given** thư mục dữ liệu trống, **When** bootstrap chạy, **Then** tạo đủ thư mục §5, `secrets.bin` có khóa HMAC 32 byte, CSDL đã migrate, `settings` có `schema_version` và các cài đặt mặc định do seeder đăng ký; `audit_events` có dòng `system.first_run`.
3. **Given** đã bootstrap, **When** chạy lại, **Then** không sinh khóa HMAC mới, không ghi `system.first_run` lần hai.
4. **Given** dịch vụ đang chạy, **When** nhận yêu cầu dừng, **Then** đóng CSDL, nhả khóa, exit 0.
5. **Given** log, **When** ghi liên tục qua 8 ngày (đồng hồ giả), **Then** chỉ còn file log của 7 ngày gần nhất; nội dung log không chứa giá trị bí mật đã ghi vào kho bí mật.

### Edge Cases

- `config.json` hỏng JSON → dịch vụ không khởi động, báo đường dẫn file và vị trí lỗi; không ghi đè file.
- `secrets.bin` hỏng hoặc được mã hóa bởi tài khoản Windows khác → lỗi rõ ràng "không giải mã được", hướng dẫn xóa file và nhập lại token; không xóa tự động.
- Khóa `service.lock` còn sót sau crash (tiến trình ghi trong file không còn tồn tại) → coi là hết hạn, chiếm lại.
- Migration thất bại giữa chừng → giao dịch hoàn tác, phiên bản schema không tăng, dịch vụ báo lỗi và thoát.
- Thư mục `%APPDATA%` không ghi được → lỗi rõ ràng, thoát.
- Nền tảng không phải Windows (CI/Linux) → kho bí mật dùng bản dự phòng chỉ cho test (đánh dấu rõ, không dùng trong sản phẩm); DPAPI chỉ bắt buộc trên Windows.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Repo là pnpm workspace theo SPEC-00 §4 với các gói `apps/service`, `apps/dashboard` (khung trống), `packages/contract`, `packages/db`, `packages/core` (hạ tầng dùng chung: cấu hình, bí mật, bus, khóa, log — xem `docs/decisions.md`), `packages/fury-client`, `packages/health`, `packages/runner`, `packages/jobs`, `packages/gateway`, `packages/host-info`, `packs/generic`, `packs/youtube`, `tools/eslint-plugin-pv` (gói sau 001 chỉ là khung tối thiểu biên dịch được); lệnh gốc `build`, `lint`, `test`, `dev`.
- **FR-002**: Mọi gói TypeScript `strict: true`, ESM, Node 22; ESLint cấu hình chung; Vitest cấu hình workspace.
- **FR-003**: `packages/contract` (tên `@sctech/profilevault-contract`) xuất Zod schema và kiểu cho: enum SPEC-00 §7 (`Platform`, `AutomationLevel`, `Severity`, `RuleStatus`, `EventSeverity`, `EventSource`, `JobStatus`, `RunStatus`, `PauseReason`); bảng loại sự kiện §7.1 (type → source, severity mặc định); ID có tiền tố §6 (schema từng loại + hàm sinh ULID); mã lỗi §9 (danh sách + cờ thử lại + mẫu mã pack) và định dạng lỗi API; `config.json` §5 với mặc định; sự kiện bus §10 (tên + payload); hằng `CONTRACT_VERSION = 'profilevault/v1'`.
- **FR-004**: `packages/db` định nghĩa bằng Drizzle toàn bộ bảng, cột, kiểu, mặc định, `CHECK`, `UNIQUE`, `REFERENCES`, chỉ mục của SPEC-00 §8, kể cả chỉ mục một phần `ix_pauses_open ... WHERE cleared_at IS NULL`.
- **FR-005**: Migration là file SQL có số thứ tự trong `packages/db/migrations/`; bảng theo dõi migration ghi số và thời điểm; mở CSDL áp `PRAGMA journal_mode=WAL; foreign_keys=ON`; mỗi migration chạy trong một giao dịch; CSDL có số migration lớn hơn mã → từ chối mở.
- **FR-006**: `packages/db` cung cấp repository: `settings` (get/set với `settings_history`, `actor`), `audit` (append + truy vấn), hàm tạo CSDL test trong file tạm, và truy cập Drizzle thô cho package sau; không có hàm sửa/xóa cho bốn bảng chỉ thêm (trừ `prune(retention)`).
- **FR-007**: Mô-đun cấu hình: tải `config.json`, gộp sâu với mặc định §5, kiểm bằng schema contract, thay thế `${ENV}` trong chuỗi, cho phép ghi đè thư mục gốc dữ liệu qua biến môi trường (`PV_APPDATA_DIR`, `PV_LOCALAPPDATA_DIR`) cho test; bộ phân giải đường dẫn §5.
- **FR-008**: Kho bí mật: giao diện `SecretStore` (`get`, `set`, `delete`, `list keys`), bản Windows DPAPI (phạm vi người dùng hiện tại) ghi `secrets.bin` dạng mã hóa; khóa tên cố định: `fury.token`, `hmac.key`, `llm.apiKey`; bản dự phòng trong bộ nhớ chỉ cho test; không bao giờ log giá trị.
- **FR-009**: Bus sự kiện: đăng ký/phát theo tên SPEC-00 §10 với payload kiểm Zod; listener lỗi không làm hỏng listener khác (lỗi được log); hỗ trợ `once` và hủy đăng ký.
- **FR-010**: Khóa một phiên bản: file `service.lock` chứa PID + thời điểm; chiếm được khi không có file, hoặc PID trong file không còn chạy; nhả khi tắt bình thường.
- **FR-011**: `apps/service` bootstrap theo thứ tự US5; cung cấp đăng ký "seeder" để package sau ghi cài đặt/luật mặc định lần đầu (idempotent); ghi `audit_events` `system.first_run` và `system.started`; xử lý SIGINT/SIGTERM để tắt an toàn.
- **FR-012**: Log tiến trình ghi `%LOCALAPPDATA%\ProfileVault\logs\service-YYYY-MM-DD.log`, dạng NDJSON, xoay theo ngày, xóa file cũ hơn 7 ngày; có bộ lọc che giá trị bí mật (mọi giá trị đang có trong kho bí mật) trước khi ghi.
- **FR-013**: Mọi thời gian lưu dạng ISO 8601 UTC; hàm tiện ích `Clock` (`now()`), bản thật và bản giả cho test (SPEC-09 §3.2), đặt trong `packages/contract` hoặc gói tiện ích dùng chung.

### Key Entities

- Toàn bộ thực thể SPEC-00 §8 (không định nghĩa lại ở đây): `settings`, `settings_history`, `bindings`, `binding_pauses`, `level_changes`, `health_events`, `proxy_checks`, `asn_attestations`, `probe_results`, `detect_suite_results`, `account_checklists`, `host_snapshots`, `consistency_rules`, `consistency_runs`, `consistency_results`, `jobs`, `runs`, `run_steps`, `schedules`, `clients`, `audit_events`.
- **Migration record**: số thứ tự, tên, thời điểm áp.
- **Secret entry**: tên khóa cố định → giá trị (chỉ tồn tại giải mã trong bộ nhớ).
- **Lock record**: PID, thời điểm chiếm.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Trên máy Windows sạch có Node 22 và pnpm, từ clone tới `build + lint + test` xanh ≤ 10 phút, không cần thao tác tay.
- **SC-002**: Schema CSDL sau migration khớp 100% bảng, cột, ràng buộc và chỉ mục của SPEC-00 §8 (kiểm bằng test tự động).
- **SC-003**: Bootstrap lần đầu trên thư mục trống xong ≤ 5 giây; lần hai ≤ 2 giây và không tạo thêm bản ghi "first run".
- **SC-004**: Không có giá trị bí mật nào xuất hiện ở dạng văn bản trong `secrets.bin`, log, hay `audit_events` (kiểm bằng test grep).
- **SC-005**: Hai tiến trình dịch vụ không bao giờ chạy đồng thời trên cùng thư mục dữ liệu (test khóa).

## Assumptions

- Dependency đúng stack SPEC-00 §3; phiên bản cụ thể ghi trong `plan.md`; không thêm gói ngoài stack trừ tiện ích nhỏ có ghi lý do ở `docs/decisions.md`.
- `apps/dashboard` ở 001 chỉ là khung Vite trống biên dịch được; nội dung ở 006.
- Trình cài đặt NSIS, `node.exe` đóng gói và khóa tự khởi động (SPEC-00 §11) hoãn tới giai đoạn đóng gói; 001 chạy bằng `pnpm dev` / `node dist/main.js`.
- Dọn dữ liệu theo `retention.dataMonths` chỉ cung cấp hàm `prune`; lịch gọi do feature sau (003) đăng ký.
- Thư mục dữ liệu test ghi đè qua biến môi trường để không đụng `%APPDATA%` thật.
