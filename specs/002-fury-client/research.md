# Research: 002 FuryClient

## R1. Bộ ánh xạ endpoint giả định — TODO(SPIKE-P2)

- **Decision**: giả định REST JSON tại `config.fury.apiBaseUrl` với 7 route (bảng dưới). Mọi hàm `parse` chỉ đọc các trường có tên "hợp lý" và chấp nhận thiếu (`undefined`), trừ trường bắt buộc tối thiểu.
- **Rationale**: SPIKE-P2 chưa chạy; SPEC-01 §1/§4 yêu cầu chỉ `fury-client` đổi sau spike. Cấu trúc "map + parse" bảo đảm điều đó.
- **Alternatives**: đoán theo mã nguồn Fury (không có trong phiên này; cấm theo quy tắc triển khai).

| Năng lực | Giả định | Trường bắt buộc khi parse |
|---|---|---|
| health | `GET /api/status` → `{ version, ok? }` | `version: string` |
| listProfiles | `GET /api/profiles` → `[{ id, name, tags?, personaId?, os? }]` | `id`, `name` |
| getProfile | `GET /api/profiles/:id` → `{ id, name, tags?, persona?, seed?, timezone?, languages?, geolocation?, webrtc?, proxy?: { id } }` | `id`, `name` |
| getStatus | `GET /api/profiles/:id/status` → `{ open: boolean, via?, since? }` | `open` |
| launch | `POST /api/profiles/:id/launch` body `{ cdp: true }` → `{ cdpEndpoint, sessionRef? }` | `cdpEndpoint` |
| stop | `POST /api/profiles/:id/stop` → 200/204 | — |
| checkExit | `POST /api/profiles/:id/check-exit` → `{ ip, country, city?, timezone?, asn?, asnOrg?, asnType?, latencyMs? }` (TODO(SPIKE-P5)) | `ip` |

Lỗi HTTP: 404 profile → `INPUT_INVALID`; 401/403 → `FURY_OFFLINE` reason `auth`; 5xx → thử lại rồi `FURY_OFFLINE` reason `server`; 409 trên `launch` → `PROFILE_BUSY`.

## R2. semver

- **Decision**: `semver` ^7.8 (`satisfies(version, range, { includePrerelease: true })`), `coerce` khi Fury trả `v0.2.23` hoặc `0.2.23-win`.
- **Rationale**: SPEC-01 §6; ghi `docs/decisions.md`.

## R3. Timer/clock tiêm được

- **Decision**: `Timers { sleep(ms): Promise<void>; setInterval(fn, ms): () => void }`; mặc định dùng `setTimeout`/`setInterval` thật; test dùng `FakeTimers` (ghi lại các khoảng chờ, resolve ngay).
- **Rationale**: SPEC-09 §3.2; test backoff 1 s → 3 s không chờ thật.

## R4. Fallback đọc file cấu hình profile — TODO(SPIKE-P2)

- **Decision**: `ProfileConfigFileSource { read(profileId): Promise<Partial<FuryProfileDetail> | undefined> }`; bản mặc định `FsProfileConfigFileSource({ dataDir, locate?, parse? })` tìm `<dataDir>/profiles/<id>/profile.json` (đường dẫn và parse tiêm được), hợp nhất kết quả vào `getProfile` chỉ cho trường còn `undefined`.
- **Rationale**: SPEC-01 §4 "nếu không có: đọc file cấu hình profile trong `fury.dataDir` (chỉ đọc)".

## R5. FakeFury

- **Decision**: `node:http` thuần, không Fastify (giữ gói nhẹ; Fastify dành cho Gateway). Cổng 0 → hệ điều hành cấp; `baseUrl` trả về sau `start()`.
- **Rationale**: SPEC-09 §3.1.
