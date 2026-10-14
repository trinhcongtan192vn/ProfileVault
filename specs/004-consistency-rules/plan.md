# Implementation Plan: Kiểm tra độ nhất quán (004)

**Branch**: `004-consistency-rules` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

## Summary

Hoàn thiện SPEC-02 §6 trong `packages/health`: chuẩn hóa probe (bộ chuyển đổi tiêm được, `TODO(SPIKE-P3)`), 21 luật A1–E4 với bảng phụ JSON, `ConsistencyEngine` (RuleContext, ghi runs/results, điểm, R4, trigger, định kỳ), checklist HMAC, attestAsn, `packages/host-info` (`TODO(SPIKE-P6)`), evaluator `consistency_clear`/`checklist_valid`, ma trận chéo. Mở rộng `HealthService` của 003.

## Technical Context

TypeScript 5.9 / Node 22 · deps: contract, core, db, fury-client, host-info (mới), zod · SQLite · Vitest với fixture probe JSON, FakeFury, FakeClock · Ràng buộc: không ghi tới Fury (IX), hint tiếng Việt (XI), ≤ 30 s / 10 binding.

## Constitution Check

| Nguyên tắc | Trạng thái |
|---|---|
| I docs/ | Luật/hint/ngưỡng từ SPEC-02 §6.4; giả định ghi progress.md | PASS |
| II Zod contract | `contract/src/consistency.ts` | PASS |
| IV bí mật | checklist chỉ HMAC; không log | PASS |
| VIII người | `confirmChecklist`, `attestAsn`, `setRule` nhận `'user'` | PASS |
| IX chỉ báo/chặn | engine không gọi ghi Fury | PASS |
| X test | 21 luật + integration | PASS |

## Project Structure

```text
packages/contract/src/consistency.ts
packages/db/src/repositories/{probe-results,checklists,host-snapshots,consistency-rules,consistency-runs,asn-attestations}.ts
packages/host-info/src/{index,capture,parse}.ts  test/
packages/health/data/{country-languages,gpu-tiers,os-signatures,timezone-countries,city-coords}.json
packages/health/src/probe/{converters,normalize,diff,import}.ts
packages/health/src/rules/{types,index,layer-a,layer-b,layer-c,layer-d,layer-e,data}.ts
packages/health/src/consistency-engine.ts   # RuleContext, run, score, R4, matrix
packages/health/src/checklist.ts            # HMAC, upsert/confirm/status/expiring
packages/health/src/host.ts                 # chụp + lưu host_snapshots
packages/health/src/consistency-schedule.ts # định kỳ 7 ngày 09–18, checklist 08:00, host 24h
packages/health/src/health-service.ts       # mở rộng: importProbe, upsertChecklist, confirmChecklist, attestAsn, runConsistency, getRules, setRule, getConsistency, getCrossMatrix, listChecklistExpiring, latestHost
packages/health/test/probes/*.json  test/rules.test.ts  probe.test.ts  consistency.test.ts  checklist.test.ts
```

## Thiết kế chính

- **RuleContext**: `{ binding, furyProfile?, exit?, probe?, previousProbe?, host?, checklist?, allBindings: BindingSnapshot[], attestations: Map<asn, type>, now }`; `BindingSnapshot = { binding, exit?, furyProfile?, checklist?, probe? }`. Engine xây một lần cho cả lần chạy (Fury `getProfile` song song, `Promise.allSettled`).
- **Luật**: `evaluate(ctx, params) → RuleOutcome | RuleOutcome[]`; helper `unknown(hint)`, `fail(actual, expected, hint)`, `pass(actual?)`. Cross rules trả outcome cho từng binding.
- **Severity thực tế**: từ `consistency_rules` (seed `defaultSeverity`); A5 `mobile` → `fail` với severity `warn` (override trong outcome `severityOverride`).
- **Điểm**: `passed / (total − skipped − info)`; `blockFailing`, `blockUnknown` theo severity thực tế `block`.
- **R4**: `failingBlock = results.filter(block && status fail && id ∉ {D1, E1})` → `policy.applyConsistencyBlock`.
- **Định kỳ**: `ConsistencySchedule` dùng `mulberry32` + `fromLocal` của 003: mỗi `periodicDays` ngày một lượt lúc giờ ngẫu nhiên 09–18; checklist 08:00; host 24 h; `tick()` mỗi 60 s qua `Timers`.
- **host-info**: `exec` tiêm được (mặc định `execFile('powershell', [...])`), parse JSON đầu ra, timeout 3 s.
