# Feature Specification: Health service phần 1 — binding, sự kiện, mức, ngưỡng, hạ mức (003)

**Feature Branch**: `003-health-levels`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Triển khai packages/health phần 1: binding, sự kiện, kiểm proxy theo lịch, ngưỡng, lên mức, hạ mức/dừng R1–R7, detect-suite, đồng hồ giả theo SPEC-02 §1–5, §7–10 (trừ §6). Tài liệu đó là nguồn sự thật; spec.md chỉ chốt phạm vi feature này, liệt kê yêu cầu PRD liên quan và trỏ tới mục của spec gốc, không chép lại toàn bộ."

**Spec gốc (nguồn sự thật)**: `docs/specs/SPEC-02-health-service.md` §1 mục đích, §2 mức, §3 ngưỡng (3.1–3.6), §4 hạ mức và dừng (R1–R7, hệ quả, thời gian phản ứng), §5 nguồn sự kiện, §7 lịch nội bộ (kiểm proxy, cache tiến độ), §8 giao diện `HealthService` (trừ các phương thức của §6: `importProbe`, `upsertChecklist`, `confirmChecklist`, `attestAsn`, `runConsistency`, `getRules/setRule`), §9 audit và thông báo, §10 nghiệm thu. SPEC-00 §7.1 loại sự kiện, §8 bảng, §10 bus. SPEC-01 §7 poller. PRD §4 (mức, ngưỡng, hạ mức), §7.3–7.4, F1–F8, §11 phản ứng ≤ 1 phút, §12 M0.

## Clarifications

### Session 2026-10-14

- Q: R3 (trùng exit IP) và R4 (luật `block` khác trượt) do §6 kích hoạt — 003 làm gì? → A: 003 cài **cơ chế** R1–R7 trong `LevelPolicy` (`applyRedEvent`, `applyProxyChanged`, `applyDuplicateExitIp`, `applyConsistencyBlock`, `applyDetectSuite`, `applySiteChanged`, `manualPause`, tự gỡ R3/R4/R5). Phát hiện trùng exit IP được làm ngay sau mỗi kiểm proxy (từ `proxy_checks` ok gần nhất của mọi binding) vì "lần kiểm kế tiếp" chính là kiểm proxy; luật D1 ở 004 chỉ báo cáo cùng dữ liệu. R4 do 004 gọi.
- Q: Điều kiện ngưỡng `consistency_clear` và `checklist_valid` cần dữ liệu §6 — 003 đánh giá thế nào? → A: `evaluateReadiness` nhận `ConditionEvaluator` tiêm được cho từng `kind`; 003 cài mọi kind trừ hai kind trên, hai kind đó mặc định trả `met: false, current: 'chưa có dữ liệu'` cho tới khi 004 đăng ký evaluator. Vì vậy ở 003 `canPromote` chỉ `true` khi test tiêm evaluator giả (nghiệm thu "giả lập đủ điều kiện").
- Q: Toast "đạt ngưỡng mức kế" (§9) phát ra bằng gì? → A: `HealthService` có `onReadinessReached(listener)` (DI, không qua bus vì SPEC-00 §10 không có sự kiện này); notifier 006 đăng ký và tự giới hạn 1 lần/ngày/binding.
- Q: Kiểm proxy "4 lần/ngày, giờ ngẫu nhiên trong 4 khung" chạy bằng gì? → A: `HealthScheduler` tính thời điểm kế tiếp cho từng binding bằng RNG có seed (tiêm được) theo giờ địa phương `config.ui.timezone`; vòng `tick()` chạy mỗi 60 s (timer tiêm được); Fury offline → bỏ lượt; 3 lượt lỡ liên tiếp → `proxy.check_failed`.
- Q: Session-check và run do Runner (007) phát — 003 nhận bằng gì? → A: `HealthService.recordSessionCheck(bindingId, outcome)` và `recordRunOutcome(...)` theo bảng §5; 007 gọi trực tiếp (cùng tiến trình) và cũng phát `run.status_changed` lên bus cho dashboard.
- Q: Lên mức "chỉ trên dashboard" được bảo đảm ở đâu? → A: `promote()` yêu cầu `actor: 'user'` (kiểu literal) và Gateway (005) chỉ nối nó vào `/internal/*`; MCP/API v1 (M1) không có đường gọi.

