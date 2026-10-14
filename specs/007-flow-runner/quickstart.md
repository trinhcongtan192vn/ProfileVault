# Kiểm chứng 007

```powershell
pnpm install
pnpm exec playwright install chromium
pnpm build
pnpm lint
pnpm test
pnpm dev
```

`pnpm test` gồm Vitest unit/integration và Playwright fixture; tất cả chỉ dùng FakeFury,
SQLite tạm, Chromium thường và HTML fixture. Một test FakeFury khởi Chromium có CDP thật
để kiểm vòng đời connect/context/tab/stop; không gọi Fury hoặc YouTube thật.

Service nạp generic/youtube và pack đã build trong `extensions/flows/<pack>/`.
Pack có `pack.json`, `dist/index.js` xuất mảng `flows`; mã được lint trước import.
Lỗi lint/version hiện trên Hệ thống. Binding YouTube cần `studioLanguage: "en"`.

Runner nhận enqueue nội bộ, scheduler tạo job client `scheduler`; chưa có public Job API (M1).
Khi binding lên L1, lịch session-check mặc định được tạo; cấu hình/CRUD ở trang Lịch.
Tạm dừng toàn cục chỉ giữ job mới trong queue, các run hiện tại chạy hết. Thoát dịch vụ
hủy run an toàn sau bước hiện tại và đợi đóng profile trước khi đóng CSDL.

Khôi phục dùng checkpoint phiên bản 1 trong SQLite; bước idempotent chạy lại từ checkpoint,
bước không idempotent mở gate INTERRUPTED. Người xử lý gate từ dashboard.

Live còn chờ P2/P3/P4/P5/P6. Theo dõi `docs/specs/SPIKE-bao-cao.md`; không bỏ TODO dựa vào fixture.
