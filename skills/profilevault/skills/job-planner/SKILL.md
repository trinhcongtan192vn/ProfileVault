---
name: job-planner
description: Lập và gửi một loạt job lên ProfileVault (ví dụ đẩy nhiều video lên các kênh), kiểm mức trước khi gửi, theo dõi tới khi xong và tổng hợp kết quả. Dùng khi người nói "đẩy các video này lên kênh X", "upload thư mục này", "gửi job".
---

# job-planner

Đầu vào: danh sách việc — thư mục video + metadata, hoặc danh sách người đưa (tiêu đề, mô tả, made for kids, tag, playlist…).

## Các bước

1. **Tài khoản và flow** — `pv_accounts_list`. Với mỗi kênh đích lấy `level`, `paused`, `flows` (flow gửi được ở mức hiện tại, kèm `mode` L2/L3).
2. **Kênh chưa đủ mức** — nếu `youtube/upload` không có trong `flows` của kênh: **không gửi**. Gọi `pv_binding_detail` và báo: kênh đang ở mức nào, còn thiếu điều kiện gì (thẻ Ngưỡng), đường dẫn `/bindings/<id>`. Không đề nghị "lên mức giúp" — đó là việc của người trên dashboard.
3. **File** — mỗi file cần đường dẫn **tuyệt đối** nằm trong *thư mục file cho phép* của kênh (Cấu hình kênh trên dashboard) và SHA-256 chính xác. Tính SHA-256 bằng công cụ của client (ví dụ PowerShell `Get-FileHash -Algorithm SHA256`). Không sửa/di chuyển file sau khi gửi tới khi job xong (tránh `FILE_CHANGED`).
4. **idempotencyKey ổn định** — dạng `claude:<tên kênh>:<tên file>:<8 ký tự đầu sha256>`. Gửi lại sau lỗi mạng an toàn (server trả job cũ, `duplicate: true`).
5. **Gửi** — `pv_jobs_submit { flowId: 'youtube/upload', account: { platform, accountId }, idempotencyKey, input: { video: { path, sha256 }, title, description, madeForKids, … } }`.
6. **Theo dõi** — `pv_jobs_wait { jobId, timeoutSeconds: 50 }` lặp lại cho tới khi `done`/`failed`/`cancelled`, hoặc dừng sớm và báo tiến độ nếu người không muốn chờ.
7. **Tổng hợp**:
   - Xong: `videoId`, link Studio (`result.studioUrl`), cảnh báo (`result.warnings`).
   - Chờ người (`needs_user`): lý do + đường dẫn `/inbox`. Ở **L2** nói rõ: flow đã điền xong, người cần kiểm tra trong cửa sổ profile, **tự bấm Save**, rồi chọn kết quả trên trang Chờ bạn.
   - Lỗi: mã + việc cần làm (`DAILY_LIMIT_REACHED` → đủ 10 upload hôm nay; `SESSION_EXPIRED`/`CHALLENGE` → kênh đã về L0, người xử lý trong Fury; `SITE_CHANGED` → giao diện Studio đổi, báo người cập nhật locator; `FLOW_DISABLED` reason `p4_not_passed` → flow upload còn khóa tới khi người xác nhận spike P4 ở Cài đặt → Runner).

Không bao giờ đặt video Public/Unlisted/Schedule; flow luôn để **Private**.