## Phạm vi

**Trong phạm vi:** repository `bindings`, `binding_pauses`, `level_changes`, `health_events`, `proxy_checks`, `detect_suite_results`; schema Zod liên quan trong contract (binding, điều kiện ngưỡng, readiness, sự kiện tay, detect-suite, kết quả run/session-check); `HealthService` (phần 003 của §8); `LevelPolicy` R1–R7 + hệ quả §4.2 (phát bus để Runner hủy run); `ProxyCheckService` (§5 dòng "Kiểm proxy", §7); `HealthScheduler` (§7 kiểm proxy, cache tiến độ 5 phút); nối poller 002 (`fury.profile_opened/closed`, `fury.version_changed` → R5); seeder ngưỡng mặc định §3.3; audit §9; test nghiệm thu §10 (trừ các dòng cần §6).

**Ngoài phạm vi:** §6 toàn bộ (004: probe, luật, checklist, host); Gateway endpoint (005); dashboard/toast (006); Runner thực thi hủy run (007 — 003 chỉ phát `binding.level_changed` / `binding.pause_changed`); lịch session-check (007, SPEC-03 §8.4).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Gắn kênh và quản lý binding (Priority: P1)

Người vận hành (qua Gateway sau này) tạo binding kênh ↔ profile Fury ở L0, sửa, lưu trữ; trùng profile hoặc trùng tài khoản bị từ chối.

**Why this priority**: F1; mọi thứ khác gắn với binding.

**Independent Test**: integration với SQLite tạm + FakeFury.

**Acceptance Scenarios**:

1. **Given** profile `p1` có trong FakeFury, **When** `createBinding({ platform:'youtube', accountId:'UC1', displayName, furyProfileId:'p1', marketCountry:'DE', packConfig:{studioLanguage:'en'}, allowedRoots:['E:\\\\v'] })`, **Then** binding `ab_…` với `level 0`, `levelSince = now`, `packConfig._personaAtBind` = `personaId` từ Fury (nếu có), audit `binding.create`, sự kiện không bắt buộc.
2. **Given** đã có binding `p1`, **When** tạo lại với `p1` hoặc với `youtube`+`UC1`, **Then** `INPUT_INVALID` (nêu trường trùng).
3. **Given** binding, **When** `updateBinding(id, { displayName, marketCountry, allowedRoots, packConfig })`, **Then** cập nhật `updated_at`, audit; `archiveBinding` đặt `archived_at`, binding không còn trong `listBindings()` mặc định.
4. **Given** `marketCountry: 'de'` (không phải ISO2 in hoa) hoặc `furyProfileId` không tồn tại trong Fury (khi Fury online), **Then** `INPUT_INVALID`; Fury offline → vẫn tạo được (ghi cảnh báo).

---

### User Story 2 - Sự kiện sức khỏe và hạ mức tự động (Priority: P1)

Mọi nguồn (khai báo tay, kiểm proxy, session-check, run, Fury, detect-suite) ghi `health_events`; sự kiện đỏ về tài khoản đưa binding về L0 và dừng; các quy tắc R1–R7 áp đúng bảng §4.1 trong cùng giao dịch ghi sự kiện.

**Why this priority**: F2, F6, F8; an toàn tài khoản là mục tiêu số một (PRD §2).

**Independent Test**: integration với FakeClock; kiểm trạng thái bảng và sự kiện bus sau mỗi thao tác.

**Acceptance Scenarios**:

