# Implementation Plan: Gateway M0 (005)

**Branch**: `005-gateway-internal` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

## Summary

`packages/gateway`: Fastify 5 trên loopback, hook bảo vệ (Host/Origin/body), phiên dashboard (`/auth/open`, cookie, CSRF), toàn bộ `/internal/*` SPEC-05 §7 nối Health/Fury/Runner facade, SSE, audit, charts + CSV, client token argon2id. Nối vào `apps/service`.

## Technical Context

TypeScript 5.9 / Node 22 · deps: fastify ^5.12, @fastify/cookie ^11, @fastify/static ^10, @fastify/multipart ^10, argon2 ^0.45 (prebuilt), contract/core/db/fury-client/health, zod · Testing: Vitest + `app.inject` (+ một `listen` thật cho loopback) · Constraints: Constitution V (loopback, Host, no CORS), VIII (người chỉ dashboard), IV (không log token).

## Constitution Check

| Nguyên tắc | Trạng thái |
|---|---|
| I docs/ | Route theo SPEC-05 §7; charts SPEC-07 §8 | PASS |
| II Zod contract | `contract/src/internal-api.ts` | PASS |
| IV bí mật | token Fury/client chỉ qua SecretStore/argon2; audit không chứa | PASS |
| V loopback | `listen` từ chối non-loopback; Host/Origin; không CORS | PASS |
| VIII người | promote/clearPause/confirm/attest/detect-suite/rules/clients chỉ `/internal` | PASS |
| X test | API test | PASS |

## Project Structure

```text
packages/contract/src/internal-api.ts
packages/gateway/
├── package.json  tsconfig.json  vitest.config.ts
├── src/index.ts  gateway.ts (createGateway)  deps.ts (GatewayDeps, RunnerFacade, NoRunner)
├── src/security.ts   (loopback check, host/origin hook, error mapping)
├── src/session.ts    (OpenCodeStore, SessionStore, cookie, csrf, auth hooks)
├── src/sse.ts
├── src/charts.ts  csv.ts
├── src/clients.ts    (token tạo/thu hồi, argon2)
├── src/routes/{fury,bindings,events,probes,checklist,consistency,settings,jobs,system,charts,export,clients,session}.ts
└── test/{security,session,routes-*.test.ts,sse,charts-export}.test.ts  helpers.ts
apps/service/src/bootstrap.ts  (+ gateway)
```

## Thiết kế chính

- **Lỗi**: `setErrorHandler`: `PvError` → HTTP §10 (`INPUT_INVALID` 400, `UNAUTHORIZED` 401, `FORBIDDEN_SCOPE`/`FORBIDDEN_ACTION` 403, `ACCOUNT_NOT_BOUND`/`FLOW_NOT_FOUND` 404, `BINDING_PAUSED`/`LEVEL_TOO_LOW`/`FLOW_DISABLED`/`DAILY_LIMIT_REACHED`/`FILE_*` 422, `RATE_LIMITED` 429, `FURY_OFFLINE`/`FURY_VERSION_UNSUPPORTED` 503, khác 500); Fastify `FST_ERR_CTP_BODY_TOO_LARGE` → 413 `INPUT_INVALID`; Zod → 400.
- **Validate**: helper `parse(schema, value)` ném `PvError('INPUT_INVALID', { issues })`.
- **Phiên**: Map trong bộ nhớ; `clock` tiêm; cookie `pv_session=<id>`; gia hạn mỗi request (`expiresAt = now + 12h`); CSRF so sánh `timingSafeEqual`.
- **Audit**: `onResponse` hook: method ∉ GET/HEAD/OPTIONS và route `/internal` → `http.write` (route pattern, status, params); 401/403 → `http.denied`.
- **SSE**: `reply.raw` ghi `event/data`; `bus.on` cho 6 sự kiện; heartbeat `timers.setInterval`; `request.raw.on('close')` hủy.
- **Charts**: `uploads_by_mode` (manual.upload + run.done theo mode), `success_rates` (session_check, run), `needs_user_by_reason` (payload.step/reason), `session_age` (ngày từ sự kiện đỏ phiên gần nhất, bậc thang theo ngày), `exit_timeline` (span theo country/asn/ip), `detect_suite_timeline` (span theo furyVersion passed), `consistency_score` (điểm theo lần kiểm).
- **RunnerFacade**: interface + `NoRunner` ném `FLOW_DISABLED` "Runner chưa sẵn sàng" (503 do §10 không liệt kê; ghi quyết định: `FLOW_DISABLED` 422 theo §10 → dùng 422).
