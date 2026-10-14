# Data model: 003

Bảng theo SPEC-00 §8 (đã tạo ở 001): `bindings`, `binding_pauses`, `level_changes`, `health_events`, `proxy_checks`, `detect_suite_results`.

## Settings
| key | value | Ghi chú |
|---|---|---|
| `thresholds` | SPEC-02 §3.3 (`ThresholdsSchema`) | seeder 003; `setThresholds` ghi lịch sử |
| `fury.currentVersion` | `{ version: string \| null, at }` | ghi khi poller báo; dùng cho `detect_suite_pass`, R5 |

## Payload `health_events` (`payload_json`)
| type | payload |
|---|---|
| `manual.*` | `{ note? }` |
| `fury.profile_opened/closed` | `{ profileId }` |
| `fury.version_changed` | `{ from, to }` (binding NULL) |
| `proxy.country_changed/asn_changed` | `{ from, to, proxyCheckId }` |
| `proxy.check_failed` | `{ error?, missedStreak?, proxyCheckId? }` |
| `session_check.*` | `{ runId?, channelId?, studioLanguage?, studioLanguageOk?, error? }` |
| `detect_suite.recorded` | `{ furyVersion, passed, summary?, bindingId? }` |
| `run.done/failed/needs_user` | `{ runId, flowId, mode?, errorCode?, l2Review?, step? }` |
| `run.challenge`, `flow.site_changed` | `{ runId, flowId, step? }` |
| `level.promoted/demoted` | `{ from, to, reason, changeId }` |
| `binding.paused/resumed` | `{ pauseId, reason, detail? }` |

## `binding_pauses.detail_json`
`{ eventId?, proxyCheckId?, from?, to?, furyVersion?, ruleIds?, note?, peers?: string[] }`

## `level_changes.detail_json`
`{ eventId?, rule?: 'R1'|'R2'|'R3'|'R6', flowId?, conditions? }`

## Readiness (bộ nhớ)
`{ bindingId, level, nextLevel: 1|2|3|null, conditions: { condition, met, current: string|number|null, required: string|number|null, note? }[], progress: number|null, canPromote: boolean, openPauses: Pause[], evaluatedAt }`
