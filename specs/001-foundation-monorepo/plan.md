# Implementation Plan: Nền tảng monorepo (001)

**Branch**: `001-foundation-monorepo` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-foundation-monorepo/spec.md`; nguồn sự thật `docs/specs/SPEC-00-nen-tang.md`.

## Summary

Dựng khung pnpm workspace theo SPEC-00 §4 (thêm `packages/core`, xem research R1), gói `contract` (enum, ID ULID có tiền tố, mã lỗi, config schema, sự kiện bus, Clock), gói `db` (schema Drizzle + migration SQL có số thứ tự + runner riêng + repository settings/audit), gói `core` (config/paths, SecretStore DPAPI, EventBus, InstanceLock, Logger), và `apps/service` bootstrap lần chạy đầu với seeder registry. Mọi gói khác tạo khung tối thiểu biên dịch được.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 22 LTS, ESM (`module: NodeNext`)

**Primary Dependencies**: zod ^4.6; drizzle-orm ^0.45 + drizzle-kit ^0.31; better-sqlite3 ^13; @primno/dpapi ^2; tsx ^4 (dev); eslint ^10 + typescript-eslint ^8.71; vitest ^5

**Storage**: SQLite file `%APPDATA%\ProfileVault\profilevault.db` (WAL, foreign_keys); `secrets.bin` DPAPI; `config.json`

**Testing**: Vitest (unit + integration với file tạm); không Playwright ở 001

**Target Platform**: Windows 10/11 (DPAPI); build/test chạy được trên Linux CI với `MemorySecretStore`

**Project Type**: monorepo (dịch vụ nền + SPA sau này)

**Performance Goals**: bootstrap lần đầu ≤ 5 s, lần sau ≤ 2 s (SC-003)

**Constraints**: không thêm dependency ngoài stack SPEC-00 §3 (trừ ghi lý do); không log bí mật; chỉ thêm/đọc cho 4 bảng append-only

**Scale/Scope**: ~10 binding, CSDL vài chục MB; 21 bảng + 1 bảng migration

## Constitution Check

| Nguyên tắc | Áp dụng ở 001 | Trạng thái |
|---|---|---|
| I. docs/ là nguồn sự thật | Schema, enum, mã lỗi, config lấy nguyên từ SPEC-00; thêm `packages/core` → sửa SPEC-00 §4 + decisions.md | PASS (có ghi quyết định) |
| II. TS strict, Zod ở contract | `tsconfig.base.json` strict; mọi schema trong `packages/contract` | PASS |
| III. Fury qua FuryClient | Không đụng Fury ở 001 | N/A |
| IV. Bí mật qua DPAPI, không log | `DpapiSecretStore`; logger che bí mật; `secrets.bin` trong `.gitignore` | PASS |
| V. Gateway loopback | Không có Gateway ở 001 | N/A |
| VI. Không công khai, ctx.ui | N/A | N/A |
| VII. L0 không CDP | N/A | N/A |
| VIII. Hành động người chỉ dashboard | N/A | N/A |
| IX. Health chỉ báo | N/A | N/A |
| X. Test mọi feature | Unit contract/core; integration db/bootstrap | PASS |
| XI. Tiếng Việt/identifier Anh | Tài liệu VI, mã EN | PASS |

Tái kiểm sau thiết kế: không thay đổi.

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation-monorepo/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── contract-package.md     # bề mặt xuất của @sctech/profilevault-contract
│   └── core-package.md         # bề mặt xuất của @sctech/profilevault-core và db
└── tasks.md
```

### Source Code (repository root)

```text
package.json                 # workspace gốc: scripts build/lint/test/dev; pnpm.onlyBuiltDependencies
pnpm-workspace.yaml          # apps/*, packages/*, packs/*, tools/*
tsconfig.base.json           # strict, NodeNext, ES2022, composite
tsconfig.json                # references
eslint.config.js             # typescript-eslint flat
vitest.config.ts             # projects: packages/*, apps/*
.npmrc

packages/contract/           # @sctech/profilevault-contract
├── package.json  tsconfig.json  vitest.config.ts
├── src/index.ts  enums.ts  health-event-types.ts  ids.ts  errors.ts  config.ts  bus-events.ts  clock.ts  version.ts  secrets.ts
└── test/ids.test.ts  errors.test.ts  enums.test.ts  config.test.ts  clock.test.ts

packages/db/                 # @sctech/profilevault-db
├── package.json  tsconfig.json  vitest.config.ts  drizzle.config.ts
├── migrations/0001_init.sql
├── src/index.ts  schema.ts  open.ts  migrate.ts  test-utils.ts
├── src/repositories/settings.ts  audit.ts
└── test/schema.test.ts  migrate.test.ts  settings.test.ts  audit.test.ts

packages/core/               # @sctech/profilevault-core
├── package.json  tsconfig.json  vitest.config.ts
├── src/index.ts  paths.ts  config.ts  event-bus.ts  instance-lock.ts  logger.ts  seeders.ts
├── src/secrets/secret-store.ts  dpapi-secret-store.ts  memory-secret-store.ts  secrets-file.ts
└── test/paths.test.ts  config.test.ts  event-bus.test.ts  instance-lock.test.ts  logger.test.ts  secrets.test.ts

apps/service/                # @sctech/profilevault-service
├── package.json  tsconfig.json  vitest.config.ts
├── src/main.ts  bootstrap.ts
└── test/bootstrap.test.ts

apps/dashboard/              # khung Vite trống (006)
packages/{fury-client,health,runner,jobs,gateway,host-info}/   # khung: package.json, tsconfig, src/index.ts
packs/{generic,youtube}/     # khung: package.json, pack.json tối thiểu (hoàn thiện ở 007)
tools/eslint-plugin-pv/      # khung (007)
```

