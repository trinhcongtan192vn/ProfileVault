# SPEC-06 — Job service và Integration API `profilevault/v1`

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M1 (job do lịch tạo dùng từ M0) · **Yêu cầu PRD:** F18, F20 · **Phụ thuộc:** SPEC-00, SPEC-02, SPEC-03, SPEC-05

## 1. Mục đích

Job service là cửa duy nhất tạo việc cho Runner: nhận yêu cầu từ app ngoài, skill, lịch và dashboard; kiểm tra quyền, mức, file, giới hạn, trùng lặp; tạo job + run; chuẩn hóa kết quả và lỗi. Integration API `profilevault/v1` là hợp đồng công khai cho app ngoài, đóng gói trong `@sctech/profilevault-contract`.

## 2. Khái niệm

- **Job:** một yêu cầu chạy một flow trên một binding với một input. Có `idempotency_key` duy nhất theo client.
- **Run:** một lần thực thi job trên profile (SPEC-03). Mỗi job có một run; khôi phục sau gián đoạn dùng lại run đó (`attempt + 1`).
- **Client đặc biệt:** `scheduler` (lịch), `dashboard` (người vận hành gửi từ giao diện). Không có token, không đi qua `/api/v1`.

## 3. Tiếp nhận job

`submit({ clientId, flowId, account | bindingId, input, idempotencyKey })` kiểm theo thứ tự; dừng ở lỗi đầu tiên.

| # | Kiểm | Lỗi |
|---|---|---|
| 1 | Schema request | `INPUT_INVALID` |
| 2 | Client có `jobs.write`; flow và binding trong bộ lọc | `FORBIDDEN_SCOPE` |
| 3 | `(clientId, idempotencyKey)` đã tồn tại → trả job cũ | `DUPLICATE_JOB` (HTTP 200) |
| 4 | Flow tồn tại và đang bật | `FLOW_NOT_FOUND` / `FLOW_DISABLED` |
| 5 | Binding tìm được (`platform + accountId` hoặc `bindingId`), chưa archive, cùng nền tảng với flow (hoặc flow `generic`) | `ACCOUNT_NOT_BOUND` |
| 6 | Binding không bị dừng | `BINDING_PAUSED` |
| 7 | `binding.level ≥ flow.minLevel` | `LEVEL_TOO_LOW` |
| 8 | Input khớp `manifest.input` | `INPUT_INVALID` (kèm đường dẫn trường lỗi) |
| 9 | Mọi đường dẫn file trong input: nằm trong `allowed_roots` của binding (sau khi chuẩn hóa, không theo symlink ra ngoài), tồn tại, đọc được, SHA-256 khớp | `FILE_NOT_ALLOWED` / `FILE_NOT_FOUND` / `FILE_CHANGED` |
| 10 | Flow `countsAsUpload`: số upload của tài khoản trong ngày địa phương (job `done` + `queued`/`running`/`needs_user` + sự kiện `manual.upload`) < `limits.uploadsPerAccountPerDay` | `DAILY_LIMIT_REACHED` |
| 11 | Fury reachable và phiên bản hỗ trợ | Không chặn tiếp nhận; job vào hàng đợi, Runner xử lý (SPEC-03 §5.3) |

Đạt hết → tạo `jobs` (`status = queued`, `mode = 'L2'` nếu flow có chế độ và binding ở L2, `'L3'` nếu ở L3, `NULL` nếu flow không có chế độ) và `runs` (`queued`); audit; trả job.

Mức của binding có thể đổi sau khi nhận job: Runner kiểm lại ngay trước khi mở profile. Nếu binding lên L3 trong lúc job L2 đang chờ, job giữ chế độ L2 đã ghi.

Hash file được tính lại ngay trước bước upload trong flow (`ctx.ui.upload` so với hash trong input); khác → `FILE_CHANGED`.

## 4. Trạng thái job

```
queued → running → done
               ↘ needs_user → running …
               ↘ failed | cancelled
queued → cancelled | failed
(tiếp nhận lỗi ở bước 4–10 → không tạo job; trả lỗi ngay)
```

`job.status` phản chiếu run: `queued` (run `queued`/`waiting_profile`), `running` (`launching`/`running`/`finalizing`), `needs_user`, `done`, `failed`, `cancelled`. `rejected` dùng khi Runner hủy vì binding bị dừng hoặc hạ mức sau khi nhận (`error_code` = `BINDING_PAUSED` / `LEVEL_TOO_LOW`).

## 5. Integration API `profilevault/v1` (REST)

Cơ sở: `http://127.0.0.1:50410/api/v1`. Xác thực Bearer (SPEC-05 §4.2). JSON UTF-8.

### 5.1 `GET /accounts?platform=youtube`
Scope `accounts.read`. Chỉ trả binding trong bộ lọc của client.

