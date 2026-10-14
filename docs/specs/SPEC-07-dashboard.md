# SPEC-07 — Dashboard, trang trạng thái, tray, thông báo

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M0 · **Yêu cầu PRD:** F2, F7, F12; PRD §8 · **Phụ thuộc:** SPEC-02, SPEC-03, SPEC-05

## 1. Mục đích

Giao diện localhost là nơi người vận hành: xem độ sẵn sàng từng kênh, khai báo sự kiện một chạm, quyết định lên mức, xử lý việc chờ người, cấu hình binding/ngưỡng/luật/lịch/token. Tray và toast giữ người vận hành biết việc cần làm khi không mở dashboard.

## 2. Nguyên tắc giao diện

- Tiếng Việt; thuật ngữ cố định: **Mức** (L0 Thủ công, L1 Quan sát, L2 Bán tự động, L3 Tự động), **Dừng**, **Cờ đỏ**, **Điểm nhất quán**, **Chờ bạn**.
- Mọi con số trên dashboard bấm vào được để thấy dữ liệu gốc (sự kiện, run, kết quả luật).
- Hành động có hệ quả (lên mức, gỡ dừng, thu hồi token) có hộp xác nhận nêu rõ hệ quả.
- Cập nhật thời gian thực qua SSE (`/internal/stream`); không cần tải lại trang.
- Hỗ trợ màn hình ≥ 1280 px; nền sáng/tối theo hệ thống.

## 3. Điều hướng

| Trang | Đường dẫn | Nội dung |
|---|---|---|
| Tổng quan | `/` | §4.1 |
| Chi tiết kênh | `/bindings/:id` | §4.2 |
| Gắn kênh mới | `/bindings/new` | §4.3 |
| Chờ bạn | `/inbox` | §4.4 |
| Job & run | `/jobs`, `/runs/:id` | §4.5 |
| Hệ thống | `/system` | §4.6 |
| Lịch | `/schedules` | §4.7 |
| Cài đặt | `/settings/*` | §4.8 |

Thanh trên cùng luôn hiện: trạng thái Fury (online/offline, phiên bản, cảnh báo phiên bản), số việc **Chờ bạn**, số job đang chạy, chế độ bận, tạm dừng toàn cục.

## 4. Trang

### 4.1 Tổng quan
Bảng, mỗi dòng một binding:

| Cột | Nội dung |
|---|---|
| Kênh | Tên, nền tảng, `accountId`; profile Fury |
| Mức | Huy hiệu L0–L3; số ngày ở mức |
| Tiến độ | Thanh % tới mức kế + "còn thiếu: …" (2 điều kiện đầu chưa đạt) |
| Dừng | Biểu tượng + lý do nếu có |
| Cờ đỏ gần nhất | Loại, thời điểm |
| Điểm nhất quán | `đạt/tổng`; số luật block đang trượt/unknown (đỏ nếu > 0) |
| Exit | Quốc gia, ASN, lần kiểm cuối |
| Fury | Phiên bản; detect-suite đạt/chưa cho phiên bản này |
| Hành động | **"+ Sự kiện"** (menu một chạm, §5), **"Lên mức"** (chỉ sáng khi đạt), mở chi tiết |

Lọc theo nền tảng, mức, đang dừng; sắp xếp theo tiến độ, cờ đỏ.

### 4.2 Chi tiết kênh
Đầu trang: tên kênh, mức, nút "Lên mức" / "Tạm dừng" / "Tiếp tục", danh sách dừng đang mở (mỗi cái có lý do, thời điểm, nút gỡ nếu là lý do do người gỡ).

Thẻ (tab):

| Thẻ | Nội dung |
|---|---|
| **Dòng thời gian** | Mọi sự kiện, kiểm proxy, session-check, run, đổi mức, dừng, nâng Fury — theo thời gian, lọc theo loại, màu theo mức độ |
| **Biểu đồ** | §4.2.1 |
| **Ngưỡng** | Bảng điều kiện của chuyển tiếp kế: điều kiện, giá trị hiện tại, yêu cầu, đạt/chưa |
| **Nhất quán** | Bảng luật theo lớp A–E: trạng thái, mức, giá trị thực tế, kỳ vọng, gợi ý; nút "Kiểm tra lại"; so sánh probe gần nhất với probe trước (trường nào đổi) |
| **Checklist** | Form checklist tài khoản (SPEC-02 §6.8); email/số khôi phục nhập vào nhưng không bao giờ hiển thị lại (chỉ "Đã lưu"); nút "Xác nhận"; ngày hết hạn |
| **Probe** | Nút nhập file probe; danh sách probe (thời điểm, phiên bản Fury, nguồn tay/flow) |
| **Cấu hình** | Thị trường, thư mục file cho phép, cấu hình pack (ngôn ngữ Studio…) |

