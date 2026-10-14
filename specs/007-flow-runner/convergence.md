# Đối chiếu cuối 007 — 2026-10-14

Đã kiểm 10 FR, 4 user stories, 3 success criteria, các quyết định plan và 11 nguyên tắc constitution.
15 task có implementation và kiểm chứng tương ứng; không có thiếu sót code còn mở trong phạm vi M0 007.

- Queue/preflight/ownership/concurrency: test L0, profile mở tay, Fury version, CAPTCHA,
  reserve launching, CDP thật với Chromium qua FakeFury, connect lỗi và cleanup.
- Step/gate/recovery: retry idempotent, không retry bước không idempotent, timeout gate,
  timeout bước tạm ngưng trong gate, đóng/mở profile, L2 skip final, checkpoint/replay.
- Lịch: target binding/all/tag, giờ khác nhau, bền vững, chạy bù 3 giờ, bỏ quá 12 giờ,
  lịch mặc định L1, không tạo job trùng.
- Pack: 4 luật lint, lint trước import, schema config, appApi/Fury range, extensions,
  runtime chặn domain/accessible name/Public và file chưa xác minh.
- Flow fixture: logged_in/out/challenge/wrong_account/unknown; ngôn ngữ Studio đọc từ fixture.
- Wiring: service nạp Runner thật; gateway/dashboard dùng facade; shutdown và retention có timer.

Kết quả toàn repo: build/lint xanh, 255 Vitest + 7 Playwright xanh. Không extension hook
trong `.specify/extensions.yml` (file không tồn tại).

Giới hạn ngoài nghiệm thu code: chưa spike/live Fury/YouTube, chưa phát hành M0; desktop native
còn ghi ở task T015 của 006. Test giả lập không thay thế bằng chứng live.
