# SPEC-04 — Flow pack `generic` và `youtube`

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M0 (`youtube/session-check`), M1 (còn lại) · **Yêu cầu PRD:** F5, F17, F19 · **Phụ thuộc:** SPEC-03

## 1. Danh mục flow

| Flow | minLevel | Chế độ | Giai đoạn | Mục đích |
|---|---|---|---|---|
| `youtube/session-check` | 1 | — | M0 | Kiểm phiên đăng nhập, đúng kênh, ngôn ngữ Studio |
| `generic/session-check` | 1 | — | M0 | Kiểm phiên cho nền tảng chưa có flow riêng (cấu hình bằng URL + dấu hiệu) |
| `generic/probe` | 1 | — | M1 | Chạy trang probe của Fury, trả dữ liệu cho kiểm tra nhất quán |
| `generic/read-page` | 1 | — | M1 | Đọc dữ liệu từ trang trong danh sách domain của nền tảng |
| `generic/open-and-wait` | 1 | — | M1 | Mở một trang trong profile rồi chờ người làm tay |
| `youtube/upload` | 2 | L2, L3 | M1 | Upload video, điền metadata, để riêng tư |

Mọi flow tuân theo SPEC-03 (chỉ thao tác qua `ctx.ui`, mọi bước có hậu kiểm).

## 2. Pack `generic`

### 2.1 Cấu hình theo nền tảng
Pack nền tảng cung cấp cho flow generic qua `pack.json` khóa `generic`:

```json
"generic": {
  "sites": ["studio.youtube.com", "www.youtube.com", "accounts.google.com"],
  "session": { "url": "https://studio.youtube.com/", "loggedOutUrlPattern": "^https://accounts\\.google\\.com/", "challengeUrlPattern": "/challenge/" }
}
```

### 2.2 `generic/session-check`
- Bước `open` (idempotent): `ui.goto(session.url)`, chờ tải xong.
- Bước `classify` (idempotent): URL khớp `challengeUrlPattern` → `challenge`; khớp `loggedOutUrlPattern` → `logged_out`; còn lại → `logged_in`.
- Output: `{ state: 'logged_in' | 'logged_out' | 'challenge' | 'wrong_account' | 'unknown' }`. Flow **không** dùng `humanGate` và không lỗi khi phiên hỏng; trả trạng thái để Health service ghi sự kiện (SPEC-02 §5). `challenge` được ánh xạ thành `run.challenge`.

### 2.3 `generic/probe` **[SPIKE-P3]**
- Bước `open`: mở trang probe của Fury cho profile (địa chỉ lấy từ Fury hoặc cấu hình `settings.probe.url`).
- Bước `capture`: chờ probe chạy xong (tối đa 120 s); lấy capture bằng hàm đọc tĩnh (`page.evaluate` với hàm cố định đọc biến kết quả của trang) hoặc nút xuất của trang.
- Output: `{ raw: object }` → Runner chuyển cho `HealthService.importProbe(binding, raw, source='flow')`.
- `manifest.site` = địa chỉ trang probe.

### 2.4 `generic/read-page`
- Input: `{ url: string; fields: { name: string; locator: LocatorSpec }[] }` với `LocatorSpec = { role?: string; name?: string; text?: string; css?: string }`.
- URL phải thuộc `generic.sites` của nền tảng binding.
- Output: `{ values: Record<string, string | null> }`. Chỉ đọc; không click.

### 2.5 `generic/open-and-wait`
- Input: `{ url: string; message: string }`; mở URL rồi `humanGate` (`keepProfileOpen: true`, lựa chọn "Xong" / "Hủy").
- Không dùng cho đăng nhập: người vận hành đăng nhập bằng cách mở profile trực tiếp trong Fury (không CDP).

## 3. Pack `youtube`

### 3.1 `pack.json`

```json
{
  "id": "youtube", "version": "1.0.0", "platform": "youtube", "appApi": "^1.0.0",
  "furyVersions": ">=0.2.21 <0.4.0",
  "bindingConfigSchema": "./binding-config.schema.json",
  "forbiddenActions": ["./data/forbidden.json"],
  "flows": ["session-check", "upload"],
  "generic": { "sites": ["studio.youtube.com", "www.youtube.com", "accounts.google.com"], "session": { "url": "https://studio.youtube.com/", "loggedOutUrlPattern": "^https://accounts\\.google\\.com/", "challengeUrlPattern": "/challenge/" } }
}
```

