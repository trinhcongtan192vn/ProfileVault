# SPEC-02 — Health service: mức tự động hóa, ngưỡng, hạ mức, kiểm tra nhất quán

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M0 · **Yêu cầu PRD:** F1–F8, F13–F16 · **Phụ thuộc:** SPEC-00, SPEC-01

## 1. Mục đích

Health service giữ **mức tự động hóa** của từng binding và quyết định khi nào binding được lên mức, phải hạ mức hoặc phải dừng job. Nguồn quyết định là sự kiện sức khỏe, kết quả kiểm proxy, kết quả run và **kiểm tra độ nhất quán profile**. Health service chỉ báo và chặn; không bao giờ tự sửa cấu hình profile.

## 2. Mức tự động hóa

| Mức | Flow được phép (theo `manifest.minLevel`, SPEC-03) | CDP |
|---|---|---|
| L0 | Không flow nào | Không |
| L1 | Flow `minLevel ≤ 1` (session-check, probe — chỉ đọc) | Chỉ trong lúc chạy flow |
| L2 | Flow `minLevel ≤ 2`; flow có chế độ chạy ở chế độ `L2` (dừng trước bước cuối) | Như trên |
| L3 | Mọi flow; flow có chế độ chạy ở chế độ `L3` | Như trên |

Bất biến:
- Runner kiểm `binding.level ≥ flow.minLevel` **ngay trước khi mở profile**, không chỉ lúc nhận job.
- Binding mới luôn bắt đầu ở L0. Mỗi lần lên mức chỉ tăng một bậc.
- Khi mức giảm, mọi run đang chạy của binding có `flow.minLevel > mức mới` bị hủy (`CANCELLED`, `detail.reason = "level_demoted"`), run đang chờ người được giữ cho tới khi người xử lý nhưng không được bấm bước cuối.

## 3. Ngưỡng lên mức

### 3.1 Cửa sổ quan sát
Cửa sổ của một mức bắt đầu tại `bindings.level_since` (đặt lại mỗi lần đổi mức, lên hoặc xuống). Mọi điều kiện đếm/tỉ lệ chỉ tính sự kiện trong cửa sổ.

### 3.2 Loại điều kiện

```ts
type Condition =
  | { kind: 'days_at_level'; min: number }
  | { kind: 'event_count'; type: string; min: number }
  | { kind: 'no_red_events' }
  | { kind: 'session_check_rate'; min: number; minSamples: number }
  | { kind: 'proxy_stable' }                        // không có proxy.country_changed / asn_changed
  | { kind: 'detect_suite_pass' }                   // có kết quả passed cho phiên bản Fury hiện tại
  | { kind: 'consistency_clear'; maxAgeHours: number }   // lần kiểm gần nhất: mọi luật block = pass
  | { kind: 'checklist_valid' }                     // checklist đủ trường và chưa hết hạn
  | { kind: 'flow_success_rate'; flowId: string; mode?: 'L2' | 'L3'; min: number; minSamples: number }
  | { kind: 'l2_correct_rate'; flowId: string; min: number; minSamples: number }  // §3.4
  | { kind: 'event_count_by_mode'; flowId: string; mode: 'L2' | 'L3'; min: number }
  | { kind: 'no_open_site_changed'; flowId?: string };
```

### 3.3 Cấu hình mặc định
Lưu ở `settings` khóa `thresholds`, chỉnh qua dashboard, mọi thay đổi ghi `settings_history`.