#### 4.2.1 Biểu đồ (theo ngày hoặc tuần, chọn khoảng thời gian)
| Biểu đồ | Dạng |
|---|---|
| Upload theo chế độ (tay / L2 / L3) | Cột chồng |
| Tỉ lệ thành công session-check, flow | Đường |
| `needs_user` theo lý do | Cột chồng |
| Tuổi phiên (ngày kể từ lần đăng nhập lại gần nhất) | Đường bậc thang |
| Exit: quốc gia/ASN/IP theo thời gian | Dải thời gian, điểm đổi được đánh dấu |
| Detect-suite theo phiên bản Fury | Dải thời gian đạt/trượt |
| Điểm nhất quán theo lần kiểm | Đường |

"Tuổi phiên" tính từ sự kiện đỏ về phiên gần nhất (`manual.logged_out`, `session_check.logged_out`) hoặc từ lúc tạo binding.

### 4.3 Gắn kênh mới (wizard)
1. **Chọn profile Fury** từ danh sách (ẩn profile đã gắn).
2. **Tài khoản:** nền tảng, `accountId` (YouTube: channel ID `UC…`), tên hiển thị, thị trường (quốc gia).
3. **Cấu hình pack** theo `bindingConfigSchema`; thư mục file cho phép.
4. **Checklist tài khoản.**
5. **Probe:** hướng dẫn mở profile trong Fury → trang probe → xuất file → kéo thả vào đây (có thể bỏ qua, làm sau).
6. **Kết quả kiểm nhất quán** ngay lập tức, kèm gợi ý sửa. Binding được tạo ở L0 dù còn luật trượt.

### 4.4 Chờ bạn
Danh sách run `needs_user`, mới nhất trên cùng: kênh, flow, lý do, thông điệp, thời gian còn lại trước khi hết hạn, các nút lựa chọn của gate, nút "Mở run". Gate `review_before_final` (L2) hiện tóm tắt metadata đã điền để người đối chiếu trong cửa sổ profile. Cộng thêm các mục cần người không phải run: dừng chờ gỡ, checklist sắp hết hạn, ASN chưa phân loại, phiên bản Fury chưa có detect-suite.

### 4.5 Job và run
- `/jobs`: bảng job (client, flow, kênh, trạng thái, tạo lúc, kết quả/mã lỗi), lọc theo trạng thái/client/kênh.
- `/runs/:id`: các bước (trạng thái, số lần thử, thời gian), log, ảnh/trace khi lỗi (tải về), đầu vào (ẩn đường dẫn đầy đủ nếu dài), kết quả; nút hủy; gate đang chờ.

### 4.6 Hệ thống
Ma trận chéo giữa các kênh (hàng × cột = binding) tô các cặp trùng exit IP (đỏ), cùng dải mạng (vàng), cùng ASN + persona (vàng), trùng khôi phục (đỏ); tỉ lệ thành công theo flow; số `SITE_CHANGED` theo bước; thời gian trung bình một upload; hàng đợi; profile đang chạy; RAM trống; chế độ bận; pack đã nạp và lỗi lint nếu có.

### 4.7 Lịch
Danh sách lịch (flow, mục tiêu, ngày, khung giờ, bật/tắt, lượt kế tiếp theo từng binding). Tạo/sửa/xóa.

### 4.8 Cài đặt
| Mục | Nội dung |
|---|---|
| Kết nối Fury | Địa chỉ, token (nhập/đổi), kiểm kết nối, bảng năng lực (`native/fallback/missing`), khoảng phiên bản hỗ trợ |
| Ngưỡng | Sửa điều kiện từng chuyển tiếp (SPEC-02 §3.3); lịch sử thay đổi |
| Luật nhất quán | Bật/tắt, mức, tham số từng luật; lịch sử thay đổi |
| Detect-suite | Nhập kết quả theo phiên bản Fury (toàn cục hoặc theo kênh) |
| ASN | Danh sách ASN đã xác nhận loại; thêm/sửa |
| Runner | Giới hạn đồng thời, RAM mỗi profile, thời gian chờ profile/gate, độ trễ thao tác, giới hạn upload/ngày |
| Ứng dụng kết nối | Tạo token (tên, scope, bộ lọc), hiển thị token một lần, thu hồi, lần dùng cuối |
| Xuất dữ liệu | CSV: sự kiện, kiểm proxy, run, đổi mức, kết quả nhất quán |

