# P7 — MCP Streamable HTTP (chuẩn bị, chưa chạy)

M0 không có MCP; không dùng gateway hiện tại để kết luận P7.
Tạo server mẫu riêng bằng SDK MCP thuộc stack, bind 127.0.0.1 trên cổng test,
chỉ có tool đọc `ping` trả thời điểm server; middleware bắt buộc Authorization Bearer token test.
Token đọc từ biến môi trường, không log; Host/Origin chỉ loopback.

Kiểm cả Claude Code và Claude Desktop: kết nối HTTP /mcp, có token gọi ping được,
thiếu/sai token → 401, POST/GET/DELETE theo transport SDK, đóng kết nối sạch.
Ghi phiên bản SDK/client, cấu hình đã che token, kết quả từng client trong báo cáo.
Script `mcp-http-check.ps1` kiểm initialize thiếu/có token và tools/list trên server test do
người vận hành chuẩn bị; `ProtocolVersion` lấy từ SDK đang dùng, không đoán phiên bản giao thức.
P7 chưa đạt và chưa có server mẫu hoàn chỉnh; triển khai server khi bắt đầu M1 hoặc chạy spike riêng.
