# Feature Specification: Health service phần 2 — kiểm tra độ nhất quán (004)

**Feature Branch**: `004-consistency-rules`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Triển khai packages/health phần 2: kiểm tra độ nhất quán — chuẩn hóa probe (TODO(SPIKE-P3) cho bộ chuyển đổi, test bằng probe giả), 21 luật, checklist HMAC, packages/host-info (TODO(SPIKE-P6) nếu cần) theo SPEC-02 §6. Tài liệu đó là nguồn sự thật; spec.md chỉ chốt phạm vi feature này, liệt kê yêu cầu PRD liên quan và trỏ tới mục của spec gốc, không chép lại toàn bộ."

**Spec gốc (nguồn sự thật)**: `docs/specs/SPEC-02-health-service.md` §6 (6.1 mô hình luật, 6.2 dữ liệu đầu vào, 6.3 `NormalizedProbe` [SPIKE-P3], 6.4 danh mục 21 luật, 6.5 ý nghĩa kết quả, 6.6 khi nào chạy, 6.7 gợi ý sửa, 6.8 checklist), §7 (kiểm nhất quán định kỳ, chụp `host_snapshots`, hết hạn checklist), §8 các phương thức `importProbe`, `upsertChecklist`, `confirmChecklist`, `attestAsn`, `runConsistency`, `getRules/setRule`, §9 audit, §10 nghiệm thu (A2 fail, E2 pass, C3 fail). SPEC-00 §8 bảng `probe_results`, `account_checklists`, `host_snapshots`, `consistency_rules`, `consistency_runs`, `consistency_results`, `asn_attestations`. SPEC-01 §3 `FuryProfileDetail`. SPIKE-P3, P5, P6. PRD §5 (5 lớp luật), §7.5, F13–F16, §11 (≤ 30 s cho 10 binding; không tự sửa).

## Clarifications

### Session 2026-10-14

- Q: Định dạng file probe thật chưa có (SPIKE-P3) — chuẩn hóa thế nào? → A: `parseFuryCapture(raw, converters)` thử lần lượt các **bộ chuyển đổi** đăng ký: (1) `normalizedProbeConverter` nhận file đã đúng dạng `NormalizedProbe`; (2) `furyCaptureV1Converter` giả định dạng xuất của trang probe Fury (`TODO(SPIKE-P3)`, ánh xạ tên trường "hợp lý"). Không bộ nào khớp hoặc thiếu trường bắt buộc → từ chối kèm danh sách trường thiếu. Test dùng probe giả dạng chuẩn hóa (`packages/health/test/probes/*.json`).
- Q: Thông tin máy chạy (host) lấy thế nào khi chưa có SPIKE-P6? → A: `packages/host-info` cài `captureHostSnapshot()` dùng `os` + PowerShell CIM (`Win32_VideoController`, `System.Windows.Forms.Screen`) với timeout 3 s (`TODO(SPIKE-P6)`); lỗi/không phải Windows → `gpus: []`, `displays: []` và các luật B2/B3 trả `unknown`. Hàm parse đầu ra PowerShell test bằng fixture.
- Q: A4 cần tọa độ thành phố exit nhưng `ExitInfo` không có lat/lon? → A: `geolocation.mode = 'off'` hoặc `'auto'` → pass; `'manual'` → cần tọa độ exit: nếu bảng `city-coords.json` có (thành phố, quốc gia) thì tính khoảng cách, không có → `unknown` kèm gợi ý "Tắt geolocation hoặc đặt theo vị trí exit". Bảng nhỏ (các thành phố exit phổ biến), cập nhật được.
- Q: A2 cần "cùng quốc gia với exit.timezone" — nguồn múi giờ → quốc gia? → A: bảng `timezone-countries.json` (IANA → ISO2, ~các zone phổ biến + toàn bộ zone của các nước thị trường chính); không có trong bảng → so UTC offset bằng `Intl` và trả `unknown` nếu không xác định được quốc gia.
- Q: A6 — WebRTC candidate IP nội bộ (192.168.x, 10.x, mDNS `.local`) có coi là rò không? → A: Không; chỉ IP công cộng khác `exit.ip` mới là rò (ghi giả định).
- Q: D1 và E1 vừa là luật vừa là R3/R2 (003 đã áp khi kiểm proxy) — 004 làm gì? → A: D1/E1 chỉ **báo cáo** trạng thái từ cùng dữ liệu `proxy_checks`; R4 `applyConsistencyBlock` loại trừ D1, E1 đúng SPEC-02 §4.1.
- Q: "Có lịch sử thay đổi" luật lưu ở đâu? → A: `consistency_rules` giữ trạng thái hiện tại; mỗi `setRule` ghi một dòng `settings_history` với `key = 'consistency_rule:<id>'` (old/new JSON, actor) để dùng chung cơ chế lịch sử của `settings`.
- Q: Kiểm nhất quán cần `furyProfile` nhưng Fury offline? → A: `furyProfile` = `undefined` → luật cần nó trả `unknown` với gợi ý "Fury offline"; lần kiểm vẫn ghi; không chặn.

