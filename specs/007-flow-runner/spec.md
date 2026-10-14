# Feature Specification: Flow Runner và lịch chạy (007)

**Ngày:** 2026-10-14 · **Trạng thái:** triển khai · **Nguồn:** SPEC-03 toàn bộ, SPEC-04 §2.1–2.2/§3/§4, SPEC-09 AT-M0-4/5/11/12/13.

## Phạm vi
Runner M0, flow contract, SafeUi, humanGate, checkpoint/recovery, pack loader và linter,
lịch chạy có chạy bù, generic/session-check và youtube/session-check. Nối service và gateway facade.
Không làm upload, Job service public, MCP hay generic/probe (M1). Không gọi Fury/YouTube thật.

## User stories và nghiệm thu
1. **US1 P1:** Binding ≥ L1 được kiểm phiên bằng profile do Runner mở; L0 không CDP,
   profile người đang dùng chuyển waiting_profile; hủy/dừng đóng đúng profile thuộc run.
2. **US2 P1:** Pack hợp lệ mới được chạy; tương tác qua SafeUi; nhãn công khai/domain ngoài
   danh sách bị chặn và audit; test fixture kiểm logged_in/out/challenge/wrong_account/ngôn ngữ.
3. **US3 P1:** Khởi động lại tiếp từ checkpoint idempotent; bước không idempotent cần người;
   gate timeout và L2 bỏ final, chỉ nhận lựa chọn từ user.
4. **US4 P1:** Lịch tạo khi lên L1, một lượt/binding/ngày, giờ ngẫu nhiên khác nhau;
   chạy bù ≤12 giờ sau delay 1–15 phút; tạm dừng toàn cục không bắt đầu run mới.

## Requirements
- FR-001 Contract Zod ở packages/contract: manifest, gate, step options, checkpoint, pack, enqueue.
- FR-002 Hàng đợi bền vững SQLite; một run hoạt động/profile; giới hạn CPU/RAM/config theo SPEC-03 §5.1–5.3.
- FR-003 CDP context có sẵn; tab riêng; cleanup kể cả connect lỗi; không đóng profile đang dùng tay.
- FR-004 Step retry có chính sách lỗi, timeout, log/artifact, checkpoint và recovery §4.1/§5.5.
- FR-005 Gate, L2 final skip, cancel và timeout theo §4.3/§5.6.
- FR-006 Linter 4 luật và kiểm tra runtime SafeUi theo §7; pack sai version/lint bị vô hiệu.
- FR-007 Scheduler target/tag/all, timezone, giờ ngẫu nhiên bền vững, chạy bù và default schedule §8.
- FR-008 Hai flow session-check theo SPEC-04, selector sau adapter TODO(SPIKE-P4), fixtures.
- FR-009 Nối gateway/service, kết quả Health, shutdown an toàn, retention artifact.
- FR-010 Unit/integration/fixture xanh, không test mạng thật.

## Clarifications (từ docs)
- L2 final không chạy; kết quả người đặt ctx.state.l2Result, l2Review ghi vào job.
- M0 enqueue nội bộ cho scheduler/test; public Job service thuộc M1.
- Lịch per-binding lưu settings riêng vì bảng schedules chỉ có next_run_at tổng hợp (G35).
- Recovery gate lưu kết quả theo thứ tự gọi; replay flow nhưng bỏ bước đã checkpoint, lấy lại
  kết quả bước đã lưu; checkpoint JSON schema chứa stepResults/gateResults (G36).
- Không có spike P4: dùng Playwright connector và fixture; adapter selectors đánh dấu TODO (G37).

## Success criteria
- SC-001 Test chứng minh L0 không launch, waiting_profile không chiếm phiên tay, cleanup lỗi/hủy.
- SC-002 Fixture Chromium chứng minh phân loại phiên và chặn Publish; pack raw click bị vô hiệu.
- SC-003 SQLite restart bảo toàn lịch/checkpoint; ba binding có ba giờ khác nhau và chạy bù đúng.

## Assumptions
Không phát hành/live nghiệm thu khi spike chưa đạt; UI desktop nghiệm thu thủ công riêng.
