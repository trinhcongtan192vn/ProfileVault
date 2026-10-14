# Tiến độ triển khai ProfileVault

**Cập nhật:** 2026-10-14 · **Giai đoạn:** M0 · **Nguồn sự thật:** `docs/prd.md` (= `profilevault-prd.md`), `docs/architecture.md` (= `profilevault-agent-architecture.md`), `docs/specs/SPEC-00…09`, `docs/specs/SPIKE-ke-hoach.md`.

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
| 002 | `packages/fury-client`: giao diện, adapter HTTP (ánh xạ endpoint `TODO(SPIKE-P2)`), bộ theo dõi trạng thái, FakeFury | SPEC-01; SPEC-09 §3.1 | 🔄 đang làm | |
| 003 | `packages/health` phần 1: binding, sự kiện, kiểm proxy theo lịch, ngưỡng, lên mức, hạ mức/dừng R1–R7, detect-suite, đồng hồ giả | SPEC-02 §1–5, §7–10 (trừ §6) | ⏳ chưa làm | |
| 004 | `packages/health` phần 2: chuẩn hóa probe (`TODO(SPIKE-P3)`), 21 luật, checklist HMAC, `packages/host-info` (`TODO(SPIKE-P6)`) | SPEC-02 §6 | ⏳ chưa làm | |
| 005 | `packages/gateway` M0: Fastify loopback, kiểm Host/Origin, phiên dashboard `/auth/open`, toàn bộ `/internal/*`, SSE, audit, mã lỗi HTTP | SPEC-05 §2–4.1, §5.2, §7, §9–11 | ⏳ chưa làm | |
| 006 | `apps/dashboard` + tray + toast: 8 trang, wizard gắn kênh, khai báo một chạm, biểu đồ, Chờ bạn, Cài đặt | SPEC-07 | ⏳ chưa làm | |
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
| G7 | Cơ chế seed lần chạy đầu: `registerSeeder` idempotent; 003/004 đăng ký ngưỡng và luật mặc định | 001 | SPEC-00 §11 nói "ghi luật nhất quán và ngưỡng mặc định" nhưng nội dung ở SPEC-02 |

## 5. TODO(SPIKE-Pn) còn lại

Cập nhật sau mỗi feature (lệnh: `grep -rn "TODO(SPIKE-" packages apps packs tools`).

| Spike | File | Nội dung |
|---|---|---|
| (chưa có) | | |

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