1. **Given** binding L1, **When** `recordManualEvent(id, 'manual.captcha')`, **Then** trong cùng giao dịch: `health_events` (`severity red`, `source manual`), `level_changes` (`1→0`, `demote`, `reason 'red_event'`, `actor 'system'`), `bindings.level = 0`, `level_since = now`, `binding_pauses` mở với `reason 'red_event'`, sự kiện `level.demoted` và `binding.paused`, bus `binding.level_changed` + `binding.pause_changed`, audit. (≤ 1 phút: đồng bộ.)
2. **Given** `occurredAt` lùi 8 ngày, **Then** `INPUT_INVALID`; lùi 6 ngày → chấp nhận; `manual.note` kèm `note` lưu vào `payload.note`.
3. **Given** binding L2, **When** kiểm proxy trả quốc gia khác lần `ok` trước, **Then** `proxy.country_changed` (red), hạ **một mức** → L1, pause `proxy_changed`; binding L0 gặp cùng tình huống → giữ L0, vẫn mở pause.
4. **Given** hai binding A (L1), B (L2) có exit IP khác nhau, **When** kiểm proxy B trả IP trùng A, **Then** cả hai về L0, mỗi binding một pause `duplicate_exit_ip`; **When** lần kiểm sau của B trả IP khác, **Then** cả hai pause `duplicate_exit_ip` tự `cleared_by = 'system'`, sự kiện `binding.resumed`, mức giữ L0.
5. **Given** `recordDetectSuite({ furyVersion:'0.2.23', passed:false })` và Fury đang `0.2.23`, **Then** mọi binding chưa archive mở pause `detect_suite_failed`, giữ mức; `recordDetectSuite({ passed:true })` cùng phiên bản → tự gỡ. **Given** poller báo `fury.version_changed` sang `0.2.24` chưa có kết quả → mở `detect_suite_failed` cho mọi binding; sự kiện `fury.version_changed` (binding NULL).
6. **Given** binding L3, **When** `recordRunOutcome` với `SITE_CHANGED` hai lần liên tiếp cho cùng flow, **Then** L3 → L2, không pause; một lần rồi một run `done` xen giữa → không hạ.
7. **Given** `pause(id, 'user', note)` (R7), **Then** pause `manual` mở; `clearPause(pauseId, 'user')` gỡ; `clearPause` trên pause `detect_suite_failed`/`consistency_block`/`duplicate_exit_ip` → `FORBIDDEN_ACTION` (chỉ hệ thống gỡ).
8. **Given** `recordSessionCheck(id, { state:'logged_out' })`, **Then** `session_check.logged_out` red → R1; `{ state:'logged_in', studioLanguageOk:false }` → `session_check.ok` + sự kiện `warn` ghi chú ngôn ngữ; `{ state:'failed', error }` → `session_check.failed` warn không hạ; `{ state:'challenge' }` → `run.challenge` red → R1.
9. **Given** poller báo `onProfileStatusChanged('p1', true)`, **Then** `fury.profile_opened` info cho binding của `p1`; profile không có binding → bỏ qua.
10. **Given** `recordRunOutcome({ status:'done'|'failed'|'needs_user', errorCode? })`, **Then** `run.done/failed/needs_user`; `errorCode CHALLENGE` → thêm `run.challenge` (R1).

---

### User Story 3 - Ngưỡng, tiến độ và lên mức (Priority: P1)

Dashboard biết binding còn thiếu gì để lên mức; nút "Lên mức" chỉ khi mọi điều kiện đạt và không có pause mở; lên mức một bậc do người xác nhận.

**Why this priority**: F6, F8, PRD §4.

**Independent Test**: unit cho từng `kind` với FakeClock; integration promote.

**Acceptance Scenarios**:

