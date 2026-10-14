# SPEC-08 — Skill cho Claude

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M2 · **Yêu cầu PRD:** F21; UC10 · **Phụ thuộc:** SPEC-05 §6, SPEC-06

## 1. Mục đích

Cho người vận hành dùng Claude Code/Desktop để thiết lập kênh, gửi việc, hỏi tình trạng và viết flow mới bằng ngôn ngữ tự nhiên. Skill chỉ dùng tool MCP của ProfileVault và của Fury; không có quyền nào vượt quá token được cấp.

## 2. Cài đặt

- Bố cục plugin trong repo: `skills/profilevault/` gồm `plugin.json` và `skills/<tên>/SKILL.md` (+ `references/`).
- Cấu hình MCP cho client:
  - ProfileVault: Streamable HTTP `http://127.0.0.1:50410/mcp`, header `Authorization: Bearer <token>`; token tạo trên dashboard với scope `accounts.read, jobs.read, jobs.write, ops.read, ops.write`, bộ lọc theo nhu cầu.
  - Fury: `fury-agent mcp` theo hướng dẫn của Fury.
- **[SPIKE-P7]** xác nhận cách khai header cho từng client.

## 3. Quy tắc chung (mọi skill)

- **Không bao giờ** nhập mật khẩu, mã 2FA hay mã khôi phục; đăng nhập luôn do người làm trong cửa sổ profile mở từ Fury.
- **Không** lên mức, gỡ dừng, sửa ngưỡng/luật, xác nhận checklist, trả lời gate L2: hướng người tới dashboard (gửi đường dẫn trang cụ thể).
- **Không** gửi job cho flow vượt mức binding; đọc `flows` trong `pv_accounts_list` trước khi gửi.
- **Không** dùng tool thao tác trang của Fury (vào trang, click, gõ) trên profile có binding ở L0, vì điều đó bật tự động hóa trên profile đang ở giai đoạn thủ công. Ở L1+ chỉ dùng cho việc chỉ đọc một lần.
- Với kết quả có cờ đỏ hoặc luật block trượt: nói rõ hệ quả và việc người cần làm.
- Trả lời bằng tiếng Việt, ngắn, kèm đường dẫn dashboard.

## 4. Danh mục skill

### 4.1 `profilevault` (router)
Nhận yêu cầu, chọn skill phù hợp, hoặc trả lời trực tiếp câu hỏi đơn giản bằng tool đọc. Biết thứ tự thiết lập một kênh: profile Fury → đăng nhập → gắn kênh → checklist → probe → kiểm nhất quán → upload tay ở L0.

### 4.2 `account-setup`
Đầu vào: tên kênh, nền tảng, `accountId`, thị trường (quốc gia), proxy (nếu người cung cấp).

| Bước | Công cụ | Ghi chú |
|---|---|---|
| 1. Kiểm trùng | `pv_readiness_overview` | Kênh/profile đã gắn chưa |
| 2. Tạo profile | MCP Fury (tạo profile) | Persona **Windows**; proxy ISP/residential tĩnh đúng thị trường, exit IP không trùng kênh khác; múi giờ và ngôn ngữ theo quốc gia của proxy; tag `pv:<platform>` |
| 3. Mời người đăng nhập | — | Hướng dẫn mở profile trong Fury, đăng nhập email của kênh, đặt ngôn ngữ Studio = English (với YouTube) |
| 4. Gắn kênh | `pv_binding_create` | Bắt đầu ở L0 |
| 5. Checklist | — | Gửi đường dẫn thẻ Checklist (người điền và xác nhận trên dashboard) |
| 6. Probe | `pv_probe_import` | Người mở trang probe trong Fury, xuất file, đưa đường dẫn; skill nhập |
| 7. Kiểm nhất quán | `pv_consistency_run`, `pv_consistency_report` | Tóm tắt luật trượt + gợi ý sửa; lặp lại sau khi người sửa |

Kết thúc: báo kênh đang ở L0, nhắc khai báo mỗi lần upload tay.

### 4.3 `job-planner`
Đầu vào: danh sách việc (ví dụ thư mục video + metadata, hoặc danh sách từ người).
1. `pv_accounts_list` → xác định tài khoản và flow/mode dùng được.
2. Với kênh dưới mức yêu cầu: không gửi; báo kênh ở mức nào và còn thiếu gì (`pv_binding_detail`).
3. Tính SHA-256 file (người cung cấp hoặc skill tính bằng công cụ của client), tạo `idempotencyKey` ổn định.
4. `pv_jobs_submit` từng job; `pv_jobs_wait` theo dõi.
5. Tổng hợp: job xong (`videoId`, link Studio), job chờ người (đường dẫn trang Chờ bạn), job lỗi (mã + việc cần làm).
Ở chế độ L2: nói rõ người cần kiểm tra và bấm Save trong cửa sổ profile cho từng video.

### 4.4 `health-check`
Trả lời: "Kênh nào đủ điều kiện lên mức?", "Vì sao kênh X bị hạ?", "Còn thiếu gì để lên L2?", "Kênh nào phiên sắp có vấn đề?". Dùng `pv_readiness_overview`, `pv_binding_detail`, `pv_events_list`, `pv_consistency_report`. Có thể ghi sự kiện tay khi người kể lại (`pv_event_record`), luôn hỏi lại trước khi ghi sự kiện đỏ vì nó hạ mức kênh.

### 4.5 `flow-author`
Viết flow mới theo Flow contract (SPEC-03) trong repo pack người dùng:
1. Làm rõ mục tiêu, trang đích, đầu vào/ra, mức tối thiểu (chỉ đọc → L1; ghi → L2/L3 và bắt buộc có bước `final`).
2. Viết `index.ts` chỉ dùng `ctx.ui`; locator theo role/name; mỗi bước có hậu kiểm.
3. Viết test với trang HTML giả lập.
4. Chạy lint của pack; sửa tới khi sạch.
5. Hướng dẫn người chạy thử trên binding test qua dashboard.
Không bao giờ viết bước đặt công khai, tương tác giả (like, comment, subscribe, view) hay vượt CAPTCHA; từ chối nếu được yêu cầu.

## 5. Nghiệm thu (PRD §12, M2)
- Hỏi "kênh nào đủ điều kiện lên mức" → câu trả lời khớp dashboard.
- "Đẩy 3 video này lên kênh Y" với kênh Y ở L3 → 3 job `done`, trả `videoId`.
- Cùng yêu cầu với kênh ở L1 → không gửi job, giải thích mức và điều kiện còn thiếu.
- Yêu cầu "lên L2 cho kênh X" → không làm, gửi đường dẫn dashboard.