```json
{
  "L0_to_L1": [
    { "kind": "days_at_level", "min": 14 },
    { "kind": "event_count", "type": "manual.upload", "min": 5 },
    { "kind": "no_red_events" },
    { "kind": "proxy_stable" },
    { "kind": "detect_suite_pass" },
    { "kind": "consistency_clear", "maxAgeHours": 24 },
    { "kind": "checklist_valid" }
  ],
  "L1_to_L2": [
    { "kind": "days_at_level", "min": 14 },
    { "kind": "session_check_rate", "min": 0.95, "minSamples": 10 },
    { "kind": "no_red_events" },
    { "kind": "proxy_stable" },
    { "kind": "detect_suite_pass" },
    { "kind": "consistency_clear", "maxAgeHours": 24 },
    { "kind": "checklist_valid" }
  ],
  "L2_to_L3": [
    { "kind": "days_at_level", "min": 30 },
    { "kind": "event_count_by_mode", "flowId": "youtube/upload", "mode": "L2", "min": 20 },
    { "kind": "l2_correct_rate", "flowId": "youtube/upload", "min": 0.95, "minSamples": 20 },
    { "kind": "no_red_events" },
    { "kind": "proxy_stable" },
    { "kind": "detect_suite_pass" },
    { "kind": "consistency_clear", "maxAgeHours": 24 },
    { "kind": "checklist_valid" },
    { "kind": "no_open_site_changed", "flowId": "youtube/upload" }
  ]
}
```

`no_red_events` coi là đỏ mọi sự kiện có `severity = 'red'` (SPEC-00 §7.1).

### 3.4 "Điền đúng" ở L2
Khi một run `youtube/upload` chế độ L2 dừng ở bước cuối, người vận hành xác nhận bằng một trong hai lựa chọn (SPEC-03 §6): **"Đúng hết, đã bấm"** hoặc **"Phải sửa tay rồi mới bấm"**. Tỉ lệ điền đúng = số "Đúng hết" / tổng run L2 hoàn tất trong cửa sổ.

### 3.5 Đánh giá và tiến độ
- `evaluateReadiness(bindingId)` trả về danh sách điều kiện của chuyển tiếp kế: `{ condition, met: boolean, current, required }`, và `progress = số điều kiện đạt / tổng`.
- Binding đang bị dừng: `canPromote = false` bất kể điều kiện.
- Binding ở L3: không có chuyển tiếp kế; trả `progress = null`.

### 3.6 Lên mức
1. Người vận hành bấm "Lên mức" (chỉ trên dashboard; không có qua MCP hay API app ngoài).
2. Server đánh giá lại ngay tại thời điểm bấm; chỉ thực hiện khi mọi điều kiện đạt và không có dừng mở.
3. Ghi `level_changes` (`kind = promote`, `actor = user`), cập nhật `bindings.level`, `level_since = now`, sự kiện `level.promoted`, audit, phát `binding.level_changed`.

## 4. Hạ mức và dừng job

### 4.1 Quy tắc
Áp theo thứ tự; một tình huống có thể khớp nhiều dòng (lấy hành động mạnh nhất cho mức, tạo đủ các lý do dừng).

| # | Tác nhân | Hạ mức | Dừng (`PauseReason`) | Gỡ dừng |
|---|---|---|---|---|
| R1 | Sự kiện đỏ về tài khoản: `manual.verification_request`, `manual.captcha`, `manual.platform_warning`, `manual.logged_out`, `session_check.logged_out`, `session_check.wrong_account`, `run.challenge` | Về **L0** | `red_event` | Người bấm "Đã xử lý" |
| R2 | `proxy.country_changed` hoặc `proxy.asn_changed` (luật E1) | **Một mức** (không dưới L0) | `proxy_changed` | Người xác nhận exit mới |
| R3 | Hai binding trùng exit IP (luật D1) | Cả hai về **L0** | `duplicate_exit_ip` (cả hai) | Tự gỡ khi lần kiểm kế tiếp không còn trùng |
| R4 | Luật nhất quán mức `block` khác trượt (trừ E1, D1) | Giữ mức | `consistency_block` | Tự gỡ khi lần kiểm kế tiếp mọi luật block đạt |
| R5 | `detect_suite.recorded` với `passed = false` cho phiên bản Fury hiện tại, hoặc Fury đổi phiên bản mà chưa có kết quả detect-suite | Giữ mức | `detect_suite_failed` | Tự gỡ khi có kết quả passed cho phiên bản hiện tại |
| R6 | `flow.site_changed` 2 lần liên tiếp cho cùng flow trên binding ở L3 | L3 → L2 | Không | — |
| R7 | Người vận hành bấm "Tạm dừng" | Giữ mức | `manual` | Người bấm "Tiếp tục" |

Binding ở L0 vẫn ghi lý do dừng (để hiện trên dashboard và chặn lên mức), dù L0 không chạy job.

