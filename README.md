# ProfileVault

Dịch vụ nền trên Windows chạy cạnh **Fury Antidetect Browser**, đưa từng kênh YouTube từ upload tay sang upload tự động **có bằng chứng**: mỗi binding kênh ↔ profile Fury có mức tự động hóa L0 → L3; Health service đo (sự kiện, kiểm proxy, kiểm tra độ nhất quán, ngưỡng) và tự hạ mức/dừng khi có cờ đỏ; Runner chạy flow RPA tất định chỉ trên profile đủ mức; Gateway loopback cho dashboard, app ngoài và Claude. Người quyết định lên mức và phát hành; hệ thống không bao giờ đặt nội dung công khai.

**Nguồn sự thật:** [docs/](docs/) — PRD, kiến trúc, SPEC-00…09, kế hoạch spike. Tiến độ và giả định: [docs/progress.md](docs/progress.md). Quyết định thay đổi: [docs/decisions.md](docs/decisions.md). Quy tắc cho người/agent phát triển: [CLAUDE.md](CLAUDE.md).

## Yêu cầu

- Windows 10/11, Node.js 22, pnpm 10 (`corepack enable pnpm`).
- Không cần Visual Studio: `better-sqlite3` và `@primno/dpapi` dùng prebuilt.

## Lệnh

```powershell
pnpm install
pnpm build        # tsc -b toàn workspace
pnpm lint         # eslint (type-checked)
pnpm test         # build + vitest (unit + integration)
pnpm dev          # chạy apps/service bằng tsx
```

Chạy dịch vụ với thư mục dữ liệu riêng (không đụng `%APPDATA%\ProfileVault`):

```powershell
$env:PV_APPDATA_DIR = "$env:TEMP\pv-dev\appdata"; $env:PV_LOCALAPPDATA_DIR = "$env:TEMP\pv-dev\local"
pnpm dev
```

## Cấu trúc

```
apps/service        tiến trình nền (bootstrap, wiring)
apps/dashboard      SPA React (feature 006)
packages/contract   Zod schema, mã lỗi, ID, cấu hình, sự kiện (profilevault/v1)
packages/db         schema Drizzle + migration SQLite + repository
packages/core       cấu hình, đường dẫn, bí mật DPAPI, bus sự kiện, khóa phiên bản, log, seeder
packages/fury-client · health · runner · jobs · gateway · host-info   (các feature 002–007)
packs/generic · packs/youtube   flow pack
tools/eslint-plugin-pv           linter cho pack
spikes/                          script spike P1–P7 (người tự chạy)
specs/                           tài liệu Spec Kit theo feature
```

## Dữ liệu trên máy (SPEC-00 §5)

`%APPDATA%\ProfileVault\` → `config.json`, `secrets.bin` (DPAPI), `profilevault.db`, `service.lock`, `extensions\flows\`
`%LOCALAPPDATA%\ProfileVault\` → `runs\`, `probes\`, `logs\` (xoay 7 ngày)

Không bao giờ commit `secrets.bin`, CSDL hay artifact run.
