---
name: flow-author
description: Viết flow mới cho ProfileVault theo Flow contract (TypeScript + Playwright, chỉ thao tác qua ctx.ui, mỗi bước có hậu kiểm), kèm test trên trang HTML giả lập, chạy lint của pack tới khi sạch. Dùng khi người muốn tự động hóa thêm một việc trên nền tảng.
---

# flow-author

Tham khảo: `references/flow-contract.md` (tóm tắt SPEC-03) và mẫu `references/template.ts`.

## Các bước

1. **Làm rõ** mục tiêu, trang đích (domain), đầu vào/ra, mức tối thiểu:
   - Chỉ đọc → `minLevel: 1`, không `modes`.
   - Có ghi lên nền tảng → `minLevel: 2`, `modes: ['L2', 'L3']`, **bắt buộc đúng một bước `final: true`** (ở L2 Runner dừng trước bước này để người bấm).
2. **Viết `src/flows/<tên>.ts`** trong pack người dùng (`%APPDATA%\ProfileVault\extensions\flows\<pack>\`):
   - `defineFlow(manifest, InputSchema, OutputSchema, run)`; input/output bằng Zod.
   - Mọi thao tác qua `ctx.ui` (`goto`, `click`, `fill`, `check`, `select`, `press`, `upload`, `read`, `waitFor`, `exists`). **Cấm** `locator.click()`, `.fill()`, `page.keyboard`, `page.mouse`, `fetch`, `fs`, `child_process`, `page.evaluate` với chuỗi động (linter chặn, pack bị vô hiệu).
   - Locator theo role + accessible name, để trong `data/locators.en.json`, flow chỉ tham chiếu khóa.
   - Mỗi bước `ctx.step(name, fn, opts)` có **hậu kiểm** (`expect` của `ui.click`, đọc lại giá trị đã điền). Bước không lặp lại an toàn → `{ idempotent: false }`.
   - Sự cố phiên: `ctx.humanGate(...)` rồi `ctx.fail(code)`; không tự xử lý đăng nhập/CAPTCHA.
3. **Test** với trang HTML giả lập (`flows/<tên>/test/fixtures/*.html`) tái hiện role/name của màn hình thật, có biến thể: đăng xuất, sai kênh, phần tử đổi tên (SITE_CHANGED), nút cấm (FORBIDDEN_ACTION).
4. **Lint** pack (`pnpm lint` hoặc nạp lại pack trên dashboard Hệ thống) — sửa tới khi sạch.
5. **Chạy thử** trên kênh test qua dashboard (Job & run → Gửi job) ở mức thấp nhất đủ dùng.

## Từ chối

Không bao giờ viết bước đặt nội dung **công khai** hoặc hẹn giờ công khai, tương tác giả (like, comment, subscribe, view), vượt CAPTCHA/xác minh, đổi mật khẩu/khôi phục tài khoản. Từ chối và giải thích nếu được yêu cầu.