### 4.2 Hệ quả khi dừng
- Job service từ chối job mới: `BINDING_PAUSED` (SPEC-06).
- Runner không bắt đầu run mới cho binding; run đang ở `queued`/`waiting_profile` chuyển `cancelled` với `detail.reason = "paused"`; run đang `running` được chạy hết bước hiện tại rồi dừng (`cancelled`), trừ bước không idempotent đang chạy thì để hoàn tất bước đó.
- Run đang `needs_user` vì chính sự cố gây dừng (phiên hết hạn, CAPTCHA, sai tài khoản — SPEC-04 §5.4) được giữ để người xử lý trong cửa sổ profile; khi người chọn, run kết thúc `failed` với mã của sự cố, không chạy tiếp các bước còn lại.
- Thông báo toast đỏ (R1–R5), sự kiện `binding.paused`, audit.

### 4.3 Thời gian phản ứng
Từ lúc ghi nhận sự kiện tới khi hạ mức + dừng: ≤ 1 phút (xử lý đồng bộ trong cùng giao dịch ghi sự kiện, trừ R3/R4 xử lý ngay sau lần kiểm nhất quán).

## 5. Nguồn sự kiện

| Nguồn | Xử lý |
|---|---|
| Khai báo tay (dashboard, một chạm) | Ghi `health_events` với `occurred_at` do người chọn (mặc định now, cho phép lùi tối đa 7 ngày) |
| Kiểm proxy (§7) | Ghi `proxy_checks`; so với lần `ok` trước: khác quốc gia → `proxy.country_changed`; khác ASN → `proxy.asn_changed`; lỗi → `proxy.check_failed`. Đổi IP trong cùng quốc gia + ASN: chỉ ghi, không là sự kiện đỏ |
| Session-check (flow L1+) | Kết quả run ánh xạ: đăng nhập đúng → `session_check.ok`; đăng xuất → `logged_out`; sai tài khoản → `wrong_account`; lỗi kỹ thuật → `failed` |
| Run | `run.done/failed/needs_user`; `CHALLENGE` → `run.challenge`; `SITE_CHANGED` → `flow.site_changed` |
| Fury | `fury.version_changed` → áp R5 nếu chưa có detect-suite passed cho phiên bản mới; `fury.profile_opened/closed` |
| Detect-suite | Người vận hành nhập kết quả `fury-detect gate` (passed/failed, phiên bản Fury, tóm tắt), toàn cục hoặc theo binding |

## 6. Kiểm tra độ nhất quán

### 6.1 Mô hình

```ts
interface ConsistencyRule {
  id: string;                     // 'A1.exit_country_matches_market'
  layer: 'A' | 'B' | 'C' | 'D' | 'E';
  defaultSeverity: Severity;
  scope: 'binding' | 'cross';     // cross = so giữa các binding
  needs: DataKey[];               // dữ liệu cần; thiếu → 'unknown'
  defaultParams: Record<string, unknown>;
  evaluate(ctx: RuleContext, params: object): RuleOutcome | RuleOutcome[];  // cross trả nhiều outcome
}
type RuleOutcome = { bindingId: string; status: RuleStatus; actual?: unknown; expected?: unknown; hint?: string };
type DataKey = 'furyProfile' | 'exit' | 'probe' | 'previousProbe' | 'host' | 'checklist' | 'allBindings';
```

Severity thực tế = `consistency_rules.severity` (người vận hành chỉnh được), mặc định `defaultSeverity`. Luật tắt (`enabled = 0`) trả `skipped`.

### 6.2 Dữ liệu đầu vào (`RuleContext`)

| Khóa | Lấy từ | Ghi chú |
|---|---|---|
| `furyProfile` | `FuryClient.getProfile` | Đã xác minh SPIKE-P2 (SPEC-01 §4) |
| `exit` | `proxy_checks` gần nhất có `ok = 1`, không quá 24 giờ | |
| `probe`, `previousProbe` | `probe_results` gần nhất và liền trước | |
| `host` | `host_snapshots` gần nhất (chụp khi khởi động và mỗi 24 giờ) | Đã xác minh SPIKE-P6: `os`, PowerShell `Win32_VideoController` + `Screen.AllScreens`, không cần admin, < 3 s. VRAM từ `AdapterRAM` bị chặn 4 GB nên không dùng |
| `checklist` | `account_checklists` | |
| `allBindings` | Mọi binding chưa archive kèm `exit`, `furyProfile`, `checklist` của từng cái | |

