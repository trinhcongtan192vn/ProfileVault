# Kế hoạch spike (M-1)

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Nguồn:** PRD v1.3 §6, §12; SPEC-00

Spike chạy trên **kênh test** (tài khoản Google thử nghiệm, kênh riêng tư), không chạm kênh thật. Mỗi spike có câu hỏi, cách làm, tiêu chí đạt, và các chỗ trong spec sẽ được cập nhật (đánh dấu **[SPIKE-Pn]** trong spec). Kết quả ghi vào `specs/SPIKE-bao-cao.md`.

Thời lượng dự kiến: 3–5 ngày làm việc, cộng 7 ngày theo dõi cho P4.

---

## P1 — Cài Fury và giữ phiên

| | |
|---|---|
| Câu hỏi | Fury chạy ổn trên máy Windows mục tiêu không; phiên Google trong profile có giữ được qua nhiều lần mở/đóng và khởi động lại máy không? |
| Cách làm | Cài bản Fury Windows mới nhất (≥ 0.2.21); tạo profile persona Windows với proxy ISP/residential tĩnh; đăng nhập tài khoản test; mở/đóng 5 lần trong 7 ngày, khởi động lại máy 2 lần; chạy `fury-detect gate` |
| Đạt khi | Không phải đăng nhập lại trong 7 ngày; detect-suite xanh; không có yêu cầu xác minh |
| Cập nhật | SPEC-09 (môi trường test) |

## P2 — Ma trận năng lực Automation API của Fury

| | |
|---|---|
| Câu hỏi | Mỗi năng lực `FuryClient` cần (SPEC-01 §3) lấy từ đâu: endpoint automation API, MCP của Fury, hay file dữ liệu của Fury? |
| Cách làm | Bật `FURY_API_PORT`; gọi cả 6 endpoint; đọc mã nguồn `agent/` để xác định định dạng; với năng lực thiếu, tìm trong MCP của Fury và thư mục dữ liệu profile |
| Đạt khi | Có nguồn xác định cho: liệt kê profile, trạng thái mở/đóng, mở profile có CDP và trả endpoint, đóng profile, phiên bản Fury. Có hoặc không có nguồn cho: cấu hình persona/múi giờ/ngôn ngữ/geolocation, seed, kiểm exit proxy không mở trình duyệt |
| Cập nhật | SPEC-01 §3 (bảng ánh xạ), §6 (fallback); SPEC-02 §6.2 (nguồn dữ liệu luật) |

## P3 — Định dạng probe

| | |
|---|---|
| Câu hỏi | Trang probe của Fury xuất file gì; có đủ trường cho bộ luật SPEC-02 §6.4 không? |
| Cách làm | Mở trang probe trong profile; xuất capture; so với danh sách trường `NormalizedProbe` (SPEC-02 §6.3); chạy hai lần cùng phiên bản Fury để kiểm hash ổn định |
| Đạt khi | Ánh xạ được ≥ các trường bắt buộc của `NormalizedProbe`; hash canvas/WebGL/audio giống nhau giữa hai lần đo |
| Cập nhật | SPEC-02 §6.3 (bộ chuyển đổi), danh sách luật dùng được ngay ở M0 |

## P4 — CDP và phản ứng của YouTube Studio

| | |
|---|---|
| Câu hỏi | Mở profile có CDP rồi Playwright `connectOverCDP` vào context có sẵn có hoạt động; YouTube Studio có phản ứng bất thường không? |
| Cách làm | Script Playwright: mở Studio, kiểm tra đăng nhập, upload 3 video ngắn ở chế độ riêng tư trong 3 ngày, đọc `video_id`; theo dõi thêm 7 ngày |
| Đạt khi | 3 upload thành công, đúng metadata, đọc đúng `video_id`; không có xác minh/CAPTCHA/cảnh báo trong 7 ngày |
| Không đạt | Giữ kênh ở L0/L1 lâu dài; xem lại L2/L3 trước khi làm M1 |
| Cập nhật | SPEC-04 §5 (màn hình, selector, thời gian chờ), SPEC-03 §5 (vòng đời CDP) |

## P5 — Kiểm exit proxy và loại ASN

| | |
|---|---|
| Câu hỏi | Fury có kiểm exit (IP, quốc gia, thành phố, múi giờ, ASN) mà không mở trình duyệt không? Phân loại ASN (ISP/residential/hosting) lấy từ đâu? |
| Cách làm | Thử năng lực kiểm proxy của Fury (API/MCP); kiểm trường trả về; thử cơ sở dữ liệu `.mmdb` cục bộ mà Fury hỗ trợ |
| Đạt khi | Có cách lấy exit info theo lịch không mở trình duyệt. Loại ASN: có nguồn tự động, hoặc chốt dùng xác nhận tay (`asn_attestations`) |
| Cập nhật | SPEC-01 §3, SPEC-02 §6.4 (luật A5) |

## P6 — Thông tin máy chạy

| | |
|---|---|
| Câu hỏi | Đọc được OS, phiên bản, GPU, màn hình, RAM từ Node trên Windows không cần quyền admin? |
| Cách làm | `os` module + PowerShell `Get-CimInstance Win32_VideoController`, `[System.Windows.Forms.Screen]::AllScreens` |
| Đạt khi | Trả đủ trường `host_snapshots` trong < 3 giây |
| Cập nhật | SPEC-02 §6.2 |

## P7 — MCP qua Streamable HTTP

| | |
|---|---|
| Câu hỏi | Claude Code và Claude Desktop kết nối được MCP server HTTP loopback có header `Authorization` không? |
| Cách làm | Server MCP mẫu với 1 tool trên `127.0.0.1:50410/mcp`; cấu hình ở cả hai client |
| Đạt khi | Cả hai gọi được tool; header token được gửi |
| Cập nhật | SPEC-05 §6, SPEC-08 §2 |

---

## Thứ tự

P1 → P2 → (P3, P5, P6 song song) → P4 → P7. P4 cần P2 (mở profile có CDP). Không bắt đầu M1 khi P4 chưa đạt.
