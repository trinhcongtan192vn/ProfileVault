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
| — | Bước 1–3: đọc docs, Spec Kit, CLAUDE.md, constitution | — | 🔄 đang làm | |
| 001 | Monorepo pnpm, `packages/contract`, `packages/db` (schema + migration SQLite đầy đủ), config, bí mật DPAPI, bus sự kiện, khóa một phiên bản, bootstrap `apps/service` | SPEC-00 toàn bộ | ⏳ chưa làm | |
| 002 | `packages/fury-client`: giao diện, adapter HTTP (ánh xạ endpoint `TODO(SPIKE-P2)`), bộ theo dõi trạng thái, FakeFury | SPEC-01; SPEC-09 §3.1 | ⏳ chưa làm | |
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
| (chưa có) | | | |

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
pnpm build          # build mọi package
pnpm lint
pnpm test           # unit + integration (Vitest)
pnpm --filter @sctech/profilevault-service dev   # chạy dịch vụ nền (dev)
```

Mở dashboard: menu tray → "Mở dashboard" (hoặc xem mục "Lệnh" sau khi feature 005/006 xong).