### 6.3 Probe chuẩn hóa (`NormalizedProbe`) (định dạng nguồn đã xác minh SPIKE-P3 từ mã nguồn)

Nguồn: trang probe detect-suite của Fury (`tools/detect-suite/probe.js`, `__schema: 1`), mở từ trang khởi đầu của profile (relay loopback `http://127.0.0.1:<relay_port>/<token>/probe/`), nút "Скачать JSON" xuất nguyên đối tượng `furyProbe()`. Ánh xạ (`furyDetectSuiteConverter`): `navigator.*` (`languages` là chuỗi ngăn bởi dấu phẩy), `clientHints` → `uaData` (`brands` dạng "Brand/ver,…"), `screen.*` + `innerWidth/innerHeight` → `window`, `locale.timezone`, `permissions.geolocation`, `webgl.webgl1|2.unmasked` → `webgl`, hash: `canvas2d.getImageData`, `webgl.*.render.readPixels`, `audio.offline.hash`; `speech.names` ("tên|lang|local~…") → `voices`; `fonts.detectedByMeasurement`; `webrtc.addresses` bỏ tên mDNS `*.local` (bản tải từ trang host công khai có `redacted: true` → bỏ hết); `crossContext.consistent`. File **không** có phiên bản Fury và thời điểm đo: `furyVersion` lấy phiên bản Fury đang chạy lúc nhập (Fury offline → `INPUT_INVALID` thiếu `furyVersion`), `capturedAt` = lúc nhập. Không có `dns`. Vector lỗi/vắng (`{ __error }`, `{ __absent }`) coi như không có.

```ts
type NormalizedProbe = {
  furyVersion: string; capturedAt: string;
  userAgent: string;
  uaData?: { platform: string; platformVersion?: string; brands: { brand: string; version: string }[];
             fullVersionList?: { brand: string; version: string }[]; architecture?: string; bitness?: string };
  navigator: { platform: string; languages: string[]; hardwareConcurrency?: number; deviceMemory?: number;
               maxTouchPoints?: number; webdriver: boolean };
  screen: { width: number; height: number; availWidth: number; availHeight: number; colorDepth: number; dpr: number };
  window?: { innerWidth: number; innerHeight: number };
  timezone: string;                                   // Intl.DateTimeFormat().resolvedOptions().timeZone
  geolocationPermission?: 'granted' | 'denied' | 'prompt';
  webgl?: { vendor: string; renderer: string };
  hashes: { canvas?: string; webgl?: string; audio?: string };
  voices: string[]; fonts: string[];
  webrtc: { candidateIps: string[] };
  dns?: { resolverCountry?: string };
  contextsConsistent?: boolean;                       // trang/Worker/iframe trả cùng giá trị (nếu probe Fury có)
};
```

- Bộ chuyển đổi `parseFuryCapture(raw) → NormalizedProbe` nằm trong `packages/health/probe/`. Trường bắt buộc: `furyVersion`, `userAgent`, `navigator.platform`, `navigator.languages`, `screen`, `timezone`, `webrtc`. Thiếu trường bắt buộc → từ chối nhập kèm danh sách trường thiếu.
- Lưu file gốc vào `%LOCALAPPDATA%\ProfileVault\probes\<probeId>.json`; `data_json` lưu bản chuẩn hóa.
- Nhập file probe kích hoạt một lần kiểm nhất quán cho binding đó.

### 6.4 Danh mục luật

