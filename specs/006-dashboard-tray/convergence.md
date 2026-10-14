# Đối chiếu cuối 006 — 2026-10-14

Code của FR-001–010 và 4 user stories đã có; 17/18 task đánh dấu hoàn thành.
Các phần hợp nhóm: ConfirmDialog/Toast trong `components/ui.tsx`, LevelBadge/Tabs trong
`components/bits.tsx`, ChecklistForm/ConsistencyTable/ProbePanel trong `components/Consistency.tsx`,
RunDetail trong `pages/Jobs.tsx`. Các chức năng tương đương plan dù dùng file nhóm.

Build tạo SPA; test SSR và Chromium kiểm các trang, wizard 2 binding, upload/undo/SSE/CAPTCHA,
CSV; test unit kiểm tray native backend giữ ID, icon/menu/xác nhận thoát, các toast và chống trùng.
Ba task convergence T016–018 đã hoàn thành.

**Còn T015 (nghiệm thu desktop):** khay hệ thống/toast thực tế, bấm thông báo và autostart qua
restart Windows. Phần build/lint/test và chạy dịch vụ với FakeFury trong Chromium đã đạt.
Không đánh dấu phần thủ công bằng kết quả test tự động. Không có extension hook.