```json
{ "accounts": [ {
  "platform": "youtube", "accountId": "UCxxxx", "displayName": "Tiefer Denken",
  "level": 2, "paused": false,
  "flows": [ { "flowId": "youtube/upload", "mode": "L2" }, { "flowId": "youtube/session-check" } ] } ] }
```
`flows` = flow client được phép gửi cho tài khoản này ở mức hiện tại.

### 5.2 `GET /flows`
Scope `jobs.read`. `{ "flows": [ { "flowId", "version", "minLevel", "modes", "inputSchema" (JSON Schema), "outputSchema" } ] }` trong bộ lọc của client.

### 5.3 `POST /jobs`
Scope `jobs.write`.

```json
{
  "contractVersion": "profilevault/v1",
  "flowId": "youtube/upload",
  "account": { "platform": "youtube", "accountId": "UCxxxx" },
  "idempotencyKey": "studioflow:video_123:render_ab12",
  "input": { "video": { "path": "E:\\exports\\v123.mp4", "sha256": "…" }, "title": "…", "description": "…", "madeForKids": false },
  "source": { "app": "studioflow-agent", "ref": "video_123", "traceparent": "00-…" }
}
```

Trả `201` (tạo mới) hoặc `200` + `X-PV-Duplicate: true` (trùng), thân là đối tượng Job (§5.4).

### 5.4 `GET /jobs/:id`
Scope `jobs.read`; chỉ job của chính client.

```json
{
  "id": "jb_…", "flowId": "youtube/upload", "account": { "platform": "youtube", "accountId": "UCxxxx" },
  "status": "needs_user", "mode": "L2",
  "progress": { "step": "review_before_final", "stepIndex": 9, "stepCount": 11, "percent": 82 },
  "needsUser": { "reason": "review_before_final", "message": "Đã điền xong, mời kiểm tra và bấm Save", "since": "…", "expiresAt": "…" },
  "result": null,
  "error": null,
  "createdAt": "…", "updatedAt": "…"
}
```

`result` theo `manifest.output` khi `done`; `error = { code, message, detail }` khi `failed`/`rejected`/`cancelled`. `needsUser` không bao giờ chứa lựa chọn để app ngoài trả lời: gate chỉ người trả lời trên dashboard.

### 5.5 `GET /jobs?status=&flowId=&accountId=&since=&limit=50&cursor=`
Scope `jobs.read`. Phân trang bằng cursor, mới nhất trước.

### 5.6 `POST /jobs/:id/cancel`
Scope `jobs.write`. Theo SPEC-03 §5.6. Trả Job hiện tại.

### 5.7 `GET /health`
Không cần scope (vẫn cần token hợp lệ). `{ "service": "ok", "fury": { "reachable": true, "version": "0.2.23", "supported": true }, "contractVersion": "profilevault/v1" }`.

## 6. Hướng dẫn cho app gọi
- Hỏi trạng thái mỗi 15–30 giây khi có job chưa kết thúc; hoặc dùng MCP `pv_jobs_wait`.
- `idempotencyKey` phải ổn định cho cùng một nội dung (ví dụ `<app>:<id nội dung>:<hash bản render>`). Gửi lại sau lỗi mạng an toàn.
- Lỗi "Không thử lại" ở SPEC-00 §9 → báo người dùng của app; `BINDING_PAUSED`/`LEVEL_TOO_LOW` → hiển thị "Kênh chưa sẵn sàng tự động hóa".
- Không đọc/ghi file sau khi gửi job cho tới khi job kết thúc (tránh `FILE_CHANGED`).
- `FURY_OFFLINE`/ProfileVault không phản hồi → giữ hàng đợi phía app, thử lại.

## 7. Package `@sctech/profilevault-contract`
- Zod schema: request/response của §5, `Job`, `JobStatus`, mã lỗi SPEC-00 §9, input/output của từng flow chính thức (`youtube/upload`, `youtube/session-check`, flow generic).
- Hằng `CONTRACT_VERSION = 'profilevault/v1'`; thay đổi phá vỡ → `profilevault/v2`, server hỗ trợ song song v1 ít nhất một phiên bản chính.
- Client mẫu TypeScript (`ProfileVaultClient`) dùng `fetch`, có thử lại cho lỗi mạng và 429.
- Bộ contract test (SPEC-09 §5) chạy được với server thật hoặc server giả lập.

## 8. Trace
Nếu request có `source.traceparent`, span của job/run gắn làm con của trace đó (OpenTelemetry), để app gọi xem chung luồng.

## 9. Nghiệm thu (PRD §12, M1)
- Kênh test ở L3: 5 job liên tiếp `done`, gửi lại cùng `idempotencyKey` trả job cũ, không có video trùng.
- Kênh ở L1 nhận `youtube/upload` → `LEVEL_TOO_LOW`.
- File sửa sau khi gửi → `FILE_CHANGED`.
- Client chỉ được lọc `youtube/upload` gửi `generic/read-page` → `FORBIDDEN_SCOPE`.
- Upload thứ 11 trong ngày của một tài khoản → `DAILY_LIMIT_REACHED`.