| ID | Mức mặc định | Cần | Đánh giá | Gợi ý khi trượt |
|---|---|---|---|---|
| `A1.exit_country_matches_market` | block | exit | `exit.country == binding.market_country` | "Exit đang ở {country}, kênh nhắm {market}. Đổi proxy hoặc sửa thị trường." |
| `A2.timezone_matches_exit` | block | exit, probe (hoặc furyProfile) | Múi giờ đo được (probe; nếu chưa có probe thì cấu hình Fury) có cùng UTC offset hiện tại **và** thuộc cùng quốc gia với `exit.timezone` | "Đặt múi giờ profile = {exit.timezone}" |
| `A3.language_plausible` | warn | probe (hoặc furyProfile), exit | `languages[0]` có mã ngôn ngữ thuộc danh sách ngôn ngữ chính thức của `exit.country` hoặc `en` (bảng `country-languages.json`) | "Đặt ngôn ngữ đầu tiên = {gợi ý}" |
| `A4.geolocation_off_or_matches` | block | furyProfile, exit | `geolocation.mode == 'off'`, hoặc tọa độ cách thành phố exit ≤ `params.maxKm` (mặc định 150) | "Tắt geolocation hoặc đặt theo vị trí exit" |
| `A5.asn_residential` | block | exit | `asnType ∈ {isp, residential}` (lấy từ exit hoặc `asn_attestations`). `mobile` → fail với severity hạ xuống warn. `hosting` → fail. `unknown` → unknown | "ASN {asnOrg} là hosting. Dùng proxy ISP/residential tĩnh." / "Chưa phân loại được ASN — xác nhận trên dashboard" |
| `A6.no_leaks` | block | probe, exit | `webrtc.candidateIps ⊆ {exit.ip}` (hoặc rỗng); nếu có `dns.resolverCountry` thì bằng `exit.country` | "WebRTC lộ IP {ip}" / "DNS ra từ {country}" |
| `B1.os_matches_host` | block | furyProfile hoặc probe, host | Persona thuộc họ Windows (`navigator.platform == 'Win32'` và UA chứa "Windows") và `host.os` là Windows | "Dùng persona Windows trên máy Windows" |
| `B2.gpu_class_plausible` | warn | probe, host | Hạng GPU persona và GPU thật (bảng `gpu-tiers.json`, hạng 1–4) chênh ≤ `params.maxTierGap` (mặc định 1) | "Chọn persona có GPU gần {host GPU}" |
| `B3.screen_fits_host` | warn | probe, host | `screen.width/height ≤` màn hình lớn nhất của máy; nếu có `window` thì `innerWidth ≤ screen.availWidth` | "Chọn persona có độ phân giải ≤ {host}" |
| `B4.voices_fonts_os` | block | probe | `voices`/`fonts` không chứa chữ ký của OS khác (bảng `os-signatures.json`: ví dụ voices macOS) | "Danh sách voices lộ {os}. Dùng persona cùng OS với máy" |
| `C1.account_geo_aligned` | block | checklist, exit | `market_country == exit.country == checklist.account_region == checklist.channel_country`; trường checklist trống → `unknown` (hiển thị như cảnh báo) | "Vùng tài khoản là {region}, kênh nhắm {market}" |
| `C2.studio_language_info` | info | binding.pack_config, probe | Luôn `info`: ghi ngôn ngữ Studio đã ghim và ngôn ngữ trình duyệt | — |
| `C3.checklist_complete` | block | checklist | Đủ mọi trường của §6.8 và `expires_at > now` | "Điền/xác nhận lại checklist tài khoản" |
| `D1.unique_exit_ip` | block | allBindings | Không hai binding có cùng `exit.ip` trong lần kiểm gần nhất | "Kênh {a} và {b} cùng exit IP {ip}" — kích hoạt R3 |
| `D2.unique_subnet` | warn | allBindings | Không hai binding cùng /24 (IPv4) hoặc /48 (IPv6) | "Kênh {a} và {b} cùng dải {subnet}" |
| `D3.unique_persona_seed` | block | allBindings | Không hai binding có cùng cặp `personaId + seed`; thiếu seed → `unknown` | "Hai profile trùng persona và seed" |
| `D4.persona_asn_crowd` | warn | allBindings | Số binding cùng `personaId` trên cùng ASN ≤ `params.max` (mặc định 3) | "{n} kênh cùng persona trên ASN {asn}" |
| `D5.unique_recovery` | block | allBindings | Không hai binding trùng `recovery_email_hmac` hoặc `recovery_phone_hmac` | "Kênh {a} và {b} dùng chung email/số khôi phục" |
| `E1.exit_stable` | block | proxy_checks | Exit gần nhất cùng quốc gia + ASN với exit `ok` liền trước | Kích hoạt R2 |
| `E2.noise_hash_stable` | block | probe, previousProbe | Cùng `furyVersion` → `hashes` bằng nhau từng trường có mặt; khác phiên bản → `skipped` | "Hash {field} đổi giữa hai lần đo cùng phiên bản Fury" |
| `E3.only_version_changed` | block | probe, previousProbe | Khác `furyVersion` → so mọi trường trừ danh sách được phép đổi (`userAgent` phần phiên bản, `uaData.brands[].version`, `uaData.fullVersionList`, `uaData.platformVersion`); khác ngoài danh sách → fail | "Sau khi nâng Fury, {fields} cũng đổi" |
| `E4.persona_unchanged` | block | furyProfile | `personaId` hiện tại bằng `personaId` ghi nhận lúc tạo binding (lưu trong `pack_config_json._personaAtBind`) | "Persona của profile đã đổi sau khi gắn kênh" |

