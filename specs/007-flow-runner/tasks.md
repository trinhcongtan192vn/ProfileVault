# Tasks 007 — Runner, lịch, session-check

## Phase 1: Setup/contract
- [x] T001 Dependency và references workspace, Zod contract manifest/pack/step/gate/checkpoint/enqueue (FR-001)
- [x] T002 Store SQLite jobs/runs/run_steps, checkpoint JSON và test persistence (FR-002/004)

## Phase 2: SafeUi và pack
- [x] T003 SafeUi kiểm domain/accessible name/text, humanize, hậu kiểm, artifact (FR-006)
- [x] T004 ESLint 4 rules và test raw interaction/eval/network/forbidden (FR-006)
- [x] T005 Pack loader lint trước import, hash cache, kiểm appApi/Fury version, platform config (FR-006)
- [x] T006 Hai pack session-check, JSON config/locator/forbidden, HTML fixture (FR-008)

## Phase 3: Runner
- [x] T007 Queue/concurrency/preflight/waiting_profile/ownership/CDP cleanup (FR-002/003)
- [x] T008 Step retry/timeout/checkpoint/artifact và recovery idempotent/non-idempotent (FR-004)
- [x] T009 Human gate, L2 skip final, resolve user, cancel và timeout (FR-005)
- [x] T010 Health outcome, pause/demotion cancels queue, retention, shutdown (FR-009)

## Phase 4: Scheduler/wiring
- [x] T011 Lịch CRUD/target/tag/all/timezone, slots bền vững/idempotency/chạy bù/default L1 (FR-007)
- [x] T012 Bootstrap nạp pack/recover/start/stop, gateway facade dùng Runner thật (FR-009)

## Phase 5: Verify
- [x] T013 Integration SQLite/FakeFury/clock cho preflight, concurrency, gate, recovery, lịch (FR-010)
- [x] T014 Playwright fixture session-check và SafeUi forbidden/runtime, smoke dashboard (FR-010)
- [x] T015 Build/lint/unit/integration/flow tests, converge, progress/quickstart (FR-010)
