# Tasks: Kiểm tra độ nhất quán (004)

**Tests**: bắt buộc.

## Phase 1: Setup / Foundational
- [X] T001 `packages/contract/src/consistency.ts` (FR-001) + test `contract/test/consistency.test.ts` (NormalizedProbe trường bắt buộc, RULE_IDS = 21)
- [X] T002 Repository db: `probe-results`, `checklists`, `host-snapshots`, `consistency-rules`, `consistency-runs`, `asn-attestations` + test `db/test/consistency-repos.test.ts`
- [X] T003 `packages/host-info`: `parse.ts`, `capture.ts` (`TODO(SPIKE-P6)`), `index.ts`, test với fixture PowerShell

## Phase 2: US1 — probe + luật + engine
- [X] T004 [US1] `health/src/probe/converters.ts` (`TODO(SPIKE-P3)`), `normalize.ts` (`parseFuryCapture`), `diff.ts` (`probeDiff`, `ALLOWED_VERSION_CHANGE_PATHS`); fixture `test/probes/{base,timezone-off,webrtc-leak,voices-macos,hash-changed,upgraded-ok,upgraded-gpu-changed}.json`; test `probe.test.ts`
- [X] T005 [P] [US1] Bảng phụ `health/data/*.json` + `rules/data.ts` (loader có `version`)
- [X] T006 [US1] `rules/types.ts` + `layer-a.ts` (A1–A6), `layer-b.ts` (B1–B4), `layer-c.ts` (C1–C3), `layer-d.ts` (D1–D5), `layer-e.ts` (E1–E4), `rules/index.ts` (`ALL_RULES`, `DEFAULT_RULE_CONFIGS`)
- [X] T007 [US1] Test `rules.test.ts`: bảng kịch bản pass/fail/unknown/skipped cho 21 luật, hint có giá trị thực tế
- [X] T008 [US1] `consistency-engine.ts`: RuleContext, `run(scope, trigger)`, điểm, R4, `latest(bindingId)`, `crossMatrix()`; seeder `consistency_rules` + `settings.consistency`

## Phase 3: US2 — checklist
- [X] T009 [US2] `checklist.ts`: chuẩn hóa, HMAC, upsert/confirm/status/expiring; test `checklist.test.ts` (SC-003 grep)

## Phase 4: US3 + US4 — host, ASN, lịch, nối HealthService
- [X] T010 [US3] `host.ts` (chụp + lưu), `attestAsn` trong service
- [X] T011 [US4] `consistency-schedule.ts` (định kỳ, checklist 08:00, host 24 h) + test
- [X] T012 [US4] Mở rộng `health-service.ts`: phương thức §8 còn lại, trigger §6.6 (binding, proxy, version, promote, probe, checklist, asn), đăng ký evaluator với readiness; `createHealth` nhận `secrets`, `paths`, `hostInfo?`
- [X] T013 Test `consistency.test.ts`: US1 AC1–3, AC6–8, US3 AC2–3, US4 AC1–6, §10 (A2 fail → promote từ chối; E2 pass; C3 fail)

## Phase 5: Polish
- [X] T014 Nối bootstrap (secrets, paths, host-info), chạy `pnpm build && pnpm lint && pnpm test`, cập nhật `docs/progress.md` (004 ✅, TODO), quickstart Kết quả
