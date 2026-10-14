---
name: account-setup
description: Thiết lập một kênh mới trong ProfileVault tới L0 — kiểm trùng, tạo profile Fury đúng chuẩn, mời người đăng nhập, gắn kênh, checklist, nhập probe, kiểm nhất quán. Dùng khi người nói "thêm kênh", "gắn kênh mới", "setup tài khoản".
---

# account-setup

Đầu vào cần hỏi nếu thiếu: tên kênh, nền tảng (`youtube`), `accountId` (YouTube: channel ID `UC…` — Studio → Settings → Channel → Advanced settings), thị trường (mã quốc gia 2 chữ), proxy (nếu người cung cấp).

## Các bước

1. **Kiểm trùng** — `pv_readiness_overview`: kênh hoặc profile đã gắn chưa. Có rồi → dừng, gửi đường dẫn trang kênh.
2. **Tạo profile** — tool MCP của Fury (tạo profile):
   - Persona **Windows** (máy chạy là Windows; persona khác OS bị luật B1/B4 chặn). Ưu tiên GPU cùng hạng với GPU thật của máy (luật B2).
   - Proxy ISP/residential **tĩnh** đúng thị trường; exit IP không trùng kênh khác (luật D1–D2). Không có proxy → hỏi người có chấp nhận dùng IP nhà không (chỉ hợp với kênh test; nhiều kênh chung IP bị D1 chặn lên mức).
   - Múi giờ và ngôn ngữ theo quốc gia của proxy (để trống cho Fury tự theo exit).
   - Tag `pv:youtube`.
   - Không bật "open without proxy" trừ khi người đồng ý ở trên.
3. **Mời người đăng nhập** — hướng dẫn: mở profile trong app Fury (không qua ProfileVault), đăng nhập email của kênh, vào `studio.youtube.com`, đặt ngôn ngữ Studio = **English (US)**, đóng profile bằng nút **Close**. Không đăng nhập email vào chính trình duyệt (sync). **Không** tự nhập mật khẩu.
4. **Gắn kênh** — `pv_binding_create` `{ platform, accountId, displayName, furyProfileId, marketCountry }`. Kênh bắt đầu ở **L0**.
5. **Checklist** — gửi đường dẫn `/bindings/<id>?tab=checklist`. Người điền khu vực tài khoản, quốc gia kênh, ngôn ngữ, email/số khôi phục (chỉ lưu HMAC), 2FA, đăng nhập độc quyền, ngôn ngữ Studio, rồi bấm **Xác nhận**. Skill không xác nhận thay.
6. **Probe** — người mở profile trong Fury → trang khởi đầu → link probe → chạy → "Скачать JSON" (tải JSON) → đưa đường dẫn file. Skill gọi `pv_probe_import { bindingId, filePath }`. Lỗi `INPUT_INVALID` thiếu `furyVersion` → Fury đang tắt, mở Fury rồi nhập lại.
7. **Kiểm nhất quán** — `pv_consistency_run { bindingId }` rồi `pv_consistency_report`. Tóm tắt các luật **block** trượt hoặc `unknown` kèm gợi ý sửa (sửa trong Fury), lặp lại sau khi người sửa. Luật cần loại ASN (A5): người xác nhận ở `/settings?section=asn`.

## Kết thúc

Báo: kênh đang ở **L0**; người upload tay như bình thường và **mỗi lần** bấm "+ Sự kiện → Đã upload" trên dashboard (hoặc nhờ skill ghi `pv_event_record` type `manual.upload`) để tích lũy bằng chứng lên L1.
