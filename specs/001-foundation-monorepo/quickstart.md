# Quickstart: 001 Nền tảng monorepo

## Điều kiện
- Windows 10/11, Node 22, pnpm 10 (`corepack enable pnpm`).

## Lệnh

```powershell
pnpm install
pnpm build
pnpm lint
pnpm test
```

Mong đợi: cả bốn lệnh exit 0; `pnpm test` liệt kê project `contract`, `db`, `core`, `service` xanh.

## Chạy dịch vụ ở chế độ dev với thư mục dữ liệu tạm

```powershell
$env:PV_APPDATA_DIR = "$env:TEMP\pv-dev\appdata"; $env:PV_LOCALAPPDATA_DIR = "$env:TEMP\pv-dev\local"
pnpm dev
```

Mong đợi (US5):
- Tạo `config.json` (mặc định), `secrets.bin` (có `hmac.key`), `profilevault.db`, thư mục `extensions\flows`, `runs`, `probes`, `logs`.
- Log `logs\service-<ngày>.log` có dòng `first_run`, `started`.
- Chạy tiến trình thứ hai cùng biến môi trường → thoát mã 3, thông báo đang chạy phiên bản khác.
- Ctrl+C → log `stopped`, `service.lock` biến mất.

## Kiểm tra schema

```powershell
pnpm --filter @sctech/profilevault-db test
```

Test `schema.test.ts` so `sqlite_master` với danh sách bảng/chỉ mục SPEC-00 §8.

## Kết quả (2026-10-14)

- `pnpm install && pnpm build && pnpm lint && pnpm test`: xanh; Vitest 14 file, 66 test (contract 24, db 12, core 17, service 5, còn lại khung).
- Chạy `node apps/service/dist/main.js` với thư mục tạm: tạo `appdata/{profilevault.db, secrets.bin, service.lock, extensions/flows}`, `local/{runs, probes, logs/service-2026-10-14.log}`; log có `đã sinh khóa HMAC`, `đã áp migration 0001_init`, `dịch vụ đã khởi động firstRun=true`.
- Tiến trình thứ hai cùng biến môi trường: thoát mã 3, thông báo "ProfileVault đang chạy ở tiến trình <pid>".
- Dừng cưỡng bức (`Stop-Process`): `service.lock` còn lại; lần khởi động sau phát hiện PID chết và chiếm lại (test `instance-lock`).
- Converge: FR-001…FR-013 đều có mã và test; không còn việc hở trong phạm vi 001.
