# Tasks: Nền tảng monorepo (001)

**Input**: Design documents from `/specs/001-foundation-monorepo/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: bắt buộc (Constitution X, SPEC-09): unit cho hàm thuần, integration với SQLite file tạm.

**Organization**: theo user story của spec.md.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup (khung workspace)

- [X] T001 Tạo `package.json` gốc (private, `packageManager: pnpm@10`, scripts `build`/`lint`/`test`/`dev`/`typecheck`, `pnpm.onlyBuiltDependencies` cho `better-sqlite3`, `@primno/dpapi`, `argon2`, `esbuild`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `packs/*`, `tools/*`), `.npmrc`
- [X] T002 [P] Tạo `tsconfig.base.json` (strict, `module: NodeNext`, `target: ES2022`, `composite`, `declaration`, `sourceMap`, `verbatimModuleSyntax`) và `tsconfig.json` gốc với `references` tới mọi gói
- [X] T003 [P] Tạo `eslint.config.js` (typescript-eslint flat, `recommendedTypeChecked` cho `src/**`, ignore `dist`, `node_modules`) và `vitest.config.ts` gốc (`projects: ['packages/*', 'apps/*']`)
- [X] T004 [P] Tạo khung tối thiểu biên dịch được cho `apps/dashboard`, `packages/fury-client`, `packages/health`, `packages/runner`, `packages/jobs`, `packages/gateway`, `packages/host-info`, `packs/generic`, `packs/youtube`, `tools/eslint-plugin-pv` (mỗi gói `package.json`, `tsconfig.json`, `src/index.ts` xuất hằng `PACKAGE_NAME`)
- [X] T005 Chạy `pnpm install` và `pnpm build` xanh với khung trống

## Phase 2: Foundational — `packages/contract` (US2, chặn mọi story khác)

- [X] T006 [US2] Tạo `packages/contract/package.json` (`@sctech/profilevault-contract`, ESM, `exports`, dep `zod`), `tsconfig.json`, `vitest.config.ts`
- [X] T007 [P] [US2] `packages/contract/src/enums.ts`: `PlatformSchema`, `KNOWN_PLATFORMS`, `AutomationLevelSchema` (0|1|2|3), `SeveritySchema`, `RuleStatusSchema`, `EventSeveritySchema`, `EventSourceSchema`, `JobStatusSchema`, `RunStatusSchema`, `PauseReasonSchema` đúng SPEC-00 §7
- [X] T008 [P] [US2] `packages/contract/src/health-event-types.ts`: `HEALTH_EVENT_TYPES` đủ 26 loại SPEC-00 §7.1 với `source` và `severity` (đơn hoặc tập cho `detect_suite.recorded`, `run.*`, `level.*`, `binding.*`), `HealthEventTypeSchema`, `eventMeta()`
- [X] T009 [P] [US2] `packages/contract/src/ids.ts`: `ID_PREFIXES` SPEC-00 §6, ULID tự cài (Crockford base32, đơn điệu), `newId()`, `IdSchema(prefix)`, 12 schema ID có tên, `isIdOf()`
- [X] T010 [P] [US2] `packages/contract/src/errors.ts`: `ERROR_CODES` đủ 29 mã SPEC-00 §9 kèm `retry`, `ErrorCodeSchema` (danh sách ∪ mẫu `^[A-Z][A-Z0-9]*_[A-Z0-9_]+$` cho mã pack), `ApiErrorSchema` `{ error: { code, message, detail? } }`, `PvError`, `toApiError()`, `isRetryable()`
- [X] T011 [P] [US2] `packages/contract/src/config.ts`: `ConfigSchema` với mặc định SPEC-00 §5 (`gateway`, `fury`, `runner`, `limits`, `retention`, `ui`), `DEFAULT_CONFIG`, `expandEnv()`
- [X] T012 [P] [US2] `packages/contract/src/bus-events.ts`: `BUS_EVENTS` 6 sự kiện SPEC-00 §10 với payload Zod (data-model.md), `HealthEventRecordSchema`, kiểu `BusEventMap`, `BusEventName`
- [X] T013 [P] [US2] `packages/contract/src/clock.ts` (`Clock`, `systemClock`, `FakeClock`), `src/secrets.ts` (`SecretKeySchema`), `src/version.ts` (`CONTRACT_VERSION`), `src/common.ts` (`IsoDateTimeSchema`)
- [X] T014 [US2] `packages/contract/src/index.ts` xuất toàn bộ theo `contracts/contract-package.md`
- [X] T015 [P] [US2] Test `packages/contract/test/ids.test.ts` (US2/AC1, AC2: 1000 ID khác nhau, đúng tiền tố, 26 ký tự, sắp xếp theo thời gian với FakeClock), `errors.test.ts` (AC3), `health-event-types.test.ts` (AC4), `enums.test.ts`, `config.test.ts` (mặc định, `expandEnv` thiếu biến), `clock.test.ts`

**Checkpoint**: `pnpm --filter @sctech/profilevault-contract test` xanh.

## Phase 3: User Story 3 — CSDL SQLite đầy đủ với migration (P1)

**Goal**: `packages/db` mở CSDL đúng PRAGMA, migration có số thứ tự, 21 bảng khớp SPEC-00 §8, repository settings/audit.

**Independent Test**: `pnpm --filter @sctech/profilevault-db test`.

- [X] T016 [US3] Tạo `packages/db/package.json` (`@sctech/profilevault-db`, dep `drizzle-orm`, `better-sqlite3`, `@sctech/profilevault-contract`; devDep `drizzle-kit`, `@types/better-sqlite3`), `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`
- [X] T017 [US3] `packages/db/src/schema.ts`: 21 bảng SPEC-00 §8 + `pvMigrations`; mọi `NOT NULL`, `DEFAULT`, `UNIQUE (platform, account_id)`, `fury_profile_id UNIQUE`, `CHECK (level BETWEEN 0 AND 3)`, `CHECK (kind IN ('promote','demote'))`, `CHECK (source IN ('manual_import','flow'))`, `UNIQUE (client_id, idempotency_key)`, `token_prefix UNIQUE`, khóa chính ghép `(run_id, binding_id, rule_id)`, `(run_id, seq)`; chỉ mục `ix_pauses_open` (một phần `WHERE cleared_at IS NULL`), `ix_events_binding_time`
- [X] T018 [US3] `packages/db/migrations/0001_init.sql`: SQL tạo bảng khớp schema.ts và SPEC-00 §8 (sinh bằng `drizzle-kit generate` rồi rà tay), kèm `pv_migrations`
- [X] T019 [US3] `packages/db/src/migrate.ts`: `applyMigrations(sqlite, dir)` đọc file `NNNN_*.sql` sắp xếp, bảng `pv_migrations`, mỗi file một giao dịch, `MigrationNewerThanCodeError` khi `max(seq)` DB > mã; `MIGRATIONS_DIR` tính từ `import.meta.url`
- [X] T020 [US3] `packages/db/src/open.ts`: `openDatabase({ file, migrate })` với `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000`, trả `{ sqlite, db, close }`
- [X] T021 [P] [US3] `packages/db/src/repositories/settings.ts`: `SettingsRepo.get(key, schema?)`, `set(key, value, actor)` ghi `settings` + `settings_history` trong một giao dịch, `history(key)`
- [X] T022 [P] [US3] `packages/db/src/repositories/audit.ts`: `AuditRepo.append()` (sinh `au_` id, `created_at` từ Clock), `list()`; `packages/db/src/prune.ts`: `pruneAppendOnly(db, { retentionMonths, now })` cho 4 bảng chỉ thêm
- [X] T023 [US3] `packages/db/src/test-utils.ts` (`openTestDatabase()` file tạm + cleanup) và `src/index.ts` xuất theo `contracts/core-package.md`
- [X] T024 [P] [US3] Test `packages/db/test/schema.test.ts`: so `sqlite_master` với danh sách 21 bảng + chỉ mục; kiểm cột/ràng buộc qua `PRAGMA table_info`, `PRAGMA index_list`, `PRAGMA foreign_key_list` cho `bindings`, `binding_pauses`, `jobs`, `consistency_results`, `run_steps` (US3/AC1, AC4)
- [X] T025 [P] [US3] Test `packages/db/test/migrate.test.ts`: mở hai lần không chạy lại (AC2); DB ghi `seq = 999` → `MigrationNewerThanCodeError`, file không đổi (AC3); migration lỗi giả → rollback (edge case)
- [X] T026 [P] [US3] Test `packages/db/test/settings.test.ts` (AC6) và `audit.test.ts` (AC5: không có hàm update/delete xuất ra; `pruneAppendOnly` xóa đúng dòng cũ)

**Checkpoint**: db test xanh; schema khớp SPEC-00 §8.

## Phase 4: User Story 4 — Cấu hình, thư mục, bí mật, khóa phiên bản (P2)

**Goal**: `packages/core` phần paths/config/secrets/lock.

**Independent Test**: `pnpm --filter @sctech/profilevault-core test` (phần tương ứng).

- [X] T027 [US4] Tạo `packages/core/package.json` (`@sctech/profilevault-core`, dep `@sctech/profilevault-contract`, `@sctech/profilevault-db`, `@primno/dpapi` (optional trên non-Windows), `zod`), `tsconfig.json`, `vitest.config.ts`
- [X] T028 [P] [US4] `packages/core/src/paths.ts`: `resolvePaths(env)` theo SPEC-00 §5 với ghi đè `PV_APPDATA_DIR`, `PV_LOCALAPPDATA_DIR`; `ensureDirs(paths)`
- [X] T029 [P] [US4] `packages/core/src/config.ts`: `loadConfig(paths, env)` đọc JSON (hỏng → `PvError('INPUT_INVALID')` kèm vị trí), gộp sâu mặc định, `ConfigSchema.parse`, `expandEnv` mọi chuỗi, cảnh báo biến thiếu
- [X] T030 [P] [US4] `packages/core/src/secrets/secret-store.ts` (interface), `memory-secret-store.ts`, `secrets-file.ts` (đọc/ghi JSON `{version, entries}` nguyên tử: ghi file tạm rồi rename), `dpapi-secret-store.ts` (`@primno/dpapi` `protectData/unprotectData` scope `CurrentUser`, entropy `ProfileVault`; lỗi giải mã → `PvError('INTERNAL', { reason: 'secrets_undecryptable' })` kèm hướng dẫn), `ensureHmacKey()`
- [X] T031 [P] [US4] `packages/core/src/instance-lock.ts`: `acquireInstanceLock(file, { pidAlive })` với `openSync('wx')`, phát hiện PID chết, `release()`, `InstanceAlreadyRunningError`
- [X] T032 [P] [US4] Test `packages/core/test/paths.test.ts` (AC6), `config.test.ts` (AC1, AC2, AC3, JSON hỏng), `secrets.test.ts` (AC4 với `MemorySecretStore` + `DpapiSecretStore` chỉ khi `process.platform === 'win32'`; file trên đĩa không chứa plaintext), `instance-lock.test.ts` (AC5 với `pidAlive` giả: đang sống → lỗi; chết → chiếm lại; release xóa file)

## Phase 5: User Story 5 — Bus sự kiện, log, seeder, bootstrap (P2)

**Goal**: `EventBus`, `Logger`, `SeederRegistry` trong core; `apps/service` bootstrap.

**Independent Test**: `pnpm --filter @sctech/profilevault-core test` và `pnpm --filter @sctech/profilevault-service test`.

- [X] T033 [P] [US5] `packages/core/src/event-bus.ts`: generic trên `BusEventMap`, `emit` kiểm Zod (sai → `PvError('INPUT_INVALID')`, không gọi listener), `on/once/off`, listener lỗi bị bắt và log, thứ tự đăng ký
- [X] T034 [P] [US5] `packages/core/src/logger.ts`: NDJSON, file theo ngày trong `logsDir`, mức `debug|info|warn|error`, `child()`, `redact()` thay giá trị bí mật bằng `***`, dọn file > `retentionDays` (mặc định 7) khi tạo và khi đổi ngày (theo Clock)
- [X] T035 [P] [US5] `packages/core/src/seeders.ts`: `SeederRegistry.register/run`, đánh dấu `settings['seeded.<name>']`, idempotent
- [X] T036 [US5] `packages/core/src/index.ts` xuất theo `contracts/core-package.md`
- [X] T037 [P] [US5] Test `packages/core/test/event-bus.test.ts` (AC1), `logger.test.ts` (AC5: 8 ngày FakeClock → còn 7 file; bí mật bị che), `seeders.test.ts` (chạy hai lần → seeder chạy một lần)
- [X] T038 [US5] Tạo `apps/service/package.json` (`@sctech/profilevault-service`, dep core/db/contract, script `dev` = `tsx src/main.ts`, `start` = `node dist/main.js`), `tsconfig.json`, `vitest.config.ts`
- [X] T039 [US5] `apps/service/src/bootstrap.ts`: thứ tự khóa → thư mục → cấu hình → bí mật (`ensureHmacKey`) → CSDL + migration → seed (`schema_version`, `runner` mặc định + seeder đăng ký) → bus → log; `firstRun` khi chưa có `settings.schema_version`; audit `system.first_run`/`system.started`; `shutdown()` ghi `system.stopped`, đóng CSDL, nhả khóa; nền tảng không Windows và không truyền `secretStore` → lỗi rõ ràng
- [X] T040 [US5] `apps/service/src/main.ts`: gọi bootstrap, bắt `SIGINT`/`SIGTERM` → `shutdown()` → exit 0; `InstanceAlreadyRunningError` → stderr + exit 3; lỗi khác → exit 1
- [X] T041 [US5] Test `apps/service/test/bootstrap.test.ts`: thư mục tạm + `MemorySecretStore` + FakeClock: lần 1 (AC2: thư mục, hmac.key 32 byte, DB migrate, settings, audit first_run), lần 2 (AC3), shutdown (AC4: file lock biến mất, DB đóng), khóa đang giữ → `InstanceAlreadyRunningError`

## Phase 6: User Story 1 — Khung monorepo chạy được (P1, xác nhận cuối)

- [X] T042 [US1] Chạy `pnpm build`, `pnpm lint`, `pnpm test` toàn workspace; sửa mọi lỗi strict/lint (US1/AC1–AC3)
- [X] T043 [US1] Test `apps/service/test/workspace.test.ts`: đọc `tsconfig.base.json` xác nhận `strict: true` và `noUncheckedIndexedAccess: true` (AC2); đọc `pnpm-workspace.yaml` xác nhận đủ 4 glob `apps/*`, `packages/*`, `packs/*`, `tools/*`

## Phase 7: Polish

- [X] T044 [P] Cập nhật `README.md` gốc (mục đích, lệnh, cấu trúc, trỏ `docs/`), `docs/progress.md` (001 ✅, TODO(SPIKE) nếu có), `.gitignore` đã có `secrets.bin`, `*.db`, `runs/`
- [X] T045 Chạy kịch bản `quickstart.md` với thư mục dữ liệu tạm (dev run + tiến trình thứ hai bị từ chối + Ctrl+C) và ghi kết quả vào `specs/001-foundation-monorepo/quickstart.md` mục "Kết quả"

## Dependencies & Execution Order

- Phase 1 → Phase 2 (contract) → Phase 3 (db) → Phase 4 (core: paths/config/secrets/lock) → Phase 5 (core: bus/logger/seeders; service) → Phase 6 → Phase 7.
- US4 và US5 phần core có thể song song sau Phase 3; `apps/service` cần cả hai.
- US1 là xác nhận toàn cục sau cùng.

## Implementation Strategy

Làm tuần tự theo phase; sau mỗi phase chạy test của gói đó; cuối cùng chạy toàn workspace. Commit một lần `feat(001): foundation monorepo` sau khi xanh (có thể thêm commit nhỏ giữa chừng nếu cần).