Bảng phụ trợ (`country-languages.json`, `gpu-tiers.json`, `os-signatures.json`) nằm trong `packages/health/data/`, có phiên bản, cập nhật cùng bản phát hành.

### 6.5 Ý nghĩa kết quả
- **Rời L0 / lên mức:** điều kiện `consistency_clear` đòi mọi luật `block` (không `skipped`) có `pass` trong lần kiểm gần nhất ≤ `maxAgeHours`. `unknown` **không** được tính là đạt.
- **Binding ≥ L1 đang chạy:** luật `block` = `fail` → áp R2/R3/R4. `unknown` không dừng job, nhưng hiện cảnh báo; nếu dữ liệu của luật đó cũ quá 14 ngày, dashboard hiện "Thiếu dữ liệu" nổi bật.
- **Điểm nhất quán** (dashboard): `pass / (tổng − skipped − info)`, kèm số luật `block` đang `fail` hoặc `unknown`.

### 6.6 Khi nào chạy
| Kích hoạt | Phạm vi |
|---|---|
| Tạo binding, sửa binding | Binding đó + luật cross |
| Nhập probe, có kết quả kiểm proxy mới, checklist đổi | Binding đó + luật cross |
| Fury đổi phiên bản, phát hiện persona đổi | Mọi binding |
| Định kỳ mỗi `params.periodicDays` (mặc định 7) ngày, giờ ngẫu nhiên trong khung 09:00–18:00 | Mọi binding |
| Trước mỗi lần lên mức | Binding đó + luật cross |
| Người bấm "Kiểm tra lại" | Tùy chọn |

Một lần kiểm = một dòng `consistency_runs` + các dòng `consistency_results`. Các lớp không cần trình duyệt phải xong ≤ 30 giây cho 10 binding.

### 6.7 Gợi ý sửa
Mỗi outcome `fail`/`unknown` có `hint` tiếng Việt, chứa giá trị thực tế và hành động cụ thể (chỗ sửa trong Fury hoặc trên dashboard). Health service **không** gọi API ghi nào tới Fury.

### 6.8 Checklist tài khoản
Trường: `account_region` (ISO2), `channel_country` (ISO2), `account_language` (BCP-47), email khôi phục, số điện thoại khôi phục, `twofa_enabled`, `exclusive_login_confirmed` (tài khoản chỉ đăng nhập trong profile Fury này), `studio_language_set`.

- Email/số khôi phục chuẩn hóa (email: chữ thường, bỏ khoảng trắng; số: E.164) rồi lưu `HMAC-SHA256(khóa máy, giá trị)`; không lưu giá trị gốc, không hiển thị lại.
- `confirmed_at` = lúc người bấm xác nhận; `expires_at = confirmed_at + 90 ngày`. Hết hạn → C3 fail, nhắc trên dashboard trước 7 ngày.

## 7. Lịch nội bộ

