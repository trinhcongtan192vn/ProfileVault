# Spike P1–P7 — người vận hành tự chạy

Nguồn: `docs/specs/SPIKE-ke-hoach.md`. Chưa spike nào được chạy trong phiên triển khai.
Chỉ dùng profile/kênh test riêng. Ghi bằng chứng đã loại bỏ bí mật vào
`docs/specs/SPIKE-bao-cao.md`; không commit token, cookie, proxy credential hay capture định danh.

| Spike | Tài liệu/script | Việc cần xác minh |
|---|---|---|
| P1 | `P1-session.md`, `session-log.ps1` | Giữ phiên 7 ngày, 5 lần mở/đóng, 2 lần restart, detect gate |
| P2 | `P2-capabilities.md`, `capture-api.ps1` | Endpoint/phương thức/schema thật, phiên bản, profile/CDP |
| P3 | `P3-probe.md`, `probe-check.mjs` | Trường bắt buộc và hash ổn định giữa hai capture |
| P4 | `P4-cdp.md`, `cdp-check.mjs` | Context sẵn có, session-check, 3 upload riêng tư + theo dõi 7 ngày |
| P5 | `P5-exit.md`, `capture-api.ps1` | Exit check không mở browser, loại ASN |
| P6 | `host-check.mjs` | GPU/màn hình/OS/RAM trong <3 giây, không admin |
| P7 | `P7-mcp.md`, `mcp-http-check.ps1` | Claude Code/Desktop gửi Authorization qua Streamable HTTP |

Sau P2/P3/P4/P5/P6, cập nhật adapter tương ứng và xóa đúng TODO đã có bằng chứng.
Không bắt đầu M1 trước khi P4 đạt. Script chỉ chạy khi người vận hành gọi trực tiếp.

Lệnh Node từ repo root sau `pnpm build`:

```powershell
node spikes/host-check.mjs
node spikes/probe-check.mjs <capture1.json> <capture2.json>
node spikes/cdp-check.mjs <cdp-endpoint>
```

`capture-api.ps1` nhận URL/phương thức đã xác minh từ mã/docs Fury, không đoán endpoint.
Token đọc từ biến `PV_SPIKE_FURY_TOKEN`, không đặt trong đối số hoặc file báo cáo.
