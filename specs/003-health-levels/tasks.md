# Tasks: Health service phần 1 (003)

**Tests**: bắt buộc.

## Phase 1: Setup
- [X] T001 `packages/health/package.json` (deps contract, core, db, fury-client, zod), `tsconfig.json`, `vitest.config.ts`

## Phase 2: Foundational — contract + repository
- [X] T002 `packages/contract/src/health.ts`: `BindingSchema`, `CreateBindingInputSchema`, `UpdateBindingInputSchema`, `ConditionSchema` (12 kind), `ThresholdsSchema`, `DEFAULT_THRESHOLDS`, `ConditionResultSchema`, `ReadinessSchema`, `ManualEventInputSchema`, `DetectSuiteInputSchema`, `SessionCheckOutcomeSchema`, `RunOutcomeInputSchema`, `PauseSchema`, `LevelChangeSchema`, `ProxyCheckSchema`; xuất index
- [X] T003 [P] Test `packages/contract/test/health.test.ts`: DEFAULT_THRESHOLDS đúng §3.3 (7/7/9 điều kiện), ConditionSchema từ chối kind lạ, ManualEventInput lùi > 7 ngày (kiểm ở service, schema chỉ ISO)
- [X] T004 `packages/db/src/repositories/bindings.ts` (`insert`, `update`, `archive`, `get`, `getByProfile`, `getByAccount`, `list`, `setLevel`), `health-events.ts` (`append`, `list(filter)`, `countByType`, `latestByType`), `pauses.ts` (`open`, `clear`, `listOpen`, `get`), `level-changes.ts` (`append`, `list`), `proxy-checks.ts` (`insert`, `latestOk`, `latestOkPerBinding`, `list`), `detect-suite.ts` (`insert`, `hasPassed(version, bindingId?)`, `latestFailed`); xuất ở db index
- [X] T005 [P] Test `packages/db/test/health-repos.test.ts`

## Phase 3: US2 — LevelPolicy (R1–R7)
- [X] T006 [US2] `packages/health/src/level-policy.ts`: `LevelPolicy` với `demoteTo`, `demoteOne`, `openPause`, `clearPauseSystem`, `applyRedEvent`, `applyProxyChanged`, `applyDuplicateExitIp(groups)`, `applyConsistencyBlock(bindingId, failingRuleIds)`, `applyDetectSuite(version, passed, bindingId?)`, `applyFuryVersionChanged(to)`, `applySiteChanged(bindingId, flowId)`, `manualPause`, `userClearPause`; mỗi hàm chạy trong giao dịch, trả `pendingBus`
- [X] T007 [US2] Test `packages/health/test/level-policy.test.ts`: R1–R7, một pause mỗi lý do, archive bỏ qua, L0 giữ L0, tự gỡ R3/R5

## Phase 4: US3 — Readiness
- [X] T008 [US3] `packages/health/src/readiness.ts`: `ReadinessEvaluator` 10 kind + evaluator đăng ký + cache 5 phút + `onReadinessReached`
- [X] T009 [US3] Test `packages/health/test/readiness.test.ts`: AC2–AC5, AC8, AC9 với FakeClock

## Phase 5: US4 — Proxy check + scheduler
- [X] T010 [US4] `packages/health/src/proxy-check.ts`: `ProxyCheckService.check(bindingId)` (checkExit → proxy_checks → so sánh → sự kiện → R2 → duplicate exit IP → R3/tự gỡ)
- [X] T011 [P] [US4] `packages/health/src/local-time.ts` + `packages/health/src/scheduler.ts`: `planDay`, `tick`, `start/stop`, missed streak
- [X] T012 [US4] Test `packages/health/test/proxy-check.test.ts`, `test/scheduler.test.ts`

## Phase 6: US1 + lắp ráp HealthService
- [X] T013 [US1] `packages/health/src/health-service.ts`: `HealthServiceImpl` theo contracts; `createHealth()`; `seed.ts` seeder thresholds; `index.ts`
- [X] T014 [US1] Test `packages/health/test/health-service.test.ts`: US1 AC1–AC4, US2 AC1–AC2, AC5–AC10, US3 AC1, AC6–AC7, §10 kịch bản

## Phase 7: Polish
- [X] T015 Nối `apps/service/src/bootstrap.ts`: tạo `HttpFuryClient` (từ config + SecretStore), `FuryStatusPoller`, `createHealth`, đăng ký seeder thresholds, start poller + scheduler, dừng khi shutdown; test bootstrap vẫn xanh (FakeFury không cần — poller chịu offline)
- [X] T016 `pnpm build && pnpm lint && pnpm test`; cập nhật `docs/progress.md` (003 ✅, TODO bảng loại trừ `dist/`), `quickstart.md` Kết quả
