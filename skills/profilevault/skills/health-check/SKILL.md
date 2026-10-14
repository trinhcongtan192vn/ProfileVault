---
name: health-check
description: Trả lời câu hỏi về sức khỏe và độ sẵn sàng của các kênh trong ProfileVault — kênh nào đủ điều kiện lên mức, vì sao kênh bị hạ/dừng, còn thiếu gì để lên mức kế, phiên nào sắp có vấn đề. Có thể ghi sự kiện tay khi người kể lại.
---

# health-check

Tool: `pv_readiness_overview`, `pv_binding_detail`, `pv_events_list`, `pv_consistency_report`; ghi: `pv_event_record`.

## Câu hỏi thường gặp

- **"Kênh nào đủ điều kiện lên mức?"** — `pv_readiness_overview`: kênh có `readiness.canPromote = true`. Trả lời khớp đúng bảng Tổng quan; nhắc người bấm **Lên mức** trên trang kênh (skill không lên mức).
- **"Vì sao kênh X bị hạ / đang dừng?"** — `pv_binding_detail` (`openPauses`, sự kiện gần đây) + `pv_events_list` lọc `severity` đỏ. Nêu sự kiện gây hạ (loại, thời điểm) và cách gỡ: dừng do người gỡ được (R1, R2, R7) → gỡ trên dashboard; dừng do luật nhất quán → sửa cấu hình rồi kiểm lại.
- **"Còn thiếu gì để lên L2?"** — `pv_binding_detail.readiness.conditions`: liệt kê điều kiện chưa đạt kèm giá trị hiện tại và yêu cầu.
- **"Kênh nào phiên sắp có vấn đề?"** — kênh có session-check gần đây `logged_out`/`challenge`, checklist sắp hết hạn, exit đổi quốc gia/ASN, luật block `unknown` do dữ liệu cũ > 14 ngày.
- **Nhất quán** — `pv_consistency_report`: luật block trượt/unknown + gợi ý sửa (tiếng Việt, đã có trong kết quả).

## Ghi sự kiện tay

Khi người kể lại ("hôm qua kênh X bị đòi xác minh"): `pv_event_record { bindingId, type, occurredAt, note }`.
**Luôn hỏi lại trước khi ghi sự kiện đỏ** (`manual.verification_request`, `manual.captcha`, `manual.platform_warning`, `manual.logged_out`): ghi xong kênh **về L0 và dừng mọi job**. "Đã upload" (`manual.upload`) và ghi chú ghi ngay.

Trả lời ngắn, có số liệu, kèm đường dẫn trang kênh.
