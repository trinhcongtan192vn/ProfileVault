# P3 — Probe

Trong profile test: mở trang probe Fury, xuất hai capture cùng Fury version.
Giữ file thô ngoài Git; loại định danh trước khi tạo fixture.
Chạy `probe-check.mjs` để kiểm adapter hiện tại. Lỗi adapter giả định là bằng chứng cần
chỉnh converter, không phải bằng chứng Fury không có trường đó.

Ánh xạ từng trường `NormalizedProbe` trong contract, đối chiếu SPEC-02 §6.3.
Ghi pass/unknown cho trường thiếu; so hash canvas/WebGL/audio giữa hai lần.
Cập nhật converter/fixture và báo cáo trước khi bỏ TODO(SPIKE-P3).
