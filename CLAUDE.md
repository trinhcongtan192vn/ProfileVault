# ProfileVault

## Mục đích

Dịch vụ nền trên Windows (tray, tự khởi động) chạy cạnh **Fury Antidetect Browser** (tiến trình riêng, AGPL). ProfileVault đưa từng kênh YouTube (mỗi kênh một email, một profile Fury) từ upload tay sang upload tự động **có bằng chứng**: mỗi binding kênh↔profile có mức tự động hóa L0→L3, Health service đo (sự kiện, kiểm proxy, kiểm tra độ nhất quán 5 lớp, ngưỡng) và tự hạ mức/dừng khi có cờ đỏ; Runner chạy flow RPA tất định (TypeScript + Playwright qua CDP) chỉ trên profile đủ mức; Gateway loopback cho dashboard, app ngoài (M1) và Claude (M2). Người quyết định lên mức và phát hành; hệ thống không bao giờ đặt nội dung công khai.

## Nguồn sự thật

- `docs/profilevault-prd.md` (PRD), `docs/profilevault-agent-architecture.md` (kiến trúc), `docs/specs/SPEC-00…SPEC-09` (spec chi tiết), `docs/specs/SPIKE-ke-hoach.md`.
- Khi `specs/NNN-*/spec.md|plan.md|tasks.md` (Spec Kit) khác `docs/`, **`docs/` thắng**. Nếu thật sự phải đổi một quyết định trong `docs/`: sửa file trong `docs/` và ghi vào `docs/decisions.md` (ngày, quyết định, lý do).
- Mục đánh dấu **[SPIKE-Pn]** phụ thuộc kết quả spike chưa có: cài theo giao diện/hợp đồng trong spec, dùng giả lập (FakeFury, fixture), để phần chưa chắc sau một adapter có `TODO(SPIKE-Pn)`. Không đoán định dạng dữ liệu thật của Fury rồi viết cứng.
- Tiến độ và giả định khi triển khai: `docs/progress.md`.

## Cấu trúc repo (SPEC-00 §4)

```
apps/service/            # tiến trình nền: bootstrap, tray, scheduler, wiring
apps/dashboard/          # SPA React + Vite
packages/contract/       # @sctech/profilevault-contract: Zod schema, mã lỗi, kiểu API
packages/db/             # schema Drizzle, migration SQLite, repository
packages/fury-client/    # SPEC-01 (+ FakeFury trong test/)
packages/health/         # SPEC-02
packages/runner/         # SPEC-03: flow contract, runner, scheduler, linter
packages/jobs/           # SPEC-06 (M1)
packages/gateway/        # SPEC-05: REST (+ MCP ở M1)
packages/host-info/      # đọc OS/GPU/màn hình
packs/generic/, packs/youtube/   # SPEC-04
skills/                  # SPEC-08 (M2)
tools/eslint-plugin-pv/  # luật lint cho pack
spikes/                  # script + README cho spike P1–P7 (người tự chạy)
specs/                   # tài liệu Spec Kit theo feature
docs/                    # nguồn sự thật
```

Stack cố định (SPEC-00 §3): TypeScript strict, Node 22, pnpm workspace, Fastify 5, `better-sqlite3` + Drizzle, Zod, Playwright (`connectOverCDP`), React + Vite + Recharts + TanStack, `systray2`, `node-notifier`, DPAPI (`@primno/dpapi`), `argon2`, Vitest, Playwright Test. Thêm dependency ngoài stack → ghi lý do vào `docs/decisions.md`.

## Lệnh

```powershell
pnpm install
pnpm build        # tsc -b toàn bộ workspace
pnpm lint         # eslint + tsc --noEmit
pnpm test         # vitest (unit + integration)
pnpm dev          # chạy apps/service ở chế độ dev
```

Xanh toàn bộ lint + test mới được commit/merge.

## Quy tắc

1. `docs/` là nguồn sự thật; mã và spec Spec Kit phải khớp `docs/`.
2. TypeScript strict; mọi dữ liệu vào/ra định nghĩa bằng Zod trong `packages/contract`.
3. Fury là tiến trình riêng, chỉ gọi qua `FuryClient`; không nhúng mã Fury.
4. ProfileVault không giữ cookie, mật khẩu, thông tin đăng nhập proxy; bí mật của chính nó qua DPAPI; không log bí mật.
5. Gateway chỉ bind loopback; kiểm `Host`; không CORS.
6. Không có thao tác nào đặt nội dung công khai/hẹn giờ công khai; flow chỉ thao tác trang qua `ctx.ui`; linter chặn thao tác thô.
7. L0 không bao giờ bật CDP; Runner chỉ chạy trên profile do chính nó mở; CDP chỉ bật trong lúc chạy.
8. Các hành động chỉ dành cho người (lên mức, gỡ dừng do người, xác nhận checklist, trả lời gate L2) chỉ có trên dashboard.
9. Health service chỉ báo và chặn, không tự sửa cấu hình profile.
10. Mọi feature có test (unit/integration theo SPEC-09); không merge khi test đỏ.
11. Tài liệu tiếng Việt, identifier tiếng Anh.

Không commit `secrets.bin`, CSDL, artifact run. Không cài/gọi Fury thật, không truy cập YouTube trong phiên phát triển.
