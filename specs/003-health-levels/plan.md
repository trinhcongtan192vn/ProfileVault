# Implementation Plan: Health service phần 1 (003)

**Branch**: `003-health-levels` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: `specs/003-health-levels/spec.md`; nguồn sự thật SPEC-02 §1–5, §7–10.

## Summary

`packages/health` phần 1: repository cho 6 bảng, `HealthService` (binding, sự kiện, detect-suite, session-check, run outcome, readiness, promote, pause), `LevelPolicy` R1–R7 trong một giao dịch, `ProxyCheckService` + phát hiện trùng exit IP, `HealthScheduler` (4 lượt/ngày ngẫu nhiên, timer tiêm), seeder ngưỡng, nối poller 002. Schema Zod ở contract `health.ts`.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node 22 · **Dependencies**: contract, core, db, fury-client (giao diện + FakeFury cho test), zod · **Storage**: SQLite (bảng SPEC-00 §8 đã có) · **Testing**: Vitest; `openTestDatabase`, FakeFury, FakeClock, FakeTimers, RNG seed · **Constraints**: đổi mức/pause ≤ 1 phút (đồng bộ), không ghi tới Fury (Constitution IX), hành động người chỉ `actor: 'user'` (VIII) · **Scale**: ~10 binding, vài nghìn sự kiện/tháng

## Constitution Check

| Nguyên tắc | Áp dụng | Trạng thái |
|---|---|---|
| I | Bảng/luật R1–R7/ngưỡng lấy nguyên SPEC-02; giả định ghi progress.md | PASS |
| II | `contract/src/health.ts` | PASS |
| III | Chỉ gọi `FuryClient` (checkExit, getProfile) | PASS |
| VIII | `promote`, `clearPause`, `pause`, `setThresholds` nhận `actor: 'user'` literal | PASS |
| IX | Không gọi ghi tới Fury | PASS |
| X | unit + integration | PASS |

## Project Structure

```text
packages/contract/src/health.ts                      # schema Zod 003
packages/db/src/repositories/bindings.ts  health-events.ts  pauses.ts  level-changes.ts  proxy-checks.ts  detect-suite.ts
packages/health/
├── package.json  tsconfig.json  vitest.config.ts
├── src/index.ts
├── src/health-service.ts        # HealthService (003) + createHealth()
├── src/level-policy.ts          # R1–R7, hệ quả §4.2, tự gỡ
├── src/readiness.ts             # evaluateReadiness: 10 kind + evaluator tiêm + cache
├── src/proxy-check.ts           # ProxyCheckService + duplicate exit IP
├── src/scheduler.ts             # HealthScheduler (khung giờ, RNG seed, tick)
├── src/seed.ts                  # seeder thresholds
├── src/local-time.ts            # giờ địa phương theo timezone (Intl)
└── test/{readiness,level-policy,proxy-check,scheduler,health-service}.test.ts
```

## Thiết kế chính

- **Giao dịch**: `LevelPolicy.apply*` chạy trong `db.transaction`; thu thập `pendingBus: BusEvent[]`; `HealthService` phát sau commit (`flush`).
- **Sự kiện run**: `recordRunOutcome({ bindingId, runId, flowId, mode?, status: 'done'|'failed'|'needs_user', errorCode?, l2Review?, step? })` → `health_events` payload `{ runId, flowId, mode, errorCode, l2Review, step }`; thêm `run.challenge` khi `CHALLENGE`, `flow.site_changed` khi `SITE_CHANGED`.
- **R6**: hai `flow.site_changed` liên tiếp = hai sự kiện `flow.site_changed` gần nhất cho cùng `flowId` không có `run.done` cùng flow ở giữa, binding L3 → L2.
- **Phiên bản Fury hiện tại**: `settings.fury.currentVersion` do `recordFuryVersionChanged`/`createHealth` ghi từ `poller.lastHealth`; `detect_suite_pass` và R5 dùng giá trị này.
- **Readiness cache**: `Map<bindingId, { at, result }>`; `invalidate(bindingId)` khi ghi sự kiện/đổi mức/pause/ngưỡng.
- **Scheduler**: `planDay(bindingIds, localDate)` → `Map<bindingId, Date[]>` dùng `mulberry32(seed ^ hash(bindingId, date))`; `tick(now)` chạy các lượt `≤ now` chưa chạy; đổi ngày → plan lại; `missedStreak` theo binding.
- **Local time**: `Intl.DateTimeFormat(timezone, hourCycle h23)` lấy `{ y, m, d, H, M }`; tạo thời điểm địa phương → UTC bằng lặp hiệu chỉnh offset (đủ cho khung 4 giờ).
