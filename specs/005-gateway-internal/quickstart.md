# Quickstart: 005

```powershell
pnpm build
pnpm exec vitest run --project gateway
$env:PV_APPDATA_DIR = "$env:TEMP\pv-devppdata"; $env:PV_LOCALAPPDATA_DIR = "$env:TEMP\pv-dev\local"
pnpm dev   # in ra "Dashboard: http://127.0.0.1:50410/auth/open?code=..." — mở URL trong 60 giây
```

## Kết quả (2026-10-14)

- `pnpm build && pnpm lint && pnpm test`: xanh; toàn workspace 38 file, 194 test (gateway 4 file / 21 test; service thêm `gateway-wiring`).
- Nghiệm thu SPEC-05 §11: Host lạ bị từ chối; mã `/auth/open` dùng lại/hết hạn bị từ chối; không có `/api/v1`, `/mcp` (M1) nên không có cách lên mức ngoài phiên dashboard.
- Converge: FR-001…FR-012 có mã và test. `config.gateway.port = 0` được phép (dev/test).
