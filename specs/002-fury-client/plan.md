# Implementation Plan: FuryClient (002)

**Branch**: `002-fury-client` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-fury-client/spec.md`; nguồn sự thật `docs/specs/SPEC-01-fury-client.md`, SPEC-09 §3.1.

## Summary

Gói `@sctech/profilevault-fury-client`: giao diện `FuryClient` (SPEC-01 §3), `HttpFuryClient` dùng `fetch` + bộ ánh xạ endpoint tách riêng (`TODO(SPIKE-P2)`), kiểm phiên bản semver, timeout/thử lại/mã lỗi theo §5, §8; `FuryStatusPoller` (§7); `FakeFury` HTTP server giả (SPEC-09 §3.1) xuất qua subpath `/testing`. Kiểu Fury đặt ở contract (`src/fury.ts`).

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22 (`fetch`, `AbortController`, `node:http` cho FakeFury)

**Primary Dependencies**: `@sctech/profilevault-contract`, `@sctech/profilevault-core` (SecretStore, EventBus, Logger), `semver` ^7.8 (+ `@types/semver`), zod

**Storage**: không (poller không ghi CSDL; 003 ghi)

**Testing**: Vitest; FakeFury trên `127.0.0.1:0`; timer/clock giả tiêm qua DI

**Target Platform**: Windows (chạy được trên Linux cho test)

**Project Type**: thư viện trong monorepo

**Performance Goals**: toàn bộ test ≤ 10 s

**Constraints**: không nhúng mã Fury, không giữ bí mật profile, không log token (Constitution III, IV)

**Scale/Scope**: ~10 profile, poll 60 s / 5 phút

## Constitution Check

| Nguyên tắc | Áp dụng | Trạng thái |
|---|---|---|
| I. docs/ nguồn sự thật | Giao diện §3 giữ nguyên; endpoint giả định đánh dấu TODO(SPIKE-P2/P5) | PASS |
| II. Zod ở contract | `contract/src/fury.ts` | PASS |
| III. Fury qua FuryClient, không nhúng | Chỉ HTTP tới tiến trình Fury | PASS |
| IV. Không bí mật profile, không log | Bộ chuyển đổi bỏ proxy credentials; logger redact token | PASS |
| X. Test | unit + integration với FakeFury | PASS |
| XI. Ngôn ngữ | VI docs / EN identifier | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/002-fury-client/
├── plan.md  research.md  data-model.md  quickstart.md  tasks.md
└── contracts/fury-client-api.md
```

### Source Code

```text
packages/contract/src/fury.ts                 # Zod kiểu Fury (SPEC-01 §3)
packages/fury-client/
├── package.json  tsconfig.json  vitest.config.ts
├── src/index.ts
├── src/client.ts                             # interface FuryClient + hằng timeout
├── src/errors.ts                             # map lỗi HTTP/mạng → PvError (§8)
├── src/version.ts                            # isSupportedVersion(version, range)
├── src/adapter/endpoint-map.ts               # TODO(SPIKE-P2/P5): method, path, parse
├── src/adapter/profile-config-file.ts        # TODO(SPIKE-P2): fallback đọc file profile trong fury.dataDir
├── src/http-client.ts                        # HttpFuryClient
├── src/poller.ts                             # FuryStatusPoller
├── src/testing/fake-fury.ts                  # FakeFury (SPEC-09 §3.1)
├── src/testing/index.ts
├── test/fake-fury.ts                         # tái xuất
└── test/{version,adapter,http-client,poller,fake-fury}.test.ts
```

**Structure Decision**: đúng SPEC-00 §4 (`packages/fury-client`); thêm subpath export `./testing`.

## Thiết kế chính

- **EndpointMap** (`endpoint-map.ts`): `Record<Capability, EndpointSpec | { source: 'missing' }>` với `Capability = 'health'|'listProfiles'|'getProfile'|'getStatus'|'launch'|'stop'|'checkExit'`; `EndpointSpec = { source: 'native'|'fallback', method, path: (p) => string, body?: (p) => unknown, parse: (raw: unknown) => T }`. Giả định (G8): `GET /api/status`, `GET /api/profiles`, `GET /api/profiles/:id`, `GET /api/profiles/:id/status`, `POST /api/profiles/:id/launch {cdp:true}`, `POST /api/profiles/:id/stop`, `POST /api/profiles/:id/check-exit`. `parse` dùng Zod lỏng (`passthrough`) rồi chiếu sang kiểu contract; thiếu trường bắt buộc → `PvError('FURY_OFFLINE', reason 'bad_response')`.
- **capabilities()**: 8 khóa SPEC-01 §3: `listProfiles, getStatus, launchCdp, stop, profileConfig, seed, checkExit, asnType`. `profileConfig` = `native` nếu endpoint có, `fallback` nếu `fury.dataDir` cấu hình, ngược lại `missing`; `seed` = `missing` mặc định (`TODO(SPIKE-P2)`); `asnType` = `fallback` (Fury trả → dùng; không → `unknown` + attestation, `TODO(SPIKE-P5)`).
- **HttpFuryClient**: `constructor({ baseUrl, supportedVersions, getToken, fetch?, timers?, clock?, logger?, endpoints?, profileConfigSource? })`; `request(cap, params, { timeoutMs, retry })` dùng `AbortController`; thử lại khi `TypeError` (mạng), `AbortError` (timeout) hoặc 5xx; backoff `[1000, 3000]` qua `timers.sleep(ms)`.
- **Poller**: giữ `lastHealth`, `lastOpen`; `tickHealth()` so sánh `(reachable, version, supported)`; `tickStatus()` chỉ chạy nếu `lastHealth.reachable`; `start()` dùng `timers.setInterval` tiêm được.
- **FakeFury**: `node:http` server; state `{ version, authRequired, token, profiles: Map, open: Map, exits: Map, latencyMs, failQueue, capabilities }`; `requests: { method, path, body }[]`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Dependency `semver` ngoài SPEC-00 §3 | `supportedVersions` là semver range | Parser tự viết dễ sai với tilde/caret/pre-release |