## 5. Khai báo sự kiện một chạm
- Nút "+ Sự kiện" trên dòng tổng quan và đầu trang chi tiết mở menu: **Đã upload** · **Yêu cầu xác minh** · **CAPTCHA** · **Cảnh báo từ nền tảng** · **Bị đăng xuất** · **Ghi chú**.
- Chọn mục thường (Đã upload, Ghi chú) → ghi ngay, hiện thông báo "Đã ghi" kèm "Hoàn tác" trong 10 giây (hoàn tác = ghi sự kiện bù, không xóa).
- Chọn mục đỏ → hộp xác nhận nêu hệ quả ("Kênh sẽ về L0 và dừng mọi job"), có ô thời điểm (mặc định bây giờ) và ghi chú.
- Phím tắt trên trang chi tiết: `U` = Đã upload.

## 6. Tray

Menu:
- **Mở dashboard**
- Trạng thái (chỉ đọc): Fury online/offline · Đang chạy N · Chờ bạn M
- **Chế độ bận** (bật/tắt)
- **Tạm dừng mọi job** (bật/tắt)
- **Khởi động cùng Windows** (bật/tắt)
- **Thoát** (hỏi xác nhận nếu có run đang chạy; run đang chạy được hủy an toàn theo SPEC-03 §5.6)

Biểu tượng đổi màu: xám (Fury offline), xanh (bình thường), cam (có việc chờ bạn), đỏ (có kênh vừa bị hạ mức trong 24 giờ).

## 7. Thông báo (toast)

| Khi | Nội dung | Bấm vào |
|---|---|---|
| Run `needs_user` | "{kênh}: {thông điệp gate}" | Trang Chờ bạn |
| Hạ mức / dừng (R1–R5) | "{kênh} về {mức}: {lý do}" | Chi tiết kênh |
| Binding đạt ngưỡng mức kế | "{kênh} đủ điều kiện lên {mức}" (tối đa 1 lần/ngày/kênh) | Chi tiết kênh, thẻ Ngưỡng |
| Run L2 sẵn sàng để xem | "{kênh}: đã điền xong, mời bạn kiểm tra và bấm Save" | Trang Chờ bạn |
| Nhắc khai báo | Lúc `ui.dailyReminderLocalTime`: liệt kê kênh có profile được mở trong ngày (từ `fury.profile_opened`) mà không có sự kiện tay nào | Tổng quan |
| Checklist sắp hết hạn (7 ngày) | "{kênh}: xác nhận lại checklist" | Thẻ Checklist |
| Fury offline > 10 phút, hoặc phiên bản ngoài khoảng hỗ trợ | Thông báo hệ thống | Cài đặt → Kết nối Fury |

Không gửi toast trùng nội dung trong 30 phút.

## 8. Dữ liệu biểu đồ
`GET /internal/charts/:name` với `name ∈ { uploads_by_mode, success_rates, needs_user_by_reason, session_age, exit_timeline, detect_suite_timeline, consistency_score }`, tham số `bindingId`, `from`, `to`, `bucket`. Server tổng hợp bằng SQL trên các bảng SPEC-00 §8; trả mảng `{ bucket, series: Record<string, number> }` hoặc mảng khoảng thời gian cho dạng dải.

## 9. Nghiệm thu
- Khai báo "Đã upload" một chạm hiện trên dòng thời gian ngay (SSE).
- Khai báo "CAPTCHA" → hộp xác nhận; xác nhận → mức về L0, dòng tổng quan cập nhật, toast đỏ.
- "Lên mức" tắt khi còn điều kiện chưa đạt; thẻ Ngưỡng chỉ đúng điều kiện thiếu.
- Ma trận hệ thống tô đỏ hai kênh cùng exit IP.
- Xuất CSV sự kiện khớp số dòng trong CSDL cho cùng khoảng thời gian.
