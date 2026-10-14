# Research: 001 Nền tảng monorepo

Mọi lựa chọn công nghệ đã chốt ở SPEC-00 §3; nghiên cứu ở đây chỉ chốt phiên bản và cách dùng.

## R1. Vị trí mã hạ tầng dùng chung (cấu hình, bí mật, bus, khóa, log)

- **Decision**: thêm gói `packages/core` (`@sctech/profilevault-core`) chứa config/paths, `SecretStore`, `EventBus`, `InstanceLock`, `Logger`, `Clock`; `apps/service` chỉ wiring.
- **Rationale**: `fury-client` (002) cần `SecretStore`, `health` (003) cần bus + clock, `gateway` (005) cần bus; package không được import từ `apps/`. `packages/contract` chỉ chứa schema (SPEC-00 §2), không nên chứa I/O.
- **Alternatives considered**: đặt trong `apps/service` (package khác không import được); đặt trong `contract` (trộn I/O vào gói schema). → Sửa SPEC-00 §4 thêm dòng `core/`, ghi `docs/decisions.md`.

## R2. Migration SQLite

- **Decision**: schema Drizzle (`sqlite-core`) là nguồn cho truy vấn có kiểu; SQL migration là file `migrations/NNNN_<tên>.sql` (sinh lần đầu bằng `drizzle-kit generate` rồi đổi tên và rà tay cho khớp SPEC-00 §8, kể cả chỉ mục một phần); bộ áp migration riêng (`pv_migrations(seq INTEGER PK, name, applied_at)`), mỗi file một giao dịch, từ chối khi `max(seq)` trong CSDL > số lớn nhất trong mã.
- **Rationale**: SPEC-00 §8 đòi "số thứ tự" và "từ chối nếu CSDL mới hơn mã"; bộ `migrate()` của Drizzle dùng hash + bảng `__drizzle_migrations`, không có khái niệm "mới hơn mã". Runner riêng ~60 dòng, dễ test.
- **Alternatives**: `drizzle-orm/better-sqlite3/migrator` (không kiểm "mới hơn"); `db:push` (không có lịch sử).

## R3. DPAPI

- **Decision**: `@primno/dpapi` 2.0.1 (`Dpapi.protectData/unprotectData`, scope `CurrentUser`, có prebuilt cho Windows x64 — đã xác minh chạy trên máy này). File `secrets.bin` = JSON `{ "version": 1, "entries": { "<key>": "<base64 blob>" } }`, mỗi entry mã hóa riêng để đổi một khóa không phải giải mã cả file. Entropy tùy chọn = `Buffer.from('ProfileVault')`.
- **Rationale**: đúng SPEC-00 §3; prebuilt tránh toolchain C++.
- **Alternatives**: gọi PowerShell `ProtectedData` (chậm, phụ thuộc shell); `keytar` (không còn bảo trì).

## R4. SQLite driver

- **Decision**: `better-sqlite3` 13.0.3 (đã xác minh prebuilt chạy, SQLite 3.53). pnpm 10 chặn script build mặc định → khai `pnpm.onlyBuiltDependencies: ["better-sqlite3", "@primno/dpapi", "argon2", "esbuild"]` ở `package.json` gốc.

## R5. Phiên bản công cụ

| Gói | Phiên bản | Ghi chú |
|---|---|---|
| typescript | 5.9.x | TS 7 (native) còn mới với ESLint/Vitest; giữ 5.9 |
| typescript-eslint | ^8.71 | flat config |
| eslint | ^10 | |
| vitest | ^5 | `projects` trong `vitest.config.ts` gốc |
| zod | ^4.6 | API v4 (`z.object`, `z.enum`, `z.infer`) |
| drizzle-orm / drizzle-kit | ^0.45 / ^0.31 | `sqlite-core` |
| better-sqlite3 | ^13 | |
| @primno/dpapi | ^2.0 | |
| tsx | ^4 | chạy dev |
| @types/node | ^22 | khớp Node 22 LTS |

## R6. ULID

- **Decision**: tự cài (`packages/contract/src/ids.ts`): 48 bit thời gian + 80 bit ngẫu nhiên (`crypto.randomBytes`), Crockford base32, đơn điệu trong cùng mili giây (tăng phần ngẫu nhiên); schema `^<prefix>_[0-9A-HJKMNP-TV-Z]{26}$`.
- **Rationale**: tránh thêm dependency ngoài stack cho ~40 dòng mã.

## R7. Log

- **Decision**: logger nhỏ tự viết (NDJSON `{ ts, level, msg, ...data }`), file theo ngày `service-YYYY-MM-DD.log` trong `logs/`, ghi đồng bộ `appendFileSync` (khối lượng nhỏ), dọn file cũ hơn 7 ngày khi khởi động và khi đổi ngày; bộ che bí mật thay mọi giá trị trong `SecretStore` bằng `***`.
- **Alternatives**: `pino` + `pino-roll` (ngoài stack; không cần hiệu năng cao).

## R8. Khóa một phiên bản

- **Decision**: `service.lock` ghi JSON `{ pid, startedAt }` bằng `openSync(path, 'wx')`; nếu tồn tại → đọc PID, `process.kill(pid, 0)`; `ESRCH` → xóa và thử lại; còn sống → thoát mã 3. Nhả ở `shutdown()` và `process.on('exit')`.

## R9. Cấu trúc test

- Vitest `projects` tự phát hiện `packages/*/vitest.config.ts` và `apps/*`; mỗi gói có `test/**/*.test.ts`; integration dùng thư mục tạm `fs.mkdtempSync` và `PV_APPDATA_DIR`/`PV_LOCALAPPDATA_DIR`.
