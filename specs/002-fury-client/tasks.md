# Tasks: FuryClient (002)

**Input**: `/specs/002-fury-client/` (spec, plan, research, data-model, contracts, quickstart)

**Tests**: bắt buộc (Constitution X).

## Phase 1: Setup

- [ ] T001 Tạo `packages/fury-client/package.json` (deps contract, core, semver; devDeps @types/semver; exports `.` và `./testing`), `tsconfig.json` (references contract, core), `vitest.config.ts`
- [ ] T002 [P] Ghi `docs/decisions.md` (semver) và `docs/progress.md` giả định G8–G12 (đã làm ở bước clarify — xác nhận)

## Phase 2: Foundational — kiểu Fury trong contract

- [ ] T003 `packages/contract/src/fury.ts`: `AsnTypeSchema`, `FuryHealthSchema`, `FuryProfileSummarySchema`, `FuryProfileDetailSchema`, `FuryProfileStatusSchema`, `FuryLaunchResultSchema`, `ExitInfoSchema`, `FuryCapabilityNameSchema` (8 tên), `FuryCapabilitySourceSchema`, `FuryCapabilitiesSchema`; xuất ở `src/index.ts`
- [ ] T004 [P] Test `packages/contract/test/fury.test.ts`: schema chấp nhận ví dụ SPEC-01 §3, từ chối `asnType` lạ, `capabilities` thiếu khóa

## Phase 3: US1 — HttpFuryClient (P1)

- [ ] T005 [US1] `src/client.ts`: interface `FuryClient`, `FURY_TIMEOUTS_MS`, `Timers`, `realTimers`, `FakeTimers`
- [ ] T006 [P] [US1] `src/version.ts`: `isSupportedVersion` (semver `coerce` + `satisfies`)
- [ ] T007 [P] [US1] `src/errors.ts`: `mapHttpError(status, body, cap)`, `mapNetworkError(err)`, `badResponse(cap, issues)` → `PvError` theo SPEC-01 §8 + research R1
- [ ] T008 [US1] `src/adapter/endpoint-map.ts`: `FuryCapability`, `EndpointSpec`, `FuryEndpointMap`, `DEFAULT_ENDPOINT_MAP` 7 route (research R1) với `parse` Zod lỏng → kiểu contract; bỏ thông tin proxy ngoài `proxyRef`; chú thích `TODO(SPIKE-P2)` mỗi mục, `TODO(SPIKE-P5)` ở `checkExit`
- [ ] T009 [P] [US1] `src/adapter/profile-config-file.ts`: `ProfileConfigFileSource`, `FsProfileConfigFileSource({ dataDir, locate?, parse? })` với `TODO(SPIKE-P2)`
- [ ] T010 [US1] `src/http-client.ts`: `HttpFuryClient` — `request()` với AbortController/timeout, thử lại (mạng/timeout/5xx, tối đa 2, backoff 1 s → 3 s qua `timers.sleep`), bearer token, kiểm URL (`${` còn lại → `url_invalid`), `health()` không ném, `launch()` gọi `getStatus` trước + kiểm phiên bản + không thử lại, `capabilities()` suy từ map + `profileConfigSource`, `getProfile` hợp nhất fallback; `fromSecretStore()`
- [ ] T011 [US1] `src/index.ts` xuất theo contracts
- [ ] T012 [P] [US1] Test `test/version.test.ts`, `test/adapter.test.ts` (parse đủ/thiếu trường, loại proxy credentials, `bad_response`)

## Phase 4: US3 — FakeFury (P2, cần trước test integration)

- [ ] T013 [US3] `src/testing/fake-fury.ts`: server `node:http` cài 7 route research R1; API kịch bản theo contracts; `launchHandler`/`stopHandler`; `requests()`; `failNext`; `latency`; `authRequired`; `capabilities`
- [ ] T014 [US3] `src/testing/index.ts`, `test/fake-fury.ts` tái xuất; `package.json` exports `./testing`
- [ ] T015 [P] [US3] Test `test/fake-fury.test.ts`: start/stop, kịch bản 401, failNext, requests ghi lại, launchHandler

## Phase 5: US1 integration

- [ ] T016 [US1] Test `test/http-client.test.ts` với FakeFury: AC1–AC9 (health online/offline/auth/version; getProfile đủ trường và 404; capability missing; retry 500×2 rồi 200 và 500×3; launch khi đang mở → PROFILE_BUSY không gọi launch; timeout với fetch treo và FakeTimers; `url_invalid`; stop idempotent; không có password trong kết quả)

## Phase 6: US2 — Poller (P2)

- [ ] T017 [US2] `src/poller.ts`: `FuryStatusPoller` theo contracts; `tickHealth` phát `fury.status_changed` khi đổi + `onVersionChanged`; `tickStatus` chỉ khi reachable, gọi `onProfileStatusChanged` khi đổi; `start/stop` với `timers.setInterval`
- [ ] T018 [US2] Test `test/poller.test.ts`: AC1–AC5 với FakeFury + FakeTimers + EventBus

## Phase 7: Polish

- [ ] T019 Chạy `pnpm build && pnpm lint && pnpm test` toàn workspace, sửa lỗi
- [ ] T020 [P] Cập nhật `docs/progress.md` (002 ✅, TODO(SPIKE-P2/P5) theo file), `specs/002-fury-client/quickstart.md` mục Kết quả

## Dependencies

Phase 1 → 2 → 3 (T005–T011) → 4 → 5 → 6 → 7. T012 song song với T013.
