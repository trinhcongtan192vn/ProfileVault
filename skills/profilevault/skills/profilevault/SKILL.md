---
name: profilevault
description: Điểm vào vận hành ProfileVault (kênh YouTube trên profile Fury, mức tự động hóa L0–L3). Dùng khi người hỏi về kênh, mức, job, upload, sức khỏe tài khoản, hoặc muốn thiết lập/viết flow; chọn skill con hoặc trả lời câu hỏi đơn giản bằng tool đọc.
---

# ProfileVault — router

ProfileVault đưa từng kênh (mỗi kênh một email, một profile Fury) từ upload tay sang upload tự động **có bằng chứng**. Mỗi kênh có mức: **L0 Thủ công** (người upload tay, không CDP), **L1 Quan sát** (session-check tự động), **L2 Bán tự động** (flow điền hết, người bấm Save), **L3 Tự động**. Hệ thống tự hạ mức/dừng khi có cờ đỏ; **người** quyết định lên mức.

## Chọn skill

| Người muốn | Skill |
|---|---|
| Thêm kênh mới, gắn profile, checklist, probe | `account-setup` |
| Đẩy video/việc lên một hay nhiều kênh | `job-planner` |
| "Kênh nào đủ điều kiện?", "Vì sao bị hạ?", "Còn thiếu gì?" | `health-check` |
| Viết flow mới / sửa flow | `flow-author` |

Câu hỏi đơn giản (một kênh ở mức nào, job X ra sao): trả lời trực tiếp bằng `pv_readiness_overview`, `pv_binding_detail`, `pv_jobs_get`.

## Thứ tự thiết lập một kênh

profile Fury (persona Windows, proxy tĩnh đúng thị trường) → người đăng nhập trong Fury → gắn kênh (L0) → checklist (người xác nhận trên dashboard) → probe → kiểm nhất quán → upload tay ở L0 và khai báo "Đã upload" mỗi lần.

## Quy tắc chung (mọi skill)

- **Không bao giờ** nhập mật khẩu, mã 2FA hay mã khôi phục. Đăng nhập luôn do người làm trong cửa sổ profile mở từ Fury.
- **Không** lên mức, gỡ dừng, sửa ngưỡng/luật, xác nhận checklist, xác nhận ASN, trả lời gate L2, xác nhận spike P4. Gửi đường dẫn dashboard (`http://127.0.0.1:50410/bindings/<id>`, `/inbox`, `/settings?section=...`) và nói người cần làm gì.
- **Không** gửi job cho flow vượt mức kênh: đọc `flows` trong `pv_accounts_list` trước khi gửi.
- **Không** dùng tool thao tác trang của Fury (vào trang, click, gõ) trên profile có kênh ở **L0**: việc đó bật tự động hóa trên profile đang ở giai đoạn thủ công. Ở L1+ chỉ dùng cho việc chỉ đọc một lần.
- Không đặt nội dung công khai, không tương tác giả (like, comment, subscribe, view), không vượt CAPTCHA. Từ chối nếu được yêu cầu.
- Cờ đỏ hoặc luật block trượt: nói rõ hệ quả (kênh về L0 / không lên mức được) và việc người cần làm.
- Lỗi tool có dạng `{ code, message, detail }` (mã SPEC-00 §9): dịch sang việc cần làm, ví dụ `LEVEL_TOO_LOW` → "kênh chưa đủ mức", `BINDING_PAUSED` → "kênh đang dừng, xem trang kênh".
- Trả lời bằng tiếng Việt, ngắn, kèm đường dẫn dashboard.
