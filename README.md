# ProfileVault

## Mở bản thử trên Windows

Bấm đúp `Open-ProfileVault.vbs` ở thư mục repo để chuẩn bị bản build và mở app, không cần nhập lệnh terminal. Có thể dùng `Open-ProfileVault.cmd`, hoặc `open-profilevault.sh` với Git Bash. Bản thử từ mã nguồn cần Node.js >=22 và pnpm 10 cài sẵn; lần đầu launcher hỏi trước khi tải thư viện. Dữ liệu bản thử nằm riêng trong `.pv-data/local/`.

Lần đầu app mở trang thiết lập: kiểm tra Windows, Fury và bộ trình duyệt; bấm **Cài các thành phần còn thiếu**, xem nguồn và dung lượng rồi **Xác nhận tải và cài**. App tải từ release chính thức, kiểm tra SHA-256, cài và kiểm tra lại. Sau đó bấm **Mở Fury**, **Kết nối tự động**, rồi **Hoàn tất và thêm kênh**. Nếu release không có checksum hoặc API Fury chưa tương thích, app báo rõ và chưa cho hoàn tất. Bộ cài và launcher thật vẫn cần nghiệm thu Windows trước phát hành M0.

Dịch vụ nền trên Windows chạy cạnh **Fury Antidetect Browser**, đưa từng kênh YouTube từ upload tay sang upload tự động **có bằng chứng**: mỗi binding kênh ↔ profile Fury có mức tự động hóa L0 → L3; Health service đo (sự kiện, kiểm proxy, kiểm tra độ nhất quán, ngưỡng) và tự hạ mức/dừng khi có cờ đỏ; Runner chạy flow RPA tất định chỉ trên profile đủ mức; Gateway loopback cho dashboard, app ngoài và Claude. Người quyết định lên mức và phát hành; hệ thống không bao giờ đặt nội dung công khai.

**Nguồn sự thật:** [docs/](docs/) — PRD, kiến trúc, SPEC-00…09, kế hoạch spike. Tiến độ và giả định: [docs/progress.md](docs/progress.md). Quyết định thay đổi: [docs/decisions.md](docs/decisions.md). Quy tắc cho người/agent phát triển: [CLAUDE.md](CLAUDE.md).

## Yêu cầu

- Windows 10/11, Node.js 22, pnpm 10 (`corepack enable pnpm`).
- Không cần Visual Studio: `better-sqlite3` và `@primno/dpapi` dùng prebuilt.

## Lệnh

```powershell
pnpm install
pnpm exec playwright install chromium  # Chromium cho test fixture, không cài Fury
pnpm build        # tsc -b toàn workspace
pnpm lint         # eslint (type-checked)
pnpm test         # build + Vitest (unit/integration) + Playwright fixture
pnpm test:flows   # chỉ Playwright fixture
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
apps/dashboard      SPA React + Vite (006)
packages/contract   Zod schema, mã lỗi, ID, cấu hình, sự kiện (profilevault/v1)
packages/db         schema Drizzle + migration SQLite + repository
packages/core       cấu hình, đường dẫn, bí mật DPAPI, bus sự kiện, khóa phiên bản, log, seeder
packages/fury-client · health · runner · gateway · host-info   (002–007); jobs để M1
packs/generic · packs/youtube   flow pack
tools/eslint-plugin-pv           linter cho pack, chạy trước khi nạp
spikes/                          script spike P1–P7 (người tự chạy)
specs/                           tài liệu Spec Kit theo feature
```

## Dữ liệu trên máy (SPEC-00 §5)

`%APPDATA%\ProfileVault\` → `config.json`, `secrets.bin` (DPAPI), `profilevault.db`, `service.lock`, `extensions\flows\`
`%LOCALAPPDATA%\ProfileVault\` → `runs\`, `probes\`, `logs\` (xoay 7 ngày)

Không bao giờ commit `secrets.bin`, CSDL hay artifact run.
