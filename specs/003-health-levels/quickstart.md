# Quickstart: 003

```powershell
pnpm build
pnpm exec vitest run --project health --project db --project contract
```

Kịch bản nghiệm thu SPEC-02 §10 có test tự động: khai báo CAPTCHA ở L1 → L0 + pause ≤ 1 giây; kiểm proxy đổi quốc gia → hạ một mức; hai binding cùng exit IP → cả hai L0, đổi proxy → tự gỡ; giả lập đủ điều kiện (evaluator giả cho §6) → `canPromote`, lên L1, `level_since` đặt lại.

## Kết quả (2026-10-14)

- `pnpm build && pnpm lint && pnpm test`: xanh; toàn workspace 26 file, 131 test (health 4 file / 27 test; db thêm `health-repos`; service thêm `wiring`).
- Converge: FR-001…FR-013 có mã và test. Ghi chú: `consistency_clear`/`checklist_valid` do 004 đăng ký evaluator; R4 do 004 gọi `applyConsistencyBlock`.
