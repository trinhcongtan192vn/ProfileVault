# Tasks: Gateway M0 (005)

**Tests**: bắt buộc.

## Phase 1: Setup / Foundational
- [X] T001 `packages/gateway/package.json` (fastify, @fastify/cookie, @fastify/static, @fastify/multipart, argon2, workspace deps), `tsconfig.json`, `vitest.config.ts`
- [X] T002 `packages/contract/src/internal-api.ts` (FR-001) + test
- [X] T003 `packages/db/src/repositories/clients.ts` (insert, list, get, byPrefix, revoke, touch) + test

## Phase 2: US1 — bảo mật + phiên
- [X] T004 [US1] `src/security.ts`: `assertLoopback(host)`, `hostOriginHook(port)`, `mapErrorToHttp`, `errorHandler`
- [X] T005 [US1] `src/session.ts`: `OpenCodeStore`, `SessionStore`, `registerAuth(app)` (cookie, `/auth/open`, preHandler `/internal`, CSRF), `createOpenUrl`
- [X] T006 [US1] `src/gateway.ts`: `createGateway(deps)` lắp plugin + hook + route + static/SPA fallback + `listen()` kiểm loopback
- [X] T007 [US1] Test `test/security-session.test.ts`: AC1–AC7 (Host evil, Origin, mã dùng lại/hết hạn, cookie hết hạn/gia hạn, CSRF, body 1 MB, listen 0.0.0.0 từ chối, listen 127.0.0.1 thật)

## Phase 3: US2 — route /internal
- [X] T008 [US2] `src/deps.ts` (`GatewayDeps`, `RunnerFacade`, `NoRunner`), `src/validate.ts`
- [X] T009 [P] [US2] Route `session`, `fury`, `bindings` (+readiness, promote, pause, pauses/:id/clear), `events`
- [X] T010 [P] [US2] Route `probes` (multipart + JSON), `checklist`, `consistency`, `detect-suite`, `asn-attestations`
- [X] T011 [P] [US2] Route `settings` (thresholds, rules, runner), `clients` (`src/clients.ts` argon2), `jobs`/`runs`/`schedules`, `system`
- [X] T012 [P] [US2] `src/charts.ts` 7 biểu đồ + route; `src/csv.ts` 5 dataset + route
- [X] T013 [US2] Test `test/routes-health.test.ts`, `test/routes-settings-clients.test.ts`, `test/routes-jobs-system.test.ts`, `test/charts-export.test.ts`

## Phase 4: US3 — SSE + audit
- [X] T014 [US3] `src/sse.ts` + hook audit trong `gateway.ts`; test `test/sse-audit.test.ts`

## Phase 5: Polish
- [X] T015 Nối `apps/service/src/bootstrap.ts` (gateway listen/close, `createOpenUrl` trong context); test bootstrap
- [X] T016 `pnpm build && pnpm lint && pnpm test`; cập nhật `docs/progress.md`, `docs/decisions.md` (nếu có), quickstart Kết quả