1. **Given** lần chạy đầu, **Then** `settings.thresholds` = mặc định §3.3 (seeder 003), `getThresholds()` trả đúng; `setThresholds(t, 'user')` kiểm Zod, ghi `settings_history`, audit.
2. **Given** binding L0 tạo 14 ngày trước (FakeClock), 5 `manual.upload` trong cửa sổ, không sự kiện đỏ, proxy ổn định, detect-suite passed cho phiên bản hiện tại, và evaluator giả cho `consistency_clear`/`checklist_valid` trả đạt, **When** `evaluateReadiness`, **Then** `progress = 1`, `canPromote = true`, mỗi điều kiện có `{ condition, met, current, required }`.
3. **Given** chỉ 3 upload và 10 ngày, **Then** `days_at_level` `{ met:false, current:10, required:14 }`, `event_count` `{ met:false, current:3, required:5 }`, `progress = 5/7`.
4. **Given** sự kiện đỏ trước `level_since` (cửa sổ trước), **Then** không tính (`no_red_events` đạt).
5. **Given** L1 với 10 session-check (9 ok, 1 failed), **Then** `session_check_rate` `current 0.9`, `met false` (min 0.95, minSamples 10); 9 mẫu → `met false` vì thiếu mẫu, `current` nêu `9/10 mẫu`.
6. **Given** đủ điều kiện, **When** `promote(id, 'user')`, **Then** đánh giá lại ngay, `level 0→1`, `level_since = now`, `level_changes` `promote actor user`, sự kiện `level.promoted`, bus `binding.level_changed`, audit; có pause mở → `BINDING_PAUSED`; chưa đạt → `INPUT_INVALID` kèm điều kiện thiếu; L3 → `INPUT_INVALID` (không có mức kế), `evaluateReadiness` trả `progress null`.
7. **Given** readiness vừa chuyển sang `canPromote = true` sau một sự kiện, **Then** listener `onReadinessReached(bindingId, toLevel)` được gọi một lần cho tới khi điều kiện mất rồi đạt lại.
8. **Given** `evaluateReadiness` gọi lại trong 5 phút không có sự kiện mới cho binding, **Then** trả kết quả cache (không tính lại); có sự kiện mới → tính lại.
9. **Given** L2 với 20 run `youtube/upload` chế độ L2 `done` (`l2Review` 19 `correct` 1 `fixed`), **Then** `event_count_by_mode` đạt, `l2_correct_rate` `current 0.95` đạt; `no_open_site_changed` fail nếu có `flow.site_changed` chưa có run `done` sau đó.

---

### User Story 4 - Kiểm proxy theo lịch (Priority: P2)

Mỗi binding được kiểm exit proxy 4 lần/ngày, giờ ngẫu nhiên trong 4 khung, không mở trình duyệt; kết quả lưu và so với lần trước.

**Why this priority**: F3, PRD §7.4.

**Independent Test**: unit `HealthScheduler` với FakeClock + RNG seed; integration `ProxyCheckService` với FakeFury.

**Acceptance Scenarios**:

1. **Given** 3 binding và ngày mới, **Then** mỗi binding có 4 thời điểm, mỗi thời điểm nằm trong khung 06–10, 10–14, 14–18, 18–22 giờ `config.ui.timezone`; thời điểm khác nhau giữa binding (seed cố định → tái lập được).
2. **Given** tới giờ, **When** `tick()`, **Then** gọi `FuryClient.checkExit` đúng binding, ghi `proxy_checks` (`ok`, ip, country, city, timezone, asn, asnOrg, asnType, latencyMs, checkedAt), không sự kiện khi IP đổi cùng quốc gia + ASN.
3. **Given** Fury offline, **When** tới giờ, **Then** bỏ lượt (không ghi `proxy_checks`), đếm lượt lỡ; 3 lượt lỡ liên tiếp → `proxy.check_failed` (warn); online lại → reset đếm.
4. **Given** `checkExit` trả `ok:false` kèm `error`, **Then** ghi `proxy_checks` `ok=0`, `error`, sự kiện `proxy.check_failed` warn, không hạ mức.
5. **Given** `runProxyCheckNow(bindingId)` (dùng cho Gateway/dashboard), **Then** kiểm ngay ngoài lịch, cùng xử lý.

