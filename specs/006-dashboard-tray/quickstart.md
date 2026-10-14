# Kiểm chứng feature 006

Ngày 2026-10-14: `pnpm build`, `pnpm lint`, `pnpm test` xanh (224 test trước bước 007).
Build tạo `apps/dashboard/dist/index.html`; test gồm SSR 9 đường dẫn, gateway overview/inbox/undo,
hoàn tác append-only + ngưỡng, tray menu/icon/xác nhận thoát, toàn bộ loại toast và dedupe.

```powershell
pnpm build
pnpm test
pnpm dev
```

Mở dashboard qua tray hoặc URL `/auth/open` in trên console. Không lưu/chia sẻ mã mở phiên.
Để thử offline dùng FakeFury và thư mục dữ liệu tạm như test `apps/service/test/gateway-wiring.test.ts`.

Nghiệm thu thủ công còn cần trên Windows desktop: menu/icon tray hiển thị thực tế, bấm toast mở đúng
trang, autostart qua khởi động lại Windows, wizard và các thao tác bằng chuột. Không tự chạy Fury thật.
Runner của trang Job/Lịch sẽ được nối ở 007; trước đó facade trả `FLOW_DISABLED` khi thao tác.
