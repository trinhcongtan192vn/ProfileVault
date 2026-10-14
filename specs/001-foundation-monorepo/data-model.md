# Data model: 001

## CSDL

Toàn bộ bảng, cột, ràng buộc, chỉ mục theo **SPEC-00 §8** (nguồn sự thật, không chép lại). Thêm một bảng kỹ thuật:

| Bảng | Cột | Ghi chú |
|---|---|---|
| `pv_migrations` | `seq INTEGER PRIMARY KEY`, `name TEXT NOT NULL`, `applied_at TEXT NOT NULL` | Bộ áp migration (R2). `seq` = số đầu tên file |

Quy tắc kiểu Drizzle: cột thời gian `text()`; cột `*_json` `text()` với `$type<...>()` khi contract có schema; `INTEGER` boolean dùng `integer({ mode: 'boolean' })` cho `ok`, `passed`, `enabled`, `twofa_enabled`, `exclusive_login_confirmed`, `studio_language_set`, `launched_by_run`.

## Settings được seed ở 001

| key | value_json | Nguồn |
|---|---|---|
| `schema_version` | `{ "migration": <seq lớn nhất đã áp> }` | FR-005 |
| `runner` | `{ "humanize": { "actionDelayMs": [300, 1200], "typingDelayMs": [40, 140] }, "traceAlways": false }` | SPEC-03 §4.2, §5.7 (giá trị mặc định) |

`thresholds` (SPEC-02 §3.3) và `consistency_rules` (SPEC-02 §6.4) do feature 003/004 seed.

## Cấu hình (`config.json`)

Schema và mặc định theo SPEC-00 §5; Zod `ConfigSchema` trong `packages/contract/src/config.ts` với `.default()` từng khóa; kiểu `Config = z.infer<typeof ConfigSchema>`.

## Bí mật (`secrets.bin`)

```
{ "version": 1, "entries": { "fury.token": "<base64 DPAPI blob>", "hmac.key": "...", "llm.apiKey": "..." } }
```

Khóa hợp lệ: `SecretKey = 'fury.token' | 'hmac.key' | 'llm.apiKey'` (Zod enum trong contract). `hmac.key` = 32 byte ngẫu nhiên, lưu dạng base64.

## Khóa phiên bản (`service.lock`)

`{ "pid": number, "startedAt": ISO }`.

## Audit ở 001

`audit_events` với `actor_type = 'system'`, `action ∈ { 'system.first_run', 'system.started', 'system.stopped' }`, `detail_json` gồm phiên bản mã và `schema_version`.

## Sự kiện bus (SPEC-00 §10)

| Tên | Payload (Zod trong contract) |
|---|---|
| `health.event_recorded` | `{ event: HealthEventRecord }` |
| `binding.level_changed` | `{ bindingId, fromLevel, toLevel, kind, reason, changeId }` |
| `binding.pause_changed` | `{ bindingId, pauseId, reason, open: boolean }` |
| `run.status_changed` | `{ runId, jobId, bindingId, flowId, status, step?, errorCode? }` |
| `run.needs_user` | `{ runId, bindingId, gate: HumanGate }` (HumanGate ở 007; 001 dùng `z.object({ reason, message }).passthrough()`) |
| `fury.status_changed` | `{ reachable, version?, supported }` |

`HealthEventRecord` = hàng `health_events` (id, bindingId|null, type, severity, source, payload, occurredAt, recordedAt).