### Edge Cases

- Sự kiện đỏ cho binding đã archive → ghi sự kiện, không đổi mức, không pause.
- Hai sự kiện đỏ liên tiếp khi đang L0 và đã có pause `red_event` mở → ghi sự kiện, không mở pause thứ hai cùng lý do (một pause mở mỗi lý do mỗi binding).
- `recordDetectSuite` cho `bindingId` cụ thể: chỉ binding đó; toàn cục: mọi binding.
- `fury.version_changed` khi đã có `detect_suite_results passed` cho phiên bản mới (nhập trước) → không pause.
- Bus listener của Runner ném lỗi → Health không rollback (giao dịch CSDL đã commit trước khi phát bus).
- Khung giờ địa phương qua ngày DST: tính bằng `Intl` theo `config.ui.timezone`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Contract thêm `packages/contract/src/health.ts`: `BindingSchema`, `CreateBindingInputSchema`, `UpdateBindingInputSchema`, `ConditionSchema` (12 kind §3.2), `ThresholdsSchema` + `DEFAULT_THRESHOLDS` (§3.3), `ReadinessSchema` (`{ bindingId, level, nextLevel, conditions: ConditionResult[], progress: number|null, canPromote, openPauses, evaluatedAt }`), `ManualEventInputSchema` (type, occurredAt ≤ 7 ngày lùi, note), `DetectSuiteInputSchema`, `SessionCheckOutcomeSchema`, `RunOutcomeInputSchema`, `PauseSchema`, `LevelChangeSchema`, `ProxyCheckSchema`.
- **FR-002**: `packages/db/src/repositories/{bindings,health-events,pauses,level-changes,proxy-checks,detect-suite}.ts` — truy vấn có kiểu; `health_events`/`level_changes` chỉ thêm.
- **FR-003**: `HealthService` (packages/health) cài: `createBinding`, `updateBinding`, `archiveBinding`, `getBinding`, `listBindings({ includeArchived })`, `recordManualEvent`, `recordDetectSuite`, `recordSessionCheck`, `recordRunOutcome`, `recordFuryProfileStatus`, `recordFuryVersionChanged`, `evaluateReadiness`, `promote(id, 'user')`, `pause(id, 'user', note?)`, `clearPause(pauseId, 'user')`, `getThresholds`, `setThresholds(t, 'user')`, `listEvents(bindingId, filter)`, `listPauses(bindingId, { open })`, `onReadinessReached(listener)`, `registerConditionEvaluator(kind, fn)`.
- **FR-004**: `LevelPolicy` áp R1–R7 đúng bảng §4.1 và hệ quả §4.2: hạ mức (về L0 / một mức / L3→L2), mở pause theo lý do (một pause mở mỗi lý do), ghi `level_changes` + sự kiện `level.demoted`/`binding.paused` + audit + bus; tự gỡ R3/R4/R5 (`cleared_by 'system'`, sự kiện `binding.resumed`, bus `pause_changed open:false`); toàn bộ trong một giao dịch CSDL, bus phát sau commit.
- **FR-005**: Mọi lần đổi mức đặt lại `level_since`; sự kiện đếm/tỉ lệ chỉ tính `occurred_at ≥ level_since` (§3.1).
- **FR-006**: `evaluateReadiness` cài 10 kind: `days_at_level`, `event_count`, `no_red_events`, `session_check_rate`, `proxy_stable`, `detect_suite_pass`, `flow_success_rate`, `l2_correct_rate`, `event_count_by_mode`, `no_open_site_changed`; `consistency_clear`, `checklist_valid` qua evaluator đăng ký (mặc định chưa đạt); cache 5 phút theo binding, vô hiệu khi có sự kiện mới/đổi mức/đổi pause/đổi ngưỡng.
- **FR-007**: `promote` đánh giá lại tại chỗ; chỉ `actor: 'user'`; một bậc; `BINDING_PAUSED` nếu có pause mở; audit.
- **FR-008**: `ProxyCheckService.check(bindingId)`: gọi `FuryClient.checkExit`, ghi `proxy_checks`, so với lần `ok` gần nhất trước đó (quốc gia → `proxy.country_changed`, ASN → `proxy.asn_changed`, lỗi → `proxy.check_failed`), áp R2, rồi phát hiện trùng exit IP giữa các binding chưa archive (lần kiểm `ok` gần nhất mỗi binding) → R3 và tự gỡ.
- **FR-009**: `HealthScheduler`: 4 lượt/ngày/binding ngẫu nhiên trong 4 khung theo `config.ui.timezone`, RNG seed tiêm được; `tick()` mỗi 60 s; Fury offline → bỏ lượt, 3 lượt lỡ liên tiếp → `proxy.check_failed`; `start/stop`; lượt lỡ khi tiến trình tắt → tính lượt kế tiếp (không chạy bù).
- **FR-010**: Seeder `thresholds` đăng ký vào `SeederRegistry` (001) ghi `settings.thresholds` mặc định.
- **FR-011**: Audit (§9): tạo/sửa/archive binding, đổi mức, dừng/gỡ dừng, đổi ngưỡng, nhập detect-suite.
- **FR-012**: `createHealth({ database, bus, clock, fury, logger, config, audit, settings })` tạo mọi thành phần và nối poller callback (`onProfileStatusChanged`, `onVersionChanged`); không gọi API ghi nào tới Fury.
- **FR-013**: Test theo SPEC-09 §2 (unit điều kiện, lịch; integration CSDL thật + FakeFury + FakeClock) phủ US1–US4 và §10 trừ các dòng cần §6.