| Việc | Chu kỳ | Ghi chú |
|---|---|---|
| Kiểm proxy (`FuryClient.checkExit`) cho mọi binding | 4 lần/ngày, mỗi lần một thời điểm ngẫu nhiên trong các khung 06–10, 10–14, 14–18, 18–22 | Không mở trình duyệt **[SPIKE-P5]**. Fury offline → bỏ lượt, ghi `proxy.check_failed` sau 3 lượt lỡ liên tiếp |
| Kiểm nhất quán định kỳ | §6.6 | |
| Chụp `host_snapshots` | Khi khởi động + 24 giờ | |
| Hết hạn checklist | Hằng ngày 08:00 | |
| Đánh giá tiến độ cho dashboard | Khi có sự kiện mới cho binding; cache 5 phút | |

Session-check và probe tự động là flow, do Runner lập lịch (SPEC-03 §8).

## 8. Giao diện nội bộ (dùng bởi Gateway)

```ts
interface HealthService {
  createBinding(input: CreateBindingInput): Promise<Binding>;        // level 0, chạy kiểm nhất quán
  updateBinding(id: string, patch: UpdateBindingInput): Promise<Binding>;
  archiveBinding(id: string): Promise<void>;
  recordManualEvent(bindingId: string, type: ManualEventType, occurredAt?: string, note?: string): Promise<HealthEvent>;
  recordDetectSuite(input: { furyVersion: string; bindingId?: string; passed: boolean; summary?: string }): Promise<void>;
  importProbe(bindingId: string, from: { filePath: string } | { raw: object }, source: 'manual_import' | 'flow'): Promise<ProbeResult>;
  upsertChecklist(bindingId: string, input: ChecklistInput): Promise<void>;
  confirmChecklist(bindingId: string): Promise<void>;
  attestAsn(asn: number, type: 'isp' | 'residential' | 'mobile' | 'hosting', note?: string): Promise<void>;
  runConsistency(scope: { bindingId?: string }, trigger: string): Promise<ConsistencyRunSummary>;
  evaluateReadiness(bindingId: string): Promise<Readiness>;
  promote(bindingId: string, actor: 'user'): Promise<LevelChange>;
  pause(bindingId: string, actor: 'user', note?: string): Promise<void>;
  clearPause(pauseId: string, actor: 'user'): Promise<void>;          // chỉ với lý do gỡ bởi người (R1, R2, R7)
  getThresholds(): Thresholds; setThresholds(t: Thresholds, actor: 'user'): void;
  getRules(): RuleConfig[]; setRule(id: string, patch: { severity?: Severity; enabled?: boolean; params?: object }, actor: 'user'): void;
}
```

`CreateBindingInput`: `platform`, `accountId`, `displayName`, `furyProfileId`, `marketCountry`, `packConfig`, `allowedRoots`. Trùng `furyProfileId` hoặc trùng `platform + accountId` → `INPUT_INVALID`.

## 9. Audit và thông báo

- Audit: tạo/sửa/archive binding, đổi mức, dừng/gỡ dừng, đổi ngưỡng, đổi luật, nhập probe, nhập detect-suite, xác nhận checklist, xác nhận ASN.
- Toast: R1–R5 (đỏ); binding đạt ngưỡng mức kế (xanh, tối đa một lần/ngày/binding); checklist sắp hết hạn.

## 10. Nghiệm thu (PRD §12, M0)

| Kịch bản | Kết quả mong đợi |
|---|---|
| Khai báo `manual.captcha` cho binding L1 | Về L0, `red_event` mở, run đang chờ bị hủy, toast đỏ, ≤ 1 phút |
| Kiểm proxy trả quốc gia khác | `proxy.country_changed`, hạ một mức, `proxy_changed` mở |
| Hai binding cùng exit IP | Cả hai về L0, `duplicate_exit_ip` mở cả hai; đổi proxy một bên → lần kiểm sau tự gỡ |
| Profile đặt múi giờ lệch exit | A2 fail kèm gợi ý; nút "Lên mức" tắt |
| Nhập probe hai lần cùng phiên bản Fury | E2 pass |
| Checklist thiếu `twofa_enabled` | C3 fail; không rời L0 |
| Giả lập đủ điều kiện L0→L1 | `canPromote = true`; bấm lên mức → L1, `level_since` đặt lại |