**Structure Decision**: đúng SPEC-00 §4 cộng `packages/core` (research R1; cập nhật SPEC-00 §4 và `docs/decisions.md`).

## Thiết kế chính

### contract
- `enums.ts`: `PlatformSchema = z.string().min(1)` (mở rộng theo pack) + hằng `KNOWN_PLATFORMS`; `AutomationLevelSchema = z.union([z.literal(0..3)])`; các enum còn lại `z.enum([...])`.
- `health-event-types.ts`: `HEALTH_EVENT_TYPES: Record<type, { source, severity | 'info|red' | 'info|warn' | 'warn|info' }>` theo bảng §7.1; hàm `eventMeta(type)`; `HealthEventTypeSchema`.
- `ids.ts`: `ID_PREFIXES` (§6), `newId('ab')`, `IdSchema(prefix)`, `BindingIdSchema`… ; ULID tự cài.
- `errors.ts`: `ERROR_CODES` với `retry: 'no'|'yes'|'after'|'maybe'|'none'`, `ErrorCodeSchema` (danh sách ∪ `/^[A-Z]+_[A-Z_]+$/` cho pack), `ApiErrorSchema`, lớp `PvError extends Error { code, detail }`, `toApiError(err)`.
- `config.ts`: `ConfigSchema` với mặc định §5, `expandEnv(str, env)`.
- `bus-events.ts`: `BUS_EVENTS = { 'health.event_recorded': Schema, ... }`, kiểu `BusEventMap`.
- `clock.ts`: `Clock { now(): Date; nowIso(): string }`, `systemClock`, `FakeClock(start).advance(ms)/set(date)`.
- `secrets.ts`: `SecretKeySchema = z.enum(['fury.token','hmac.key','llm.apiKey'])`.

### db
- `schema.ts`: 21 bảng + `pvMigrations`; chỉ mục một phần `ix_pauses_open` qua `index().on(bindingId).where(sql\`cleared_at IS NULL\`)`.
- `open.ts`: `openDatabase({ file, migrate = true }) → { sqlite, db, close() }`; PRAGMA `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- `migrate.ts`: `applyMigrations(sqlite, dir)`; `MigrationNewerThanCodeError`.
- Repositories: `SettingsRepo.get(key)/set(key, value, actor)/history(key)`, `AuditRepo.append(...)/list(filter)`, `pruneAppendOnly(db, retentionMonths, clock)`.
- `test-utils.ts`: `openTestDatabase()` → file tạm, trả `{ db, path, cleanup }`.

### core
- `paths.ts`: `resolvePaths(env)` → `{ appData, localAppData, configFile, secretsFile, dbFile, extensionsDir, runsDir, probesDir, logsDir, lockFile }`.
- `config.ts`: `loadConfig(paths, env)`; JSON hỏng → `PvError('INPUT_INVALID')` kèm vị trí.
- `secrets/`: `SecretStore` interface; `DpapiSecretStore(file)`; `MemorySecretStore`; `ensureHmacKey(store)`.
- `event-bus.ts`: `EventBus` generic trên `BusEventMap`; `emit` kiểm Zod, ném `PvError('INPUT_INVALID')`; `on/once/off`; listener lỗi → `logger.error`.
- `instance-lock.ts`: `acquireInstanceLock(file)` → `{ release }` hoặc ném `InstanceAlreadyRunningError`.
- `logger.ts`: `createLogger({ dir, clock, redact: () => string[] })`; `child(bindings)`; dọn > 7 ngày.
- `seeders.ts`: `SeederRegistry.register(name, fn)`; `runSeeders(ctx)` ghi `settings.seeded.<name> = true`.

### apps/service
- `bootstrap(options: { env, secretStore?, clock? })` → `{ paths, config, db, bus, logger, secrets, shutdown() }` theo thứ tự FR-011; `main.ts` gọi bootstrap, treo tiến trình, bắt SIGINT/SIGTERM.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Thêm `packages/core` ngoài SPEC-00 §4 | Package khác cần SecretStore/bus/clock mà không import từ `apps/` | Đặt trong `apps/service` → không import được; đặt trong `contract` → trộn I/O vào gói schema |