### Key Entities

- `bindings`, `binding_pauses`, `level_changes`, `health_events`, `proxy_checks`, `detect_suite_results` (SPEC-00 §8).
- `settings.thresholds` (SPEC-02 §3.3).
- Readiness (bộ nhớ, cache 5 phút).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Từ lúc ghi sự kiện đỏ tới khi mức và pause cập nhật trong CSDL: cùng giao dịch, ≤ 1 giây trong test (PRD §11: ≤ 1 phút).
- **SC-002**: `evaluateReadiness` cho 10 binding ≤ 200 ms với CSDL có 10 000 sự kiện (test hiệu năng nhẹ).
- **SC-003**: Mọi kịch bản §10 không cần §6 (dòng 1, 2, 3, 7) có test tự động xanh.
- **SC-004**: Không có đường gọi `promote`/`clearPause` nào nhận `actor` khác `'user'` (kiểm bằng kiểu + test).

## Assumptions

- Cửa sổ "ngày" cho `days_at_level` tính theo mili giây / 86 400 000, làm tròn xuống.
- `proxy_stable`: không có `proxy.country_changed`/`proxy.asn_changed` trong cửa sổ hiện tại.
- `detect_suite_pass`: có `detect_suite_results.passed = 1` cho phiên bản Fury hiện tại (toàn cục hoặc theo binding), phiên bản lấy từ `lastHealth` của poller (hoặc `settings.fury.lastVersion` do Health ghi khi poller báo); chưa biết phiên bản → không đạt.
- `flow_success_rate`/`l2_correct_rate`/`event_count_by_mode`/`no_open_site_changed` tính từ `health_events` do `recordRunOutcome` ghi với `payload { flowId, mode, l2Review, errorCode }` (không truy vấn bảng `runs` để Health không phụ thuộc Runner).
- Phát hiện trùng exit IP trong 003 (không chờ 004) vì nó gắn với chu kỳ kiểm proxy.
