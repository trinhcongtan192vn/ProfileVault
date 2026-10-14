# P5 — Exit và ASN

Dùng endpoint kiểm proxy đã xác minh ở P2 và `capture-api.ps1`; không đoán route.
Trước/sau request, kiểm trạng thái profile: vẫn đóng, không bật CDP.
Ghi các trường có/thiếu: IP, country, city, timezone, ASN, org, loại ASN.
Thử nguồn mmdb cục bộ theo Fury nếu có. Không có phân loại tự động → chốt xác nhận tay
qua asn_attestations, giữ `unknown` khi chưa xác nhận.
Đối chiếu SPEC-01 §3 và luật A5; ghi báo cáo và cập nhật adapter P5.