## Phạm vi

**Trong phạm vi:** contract `NormalizedProbeSchema`, `RuleOutcome`, `ConsistencyRunSummary`, `ChecklistInput/Status`, `HostSnapshot`, `RuleConfig`; repository 7 bảng; `packages/health/src/probe/` (chuẩn hóa, lưu file gốc `probes/<probeId>.json`, so sánh hai probe); `packages/health/src/rules/` (21 luật A1–E4 + bảng phụ `packages/health/data/*.json` có `version`); `ConsistencyEngine` (RuleContext §6.2, chạy theo phạm vi, ghi `consistency_runs/results`, điểm, R4, trigger §6.6, định kỳ 7 ngày 09–18); checklist §6.8 (HMAC-SHA256 với `hmac.key`, chuẩn hóa email/E.164, xác nhận 90 ngày, hết hạn hằng ngày 08:00, danh sách sắp hết hạn 7 ngày); `attestAsn`; `getRules/setRule`; `packages/host-info` + chụp khi khởi động và mỗi 24 giờ; đăng ký evaluator `consistency_clear`/`checklist_valid` với 003; ma trận chéo (dữ liệu cho SPEC-07 §4.6); audit §9.

**Ngoài phạm vi:** endpoint Gateway (005), UI (006), flow `generic/probe` (M1), toast (006: dùng `listChecklistExpiring`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nhập probe và chạy 21 luật (Priority: P1)

Người vận hành nhập file probe; hệ thống chuẩn hóa, lưu, chạy kiểm tra nhất quán cho binding đó + luật chéo; dashboard (sau) hiện điểm, luật trượt với giá trị thực tế và gợi ý sửa tiếng Việt.

**Why this priority**: F13, F14, F16; PRD §5 — điều kiện rời L0.

**Independent Test**: unit từng luật với RuleContext giả; integration `importProbe` + `runConsistency` với FakeFury/CSDL tạm.

**Acceptance Scenarios**:

1. **Given** file probe chuẩn hóa hợp lệ, **When** `importProbe(bindingId, { filePath }, 'manual_import')`, **Then** `probe_results` có dòng (`fury_version`, `source`, `captured_at`, `data_json`, `raw_path`), file gốc được chép vào `probes/<probeId>.json`, sự kiện `probe.imported`, audit, và một `consistency_runs` với `trigger = 'probe_imported'` cho binding đó.
2. **Given** file thiếu `navigator.languages` và `timezone`, **Then** `INPUT_INVALID` với `detail.missing = ['navigator.languages', 'timezone']`, không ghi gì.
3. **Given** binding có exit `DE`, probe timezone `Asia/Bangkok`, **When** chạy, **Then** `A2.timezone_matches_exit` `fail` với `actual`, `expected`, `hint` chứa `Europe/Berlin`; `consistency_clear` không đạt; R4 mở pause `consistency_block` (nếu binding ≥ L0 — vẫn ghi ở L0).
4. **Given** hai probe cùng `furyVersion` với `hashes` giống nhau, **Then** `E2.noise_hash_stable` `pass`; hash khác → `fail` nêu trường; khác phiên bản → `skipped` và `E3.only_version_changed` đánh giá (chỉ phiên bản UA/brands đổi → `pass`; GPU đổi → `fail` nêu `webgl.renderer`).
5. **Given** mỗi luật trong 21 luật, **When** chạy với RuleContext giả theo kịch bản pass/fail/unknown/skipped (bảng test), **Then** trạng thái đúng và `hint` tiếng Việt có giá trị thực tế khi `fail`/`unknown`.
6. **Given** luật bị tắt (`enabled = 0`), **Then** `skipped`; severity do người chỉnh (`warn` thay `block`) được dùng khi tính R4/điểm.
7. **Given** 10 binding với dữ liệu đủ, **Then** `runConsistency({}, 'periodic')` ≤ 30 s (test hiệu năng với FakeFury độ trễ 0).
8. **Given** kết quả, **Then** điểm = `pass / (tổng − skipped − info)`, kèm số luật `block` đang `fail` hoặc `unknown`; `getConsistency(bindingId)` trả lần kiểm gần nhất; `getCrossMatrix()` trả cặp trùng exit IP (đỏ), dải mạng (vàng), ASN+persona (vàng), khôi phục (đỏ).

---

### User Story 2 - Checklist tài khoản (Priority: P1)

Người vận hành điền checklist; email/số khôi phục chỉ lưu dạng HMAC; xác nhận có hạn 90 ngày; thiếu hoặc hết hạn → C3 fail → không rời L0.

**Why this priority**: F15; PRD §5.3; điều kiện `checklist_valid`.

**Independent Test**: integration với `MemorySecretStore` (`hmac.key`).

**Acceptance Scenarios**:

1. **Given** `upsertChecklist(id, { accountRegion:'DE', channelCountry:'DE', accountLanguage:'de-DE', recoveryEmail:' A.B@Example.com ', recoveryPhone:'+49 151 234 5678', twofaEnabled:true, exclusiveLoginConfirmed:true, studioLanguageSet:true })`, **Then** `account_checklists` có `recovery_email_hmac = HMAC(key, 'a.b@example.com')`, `recovery_phone_hmac = HMAC(key, '+491512345678')`, không có giá trị gốc; `getChecklist` không trả giá trị gốc (chỉ `hasRecoveryEmail: true`).
2. **Given** checklist đủ, **When** `confirmChecklist(id)`, **Then** `confirmed_at = now`, `expires_at = now + 90 ngày`, audit; `checklist_valid` đạt; thiếu `twofaEnabled` → `confirmChecklist` từ chối `INPUT_INVALID` và C3 `fail` với gợi ý "Điền/xác nhận lại checklist".
3. **Given** `expires_at` qua (FakeClock +91 ngày), **Then** C3 `fail`, `checklist_valid` không đạt; `listChecklistExpiring(7 ngày)` liệt kê binding sắp hết hạn; tick hằng ngày 08:00 chạy lại kiểm nhất quán cho binding hết hạn.
4. **Given** hai binding cùng email khôi phục, **Then** `D5.unique_recovery` `fail` cho cả hai, hint nêu hai kênh.
5. **Given** checklist thay đổi, **Then** chạy lại kiểm nhất quán binding đó + luật chéo (`trigger = 'checklist_changed'`).

---

### User Story 3 - Thông tin máy chạy và ASN (Priority: P2)

Health có `host_snapshots` để B1–B3; ASN chưa phân loại được xác nhận tay.

**Why this priority**: PRD §5.2 nguồn dữ liệu; A5.

**Independent Test**: unit parse PowerShell fixture; integration attestAsn.

**Acceptance Scenarios**:

1. **Given** đầu ra PowerShell mẫu (fixture JSON) cho GPU và màn hình, **When** parse, **Then** `gpus: [{ name, vramMb? }]`, `displays: [{ width, height, scale? }]`; lỗi/timeout → mảng rỗng, không ném.
2. **Given** khởi động, **Then** một `host_snapshots` (`os`, `os_version`, `gpus_json`, `displays_json`, `ram_mb`, `captured_at`); tick 24 giờ chụp lại; `latestHost()` trả gần nhất.
3. **Given** exit `asnType = 'unknown'`, **Then** A5 `unknown` với gợi ý "Chưa phân loại được ASN — xác nhận trên dashboard"; `attestAsn(3320, 'isp')` → `asn_attestations`, audit, chạy lại kiểm cho binding dùng ASN đó → A5 `pass`; `hosting` → `fail`; `mobile` → `fail` với severity hạ xuống `warn`.

---

### User Story 4 - Kích hoạt và lịch (Priority: P2)

Kiểm tra chạy đúng lúc §6.6: tạo/sửa binding, probe, kiểm proxy mới, checklist, Fury đổi phiên bản, persona đổi, định kỳ 7 ngày, trước lên mức, bấm "Kiểm tra lại".

**Independent Test**: integration với FakeClock/FakeTimers.

**Acceptance Scenarios**:

1. **Given** `createBinding`, **Then** có `consistency_runs` `trigger = 'binding_created'`; `updateBinding` → `'binding_updated'`.
2. **Given** kiểm proxy mới (`runProxyCheckNow`), **Then** chạy lại (`'proxy_checked'`) cho binding + chéo.
3. **Given** `recordFuryVersionChanged`, **Then** chạy mọi binding (`'fury_version_changed'`); E4 phát hiện persona đổi khi `furyProfile.personaId ≠ _personaAtBind` → `fail`.
4. **Given** 7 ngày trôi qua (FakeClock), **Then** một lần `'periodic'` ở giờ ngẫu nhiên 09–18 địa phương; `params.periodicDays` chỉnh được qua `setRule`? → không: qua `settings.consistency = { periodicDays }` (mặc định 7).
5. **Given** `promote`, **Then** kiểm trước (`'before_promote'`) rồi đánh giá lại readiness; luật block fail → `INPUT_INVALID` thiếu `consistency_clear`.
6. **Given** `runConsistency({ bindingId }, 'manual')`, **Then** chỉ binding đó + luật chéo.

### Edge Cases

- Probe cho binding đã archive → `INPUT_INVALID`.
- Không có `exit` ≤ 24 giờ → luật cần `exit` trả `unknown` với gợi ý "Chạy kiểm proxy".
- Không có probe → luật cần `probe` `unknown`; A2/B1 dùng cấu hình Fury nếu có.
- Dữ liệu luật cũ > 14 ngày → `note = 'stale'` để dashboard hiện "Thiếu dữ liệu".
- Luật chéo khi chỉ có 1 binding → `pass`.
- `hmac.key` thiếu trong SecretStore → `upsertChecklist` ném `INTERNAL` (bootstrap luôn tạo).
- Hai lần `importProbe` cùng nội dung → hai dòng (lịch sử), E2 so với liền trước.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Contract `packages/contract/src/consistency.ts`: `NormalizedProbeSchema` (§6.3, trường bắt buộc: `furyVersion`, `userAgent`, `navigator.platform`, `navigator.languages`, `screen`, `timezone`, `webrtc`), `ProbeResultSchema`, `RuleStatus` (đã có), `RuleOutcomeSchema`, `RuleConfigSchema` (`id`, `layer`, `severity`, `enabled`, `params`), `ConsistencyResultRowSchema`, `ConsistencyRunSummarySchema` (`runId`, `trigger`, `startedAt`, `finishedAt`, `bindings: { bindingId, score: { passed, total, blockFailing, blockUnknown }, results[] }[]`), `ChecklistInputSchema`, `ChecklistStatusSchema` (không chứa giá trị gốc), `HostSnapshotSchema`, `AsnAttestationInputSchema`, `CrossMatrixSchema`, `RULE_IDS` (21), `RuleLayer`.
- **FR-002**: Repository `probe-results`, `checklists`, `host-snapshots`, `consistency-rules`, `consistency-runs` (runs + results), `asn-attestations` trong `packages/db`.
- **FR-003**: `packages/health/src/probe/`: `parseFuryCapture(raw, converters?)` với 2 bộ chuyển đổi (`TODO(SPIKE-P3)`), `probeDiff(a, b)` (trường đổi), `ALLOWED_VERSION_CHANGE_PATHS` (§6.4 E3); `importProbe` lưu file gốc `probes/<probeId>.json`, `probe_results`, sự kiện `probe.imported`, audit, chạy kiểm.
- **FR-004**: 21 luật §6.4 dạng `ConsistencyRule` §6.1 (`id`, `layer`, `defaultSeverity`, `scope`, `needs`, `defaultParams`, `evaluate`), hint tiếng Việt có giá trị thực tế; bảng phụ `packages/health/data/{country-languages,gpu-tiers,os-signatures,timezone-countries,city-coords}.json` có `version`.
- **FR-005**: `ConsistencyEngine.run(scope, trigger)`: xây `RuleContext` §6.2 (Fury offline → `furyProfile` undefined), đánh giá luật binding cho phạm vi + luật chéo cho mọi binding chưa archive, ghi `consistency_runs/results` (severity thực tế từ `consistency_rules`, luật tắt → `skipped`), tính điểm §6.5, gọi `policy.applyConsistencyBlock(binding, failingBlockRuleIds ngoại trừ D1/E1)`, vô hiệu cache readiness, trả `ConsistencyRunSummary`; ≤ 30 s cho 10 binding.
- **FR-006**: Seeder `consistency_rules` (21 dòng mặc định) + `settings.consistency = { periodicDays: 7 }`; `getRules()`; `setRule(id, { severity?, enabled?, params? }, 'user')` ghi `settings_history` key `consistency_rule:<id>` + audit.
- **FR-007**: Evaluator `consistency_clear` (lần kiểm gần nhất của binding ≤ `maxAgeHours`, mọi luật `block` đang bật có `pass`; `unknown` không đạt) và `checklist_valid` đăng ký với 003.
- **FR-008**: Checklist §6.8: chuẩn hóa email (chữ thường, bỏ khoảng trắng), số (E.164: bỏ ký tự không số, giữ `+`; không có `+` → `INPUT_INVALID`), HMAC-SHA256 với `hmac.key`; `upsertChecklist`, `confirmChecklist` (đủ trường; `expires_at = +90 ngày`), `getChecklist` (trạng thái, không giá trị gốc), `listChecklistExpiring(days)`; tick hằng ngày 08:00 địa phương chạy kiểm cho binding hết hạn trong ngày.
- **FR-009**: `attestAsn(asn, type, note?)` → `asn_attestations` (upsert), audit, chạy lại kiểm cho binding có exit ASN đó; A5 dùng attestation khi exit `asnType` `unknown`/thiếu.
- **FR-010**: `packages/host-info`: `captureHostSnapshot({ timeoutMs = 3000, exec? })` (`TODO(SPIKE-P6)`), `parseVideoControllers(json)`, `parseScreens(json)`; Health chụp khi `start()` và mỗi 24 giờ (timer tiêm), lưu `host_snapshots`, `latestHost()`.
- **FR-011**: Trigger §6.6: nối vào 003 (`createBinding`, `updateBinding`, `runProxyCheckNow`, `recordFuryVersionChanged`, `promote` trước đánh giá, `importProbe`, checklist, attestAsn), định kỳ `periodicDays` giờ ngẫu nhiên 09–18, `runConsistency` thủ công.
- **FR-012**: Audit: nhập probe, xác nhận checklist, sửa luật, xác nhận ASN, chạy kiểm thủ công.
- **FR-013**: `getConsistency(bindingId)` (lần gần nhất + so sánh probe), `getCrossMatrix()`; test unit 21 luật (bảng kịch bản), integration §10 (A2 fail → nút Lên mức tắt; E2 pass; C3 fail), hiệu năng.

### Key Entities

- Bảng SPEC-00 §8 liên quan; `settings.consistency`; `settings_history` key `consistency_rule:<id>`.
- `NormalizedProbe` §6.3; `RuleContext` §6.2; `RuleOutcome` §6.1.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 21/21 luật có test pass/fail/unknown với hint tiếng Việt.
- **SC-002**: `runConsistency` cho 10 binding ≤ 30 s (test với FakeFury) — mục tiêu thực tế ≤ 2 s.
- **SC-003**: Không có giá trị email/số khôi phục gốc trong CSDL, log, audit, kết quả API (test grep).
- **SC-004**: Đổi bộ chuyển đổi probe sau SPIKE-P3 chỉ sửa `packages/health/src/probe/converters.ts`.

## Assumptions

- WebRTC IP nội bộ không coi là rò (A6).
- Bảng phụ là phiên bản khởi đầu nhỏ (các nước/thành phố/GPU phổ biến); thiếu → `unknown`, không `fail`.
- `host.os` lấy từ `os.platform()` (`win32` → `windows`); `osVersion` từ `os.release()`.
- Thời gian kiểm định kỳ 09–18 dùng cùng cơ chế RNG seed của 003.
