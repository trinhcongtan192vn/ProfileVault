# Quickstart: 004

```powershell
pnpm build
pnpm exec vitest run --project health --project host-info --project db --project contract
```

Kịch bản nghiệm thu SPEC-02 §10 có test tự động (`packages/health/test/consistency.test.ts`): múi giờ lệch exit → A2 fail kèm gợi ý, `consistency_block`, nút lên mức tắt; nhập probe hai lần cùng phiên bản → E2 pass; checklist thiếu → C3 fail; hai kênh cùng email khôi phục → D5 fail; ASN chưa phân loại → xác nhận → A5 pass; lịch định kỳ/08:00/24h với FakeClock.

## Kết quả (2026-10-14)

- `pnpm build && pnpm lint && pnpm test`: xanh; toàn workspace 32 file, 171 test (health 7 file / 56 test; host-info 3; db + contract thêm test nhất quán).
- Danh mục SPEC-02 §6.4 thực tế có **22** luật (A6, B4, C3, D5, E4); yêu cầu triển khai ghi "21 luật" là đếm thiếu — ghi `docs/progress.md`.
- `TODO(SPIKE-P3)` ở `packages/health/src/probe/converters.ts`; `TODO(SPIKE-P6)` ở `packages/host-info/src/{capture,parse}.ts`.
- Converge: FR-001…FR-013 có mã và test; hành vi "binding mới chưa có checklist → C3 fail → `consistency_block` ngay ở L0" đúng SPEC-02 §4.1 (L0 vẫn ghi lý do dừng) và PRD §12 (checklist thiếu → không rời L0).
