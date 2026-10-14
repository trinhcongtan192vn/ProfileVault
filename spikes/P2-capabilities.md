# P2 — Ma trận năng lực

Đọc mã `agent/` và tài liệu đúng phiên bản Fury trước khi gọi API. Với từng năng lực
health/listProfiles/getProfile/getStatus/launch/stop/checkExit, ghi endpoint, HTTP method,
schema request/response đã loại bí mật, nguồn fallback và kết luận native/fallback/missing.

```powershell
$env:PV_SPIKE_FURY_TOKEN = Read-Host 'Token test'
powershell -NoProfile -ExecutionPolicy Bypass -File spikes/capture-api.ps1 -Uri '<URL đã xác minh>' -Method GET
Remove-Item Env:PV_SPIKE_FURY_TOKEN
```

Xác minh `seed`, persona, timezone, languages, geolocation, proxy reference; không thu thập proxy credentials.
Launch chỉ trên profile test đang đóng. Ghi cách lấy CDP endpoint và stop trong báo cáo.
Sau đó sửa `packages/fury-client/src/adapter/endpoint-map.ts` và fallback file adapter.