### 3.2 Cấu hình binding (`binding-config.schema.json`)

```json
{ "type": "object", "required": ["studioLanguage"],
  "properties": {
    "studioLanguage": { "const": "en" },
    "channelHandle": { "type": "string" } } }
```

Ngôn ngữ giao diện Studio ghim **English** để selector ổn định; người vận hành đặt trong cài đặt tài khoản YouTube. Đây là điểm lệch chấp nhận với ngôn ngữ trình duyệt (luật C2, mức `info`).

### 3.3 Locator
Locator của mọi màn hình Studio để trong `packs/youtube/data/locators.en.json` (role + accessible name, text, hoặc CSS cho `input[type=file]`). Flow chỉ tham chiếu khóa (ví dụ `upload.titleBox`). Khi Studio đổi giao diện, sửa file này trước, chỉ sửa mã khi luồng màn hình đổi. Giá trị cụ thể chốt ở **[SPIKE-P4]**.

### 3.4 Thao tác cấm (`data/forbidden.json`)
Lựa chọn hiển thị "Public", "Unlisted", "Schedule"; ô "Set as instant Premiere"; nút "Publish". (Cộng danh sách toàn cục SPEC-03 §7.1.)

## 4. `youtube/session-check`

| Bước | Idempotent | Việc | Hậu kiểm |
|---|---|---|---|
| `open` | Có | `ui.goto('https://studio.youtube.com/')` | Trang tải xong hoặc chuyển hướng |
| `classify` | Có | URL challenge → `challenge`; URL đăng nhập Google → `logged_out`; Studio tải → đọc channel ID từ URL `/channel/UC…` | Có channel ID hoặc trạng thái xác định |
| `verify-channel` | Có | Channel ID ≠ `binding.accountId` → `wrong_account` | — |
| `read-language` | Có | Đọc `<html lang>` của Studio | — |

Output:

```ts
{ state: 'logged_in' | 'logged_out' | 'challenge' | 'wrong_account' | 'unknown';
  channelId?: string; studioLanguage?: string; studioLanguageOk: boolean }
```

`studioLanguageOk = false` → Health ghi sự kiện `warn` (không đỏ) và gợi ý đặt lại ngôn ngữ.

## 5. `youtube/upload`

### 5.1 Input

```ts
const UploadInput = z.object({
  video: z.object({ path: z.string(), sha256: z.string().length(64) }),
  thumbnail: z.object({ path: z.string(), sha256: z.string().length(64) }).optional(),
  captions: z.array(z.object({ path: z.string(), language: z.string() })).max(5).optional(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000),
  madeForKids: z.boolean(),
  tags: z.array(z.string()).optional(),               // tổng ≤ 500 ký tự
  playlistNames: z.array(z.string()).optional(),      // playlist phải có sẵn; không tạo mới
  videoLanguage: z.string().optional(),               // BCP-47
  alteredContent: z.boolean().optional(),             // câu hỏi "Altered content" trong Studio
});
```

Category, giấy phép, kiếm tiền: dùng mặc định của kênh (không có trong input).

### 5.2 Output

```ts
const UploadOutput = z.object({
  videoId: z.string(), studioUrl: z.string().url(),
  visibility: z.literal('private'),
  warnings: z.array(z.string()),                       // ví dụ "playlist 'X' không tồn tại, đã bỏ qua"
  l2Review: z.enum(['correct', 'fixed']).optional(),
});
```

### 5.3 Các bước

