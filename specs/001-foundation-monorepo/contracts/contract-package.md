# Hợp đồng: `@sctech/profilevault-contract` (bề mặt xuất ở 001)

Mọi ký hiệu xuất từ `packages/contract/src/index.ts`. Package sau chỉ thêm, không đổi tên.

## Hằng
- `CONTRACT_VERSION = 'profilevault/v1'`
- `ID_PREFIXES`: `{ binding: 'ab', levelChange: 'lc', pause: 'bp', healthEvent: 'he', proxyCheck: 'px', probe: 'pr', consistencyRun: 'cc', job: 'jb', run: 'rn', schedule: 'sc', client: 'ca', audit: 'au' }`
- `ERROR_CODES`: bảng SPEC-00 §9 `{ code: { retry } }`
- `HEALTH_EVENT_TYPES`: bảng SPEC-00 §7.1
- `BUS_EVENTS`: tên → schema payload (SPEC-00 §10)
- `DEFAULT_CONFIG`: SPEC-00 §5

## Schema Zod (kèm kiểu suy ra cùng tên bỏ hậu tố `Schema`)
`PlatformSchema`, `AutomationLevelSchema`, `SeveritySchema`, `RuleStatusSchema`, `EventSeveritySchema`, `EventSourceSchema`, `JobStatusSchema`, `RunStatusSchema`, `PauseReasonSchema`, `HealthEventTypeSchema`, `ErrorCodeSchema`, `ApiErrorSchema`, `ConfigSchema`, `SecretKeySchema`, `IsoDateTimeSchema`, `BindingIdSchema`, `LevelChangeIdSchema`, `PauseIdSchema`, `HealthEventIdSchema`, `ProxyCheckIdSchema`, `ProbeIdSchema`, `ConsistencyRunIdSchema`, `JobIdSchema`, `RunIdSchema`, `ScheduleIdSchema`, `ClientIdSchema`, `AuditIdSchema`, `HealthEventRecordSchema`, các schema payload bus.

## Hàm/lớp
- `newId(prefixKey: keyof typeof ID_PREFIXES): string`
- `isIdOf(prefixKey, value): boolean`
- `eventMeta(type: HealthEventType): { source: EventSource; severity: EventSeverity | readonly EventSeverity[] }`
- `class PvError extends Error { code: ErrorCode; detail?: Record<string, unknown> }`
- `toApiError(err: unknown): ApiError` (lỗi lạ → `INTERNAL`)
- `isRetryable(code): boolean`
- `expandEnv(input: string, env: Record<string, string | undefined>): { value: string; missing: string[] }`
- `Clock`, `systemClock`, `class FakeClock`
