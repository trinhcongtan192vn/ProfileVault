# Plugin skill ProfileVault cho Claude (M2)

Cho người vận hành dùng Claude Code hoặc Claude Desktop để thiết lập kênh, gửi việc, hỏi tình trạng và viết flow mới. Skill chỉ gọi tool MCP của ProfileVault và của Fury; quyền không bao giờ vượt token được cấp (SPEC-08).

## Cài đặt

1. Trên dashboard ProfileVault: **Cài đặt → Ứng dụng kết nối** → tạo token tên `claude`, scope `accounts.read, jobs.read, jobs.write, ops.read, ops.write` (bỏ bớt nếu chỉ cần đọc), bộ lọc theo nhu cầu. Token chỉ hiện một lần.
2. Đặt biến môi trường `PROFILEVAULT_TOKEN` cho user Windows (không dán token vào file trong repo).
3. Cấu hình MCP theo `mcp.example.json`:
   - **Claude Code**: `claude mcp add --transport http profilevault http://127.0.0.1:50410/mcp --header "Authorization: Bearer <token>"`, hoặc chép khối `profilevault` vào `.mcp.json` của project.
   - **Claude Desktop**: thêm server HTTP tương ứng trong cài đặt MCP. **[SPIKE-P7]** xác nhận cách khai header trên từng client trước khi dùng thật.
   - **Fury**: `fury-agent mcp` (stdio). Trong app Fury: **AI assistants → Connect** làm việc này một nút.
4. Cài plugin: thư mục này là plugin (`plugin.json` + `skills/<tên>/SKILL.md`).

## Skill

| Skill | Dùng khi |
|---|---|
| `profilevault` | Điểm vào: chọn skill phù hợp hoặc trả lời câu hỏi đơn giản |
| `account-setup` | Gắn một kênh mới từ đầu tới L0 |
| `job-planner` | Đẩy một loạt video/việc lên các kênh |
| `health-check` | Hỏi kênh nào đủ điều kiện, vì sao bị hạ, còn thiếu gì |
| `flow-author` | Viết flow mới theo Flow contract |

## Ranh giới cứng

Lên mức, gỡ dừng, sửa ngưỡng/luật, xác nhận checklist, xác nhận loại ASN, trả lời gate L2, xác nhận spike P4: **chỉ trên dashboard**. Không có tool MCP nào làm được; skill gửi đường dẫn trang dashboard.