| # | Bước | Idempotent | Việc | Hậu kiểm |
|---|---|---|---|---|
| 1 | `open-studio` | Có | Mở Studio; chạy logic session-check (§4) | `logged_in` và đúng kênh; ngược lại xem §5.4 |
| 2 | `duplicate-check` | Có | Trang Content: tìm video có tiêu đề trùng tạo trong 7 ngày qua | Không có → tiếp; có → gate `duplicate_suspected` ("Vẫn upload" / "Hủy") ở cả L2 và L3 |
| 3 | `select-file` | **Không** (retry 0) | Mở hộp thoại upload, `ui.upload(fileInput, video.path)`; đặt `state.uploadStarted = true` | Hộp thoại Details xuất hiện; ô tiêu đề có giá trị mặc định |
| 4 | `read-video-id` | Có | Đọc "Video link" → `state.videoId` | Có `videoId` |
| 5 | `fill-details` | Có | Tiêu đề, mô tả, thumbnail, playlist, "Made for kids" | Đọc lại từng ô bằng giá trị đã điền |
| 6 | `fill-more` | Có | Mở "Show more": tags, ngôn ngữ video, "Altered content" | Đọc lại |
| 7 | `captions` | Có | Nếu có `captions`: thêm phụ đề ở bước Video elements | Phụ đề hiện trong danh sách |
| 8 | `visibility` | Có | Chọn "Private" | Lựa chọn Private được chọn; không có lịch hẹn |
| 9 | `wait-upload` | Có | Chờ tải lên 100% (tối đa 45 phút); không cần chờ xử lý xong | Thanh tiến độ báo hoàn tất tải lên |
| 10 | `final` (`final: true`) | **Không** | Bấm "Save" | Hộp thoại đóng hoặc thông báo đã lưu |
| 11 | `read-back` | Có | Mở trang sửa video `studio.youtube.com/video/<id>/edit` | Tiêu đề khớp; hiển thị là Private |

**Chế độ L2:** Runner chèn gate `review_before_final` trước bước 10 (SPEC-03 §4.3). Người kiểm tra trong cửa sổ, tự bấm "Save", rồi chọn "Đúng hết" hoặc "Phải sửa tay". Bước 10 không chạy; bước 11 chạy sau gate.

**Chế độ L3:** chạy cả 11 bước.

`manifest.timeoutMinutes = 90`. Kích thước file tối đa theo giới hạn của YouTube; Job service không giới hạn thêm.

### 5.4 Xử lý sự cố trong flow

| Tình huống | Hành động |
|---|---|
| Phiên hết hạn ở bước 1 | Ghi `SESSION_EXPIRED`; gate `session_expired` (`keepProfileOpen`, lựa chọn "Đã xử lý, đóng" / "Hủy"); kết thúc run `failed` (`SESSION_EXPIRED`). Health ghi sự kiện đỏ → binding về L0 và dừng (SPEC-02 R1); job không tự chạy lại |
| CAPTCHA/xác minh ở bất kỳ bước nào | Như trên với mã `CHALLENGE` |
| Sai kênh | Như trên với mã `WRONG_ACCOUNT` |
| Không tìm thấy phần tử mong đợi | `SITE_CHANGED`, lưu trace + ảnh |
| YouTube báo lỗi tải lên / từ chối file | `UPLOAD_REJECTED` kèm thông điệp của YouTube |
| YouTube báo đạt giới hạn upload của kênh | `YOUTUBE_UPLOAD_LIMIT` |
| Lỗi sau bước 3 (đã bắt đầu tải lên) | `state.videoId` nếu có được đưa vào `error_detail_json.videoId` để người kiểm tra bản nháp trong Studio |
| Ngắt tiến trình ở bước 3 hoặc 10 | Run `needs_user` (`INTERRUPTED`), thông điệp: "Kiểm tra trong Studio xem video đã được tạo/lưu chưa" (SPEC-03 §5.5) |

### 5.5 Mã lỗi riêng
`YOUTUBE_UPLOAD_LIMIT`, `YOUTUBE_PROCESSING_FAILED`.

## 6. Kiểm thử pack
- Mỗi flow có test với trang HTML giả lập màn hình (fixture tĩnh) để kiểm logic bước và hậu kiểm, chạy trong CI.
- Test thật trên kênh test: `youtube/session-check` hằng ngày; `youtube/upload` (L3) hằng tuần và khi nâng Fury, video riêng tư 10 giây, xóa tay định kỳ. Chi tiết SPEC-09.
