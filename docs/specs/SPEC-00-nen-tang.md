# SPEC-00 — Nền tảng: quy ước, cấu trúc, dữ liệu dùng chung

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Nguồn:** PRD v1.3, Kiến trúc v1.3

Tài liệu gốc của bộ spec. Mọi spec khác dùng các định nghĩa ở đây (ID, enum, bảng, mã lỗi); không định nghĩa lại.

---

## 1. Bộ spec

| Mã | Tài liệu | Giai đoạn | Yêu cầu PRD |
|---|---|---|---|
| SPEC-00 | Nền tảng (tài liệu này) | M0 | — |
| SPIKE | Kế hoạch spike | M-1 | §6, §12 (M-1) |
| SPEC-01 | FuryClient | M0 | F3, F9 (một phần) |
| SPEC-02 | Health service: mức, ngưỡng, hạ mức, kiểm tra nhất quán | M0 | F1–F8, F13–F16 |
| SPEC-03 | Flow contract + Runner + lịch | M0 (`ctx.ai`: M3) | F9–F11, F22 |
| SPEC-04 | Flow pack `generic` + `youtube` | M0 (generic/session-check), M1 (còn lại) | F5, F17, F19 |
| SPEC-05 | Gateway, xác thực, chính sách | M0 (REST), M1 (MCP, token app ngoài) | F12, F20 |
| SPEC-06 | Job service + Integration API `profilevault/v1` | M1 | F18, F20 |
| SPEC-07 | Dashboard, trang trạng thái, tray, thông báo | M0 | F2, F7, F12 |
| SPEC-08 | Skill cho Claude | M2 | F21 |
| SPEC-09 | Kiểm thử | M-1 → M2 | §12 |

Điểm còn chờ kết quả spike được đánh dấu **[SPIKE-Pn]** (xem kế hoạch spike). Spec phải viết sao cho kết quả spike chỉ làm thay đổi phần adapter, không thay đổi hợp đồng.

---

## 2. Quy ước

- Nội dung tiếng Việt; identifier, tên bảng, tên trường, mã lỗi tiếng Anh.
- Thời gian lưu UTC dạng ISO 8601 (`2026-10-14T10:21:00.000Z`); hiển thị theo múi giờ máy (mặc định Asia/Bangkok).
- Khoảng thời gian trong cấu hình: số nguyên kèm đơn vị trong tên khóa (`windowDays`, `timeoutMinutes`).
- Mọi schema dữ liệu vào/ra định nghĩa bằng **Zod**, đặt trong `packages/contract`; kiểu TypeScript suy ra từ Zod.
- Từ khóa "phải / không được / nên" mang nghĩa bắt buộc / cấm / khuyến nghị.

---

## 3. Công nghệ

| Lớp | Lựa chọn |
|---|---|
| Ngôn ngữ, runtime | TypeScript, Node.js 22 LTS |
| Quản lý mã | pnpm workspace (monorepo) |
| HTTP server | Fastify 5 |
| MCP | `@modelcontextprotocol/sdk`, transport Streamable HTTP |
| CSDL | SQLite qua `better-sqlite3`, ORM/migration bằng Drizzle |
| Schema | Zod |
| Tự động hóa trình duyệt | Playwright (`chromium.connectOverCDP`) |
| AI cho bước dễ vỡ (M3) | Stagehand |
| Giao diện | React + Vite (SPA), Recharts, TanStack Query/Table; Fastify phục vụ file tĩnh |
| Tray | `systray2` |
| Thông báo | Windows toast qua `node-notifier` |
| Bí mật | Windows DPAPI (native addon, ví dụ `@primno/dpapi`) |
| Băm | `argon2` (token), HMAC-SHA256 (email/số khôi phục) |
| Trace | OpenTelemetry SDK, exporter ghi SQLite cục bộ |
| Kiểm thử | Vitest, Playwright Test |

---

## 4. Cấu trúc repo

```
profilevault/
├─ apps/
│  ├─ service/            # tiến trình nền: bootstrap, tray, scheduler, wiring
│  └─ dashboard/          # SPA React
├─ packages/
│  ├─ contract/           # @sctech/profilevault-contract: Zod schema, mã lỗi, kiểu API
│  ├─ db/                 # schema Drizzle, migration, repository
│  ├─ fury-client/        # SPEC-01
│  ├─ health/             # SPEC-02
│  ├─ runner/             # SPEC-03 (flow contract, runner, scheduler, linter)
│  ├─ jobs/               # SPEC-06
│  ├─ gateway/            # SPEC-05 (REST + MCP)
│  └─ host-info/          # đọc thông tin máy (OS, GPU, màn hình)
├─ packs/
│  ├─ generic/            # SPEC-04
│  └─ youtube/            # SPEC-04
├─ skills/                # SPEC-08 (bố cục plugin)
├─ tools/eslint-plugin-pv/  # luật lint cho pack (SPEC-03)
└─ specs/
```

Pack người dùng đặt ở `%APPDATA%\ProfileVault\extensions\flows\<pack>\`.

---

## 5. Thư mục và cấu hình trên máy

| Đường dẫn | Nội dung |
|---|---|
| `%APPDATA%\ProfileVault\config.json` | Cấu hình không bí mật (cổng, đường dẫn, giới hạn) |
| `%APPDATA%\ProfileVault\secrets.bin` | Bí mật đã mã hóa DPAPI: token Fury, khóa HMAC, khóa LLM |
| `%APPDATA%\ProfileVault\profilevault.db` | CSDL SQLite (WAL) |
| `%APPDATA%\ProfileVault\extensions\flows\` | Pack người dùng |
| `%LOCALAPPDATA%\ProfileVault\runs\<runId>\` | Artifact của run (trace, ảnh, log) |
| `%LOCALAPPDATA%\ProfileVault\probes\<probeId>.json` | File probe gốc đã nhập |
| `%LOCALAPPDATA%\ProfileVault\logs\` | Log tiến trình (xoay vòng 7 ngày) |

`config.json` (giá trị mặc định):

```json
{
  "gateway": { "host": "127.0.0.1", "port": 50410 },
  "fury": { "apiBaseUrl": "http://127.0.0.1:${FURY_API_PORT}", "supportedVersions": ">=0.2.21 <0.4.0", "dataDir": null },
  "runner": { "maxConcurrentIdle": 6, "maxConcurrentBusy": 3, "ramPerProfileMb": 500, "profileBusyTimeoutMinutes": 360, "humanGateTimeoutHours": 24 },
  "limits": { "uploadsPerAccountPerDay": 10 },
  "retention": { "runArtifactsDays": 30, "dataMonths": 12 },
  "ui": { "timezone": "Asia/Bangkok", "dailyReminderLocalTime": "21:00" }
}
```

Ngưỡng lên mức và bộ luật nhất quán **không** nằm trong `config.json`; lưu trong CSDL (bảng `settings`, `consistency_rules`) để có lịch sử thay đổi.

---

## 6. Định danh

ULID có tiền tố, sinh phía server.

| Tiền tố | Thực thể |
|---|---|
| `ab_` | AccountBinding |
| `lc_` | LevelChange |
| `bp_` | BindingPause |
| `he_` | HealthEvent |
| `px_` | ProxyCheck |
| `pr_` | ProbeResult |
| `cc_` | ConsistencyRun |
| `jb_` | Job |
| `rn_` | Run |
| `sc_` | Schedule |
| `ca_` | ClientApp |
| `au_` | AuditEvent |

ID không có tiền tố:
- **Flow:** `<pack>/<flow>` (ví dụ `youtube/upload`, `generic/probe`).
- **Luật nhất quán:** `<lớp><số>.<tên>` (ví dụ `A1.exit_country_matches_market`), danh mục ở SPEC-02.
- **Tài khoản nền tảng:** cặp `platform` + `accountId` (ví dụ `youtube` + `UCxxxxxxxx`).
- **Profile Fury:** ID do Fury cấp, lưu nguyên dạng chuỗi.

---

## 7. Enum dùng chung

```ts
type Platform = 'youtube' | 'tiktok' | 'facebook' | string;   // mở rộng theo pack
type AutomationLevel = 0 | 1 | 2 | 3;                          // L0..L3
type Severity = 'block' | 'warn' | 'info';
type RuleStatus = 'pass' | 'fail' | 'unknown' | 'info' | 'skipped';
type EventSeverity = 'info' | 'warn' | 'red';
type EventSource = 'manual' | 'proxy_check' | 'session_check' | 'probe' | 'run' | 'fury' | 'system';

type JobStatus = 'queued' | 'running' | 'needs_user' | 'done' | 'failed' | 'cancelled' | 'rejected';
type RunStatus = 'queued' | 'waiting_profile' | 'launching' | 'running' | 'needs_user'
               | 'finalizing' | 'done' | 'failed' | 'cancelled';

type PauseReason = 'red_event' | 'proxy_changed' | 'detect_suite_failed'
                 | 'consistency_block' | 'duplicate_exit_ip' | 'manual';
```

### 7.1 Loại sự kiện sức khỏe (`health_events.type`)

| Type | Nguồn | Mức | Ghi chú |
|---|---|---|---|
| `manual.upload` | manual | info | Người vận hành upload tay |
| `manual.verification_request` | manual | red | Nền tảng yêu cầu xác minh |
| `manual.captcha` | manual | red | |
| `manual.platform_warning` | manual | red | Cảnh báo từ nền tảng |
| `manual.logged_out` | manual | red | Bị đăng xuất ngoài ý muốn |
| `manual.note` | manual | info | |
| `fury.profile_opened` / `fury.profile_closed` | fury | info | Từ bộ theo dõi trạng thái (SPEC-02 §7) |
| `fury.version_changed` | fury | warn | Phát hiện phiên bản Fury mới |
| `proxy.country_changed` / `proxy.asn_changed` | proxy_check | red | |
| `proxy.check_failed` | proxy_check | warn | |
| `session_check.ok` | session_check | info | |
| `session_check.logged_out` | session_check | red | |
| `session_check.wrong_account` | session_check | red | |
| `session_check.failed` | session_check | warn | Lỗi kỹ thuật, không phải tín hiệu tài khoản |
| `probe.imported` | probe | info | |
| `detect_suite.recorded` | system | info / red | `red` khi kết quả trượt |
| `run.done` / `run.failed` / `run.needs_user` | run | info / warn | |
| `run.challenge` | run | red | Flow gặp CAPTCHA/xác minh |
| `flow.site_changed` | run | warn | Flow không tìm thấy phần tử mong đợi |
| `level.promoted` / `level.demoted` | system | info / warn | |
| `binding.paused` / `binding.resumed` | system | warn / info | |

---

## 8. Schema CSDL

SQLite, `PRAGMA journal_mode=WAL; foreign_keys=ON`. Cột thời gian kiểu TEXT ISO 8601. Cột `*_json` kiểu TEXT chứa JSON đã kiểm qua Zod.

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE settings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL,
  old_json TEXT, new_json TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE bindings (
  id TEXT PRIMARY KEY,                       -- ab_
  platform TEXT NOT NULL, account_id TEXT NOT NULL, display_name TEXT NOT NULL,
  fury_profile_id TEXT NOT NULL UNIQUE,
  market_country TEXT NOT NULL,              -- ISO 3166-1 alpha-2
  pack_config_json TEXT NOT NULL DEFAULT '{}',
  allowed_roots_json TEXT NOT NULL DEFAULT '[]',
  level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 3),
  level_since TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
  UNIQUE (platform, account_id));

CREATE TABLE binding_pauses (
  id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES bindings(id),
  reason TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, cleared_at TEXT, cleared_by TEXT);   -- 'user' | 'system'
CREATE INDEX ix_pauses_open ON binding_pauses(binding_id) WHERE cleared_at IS NULL;

CREATE TABLE level_changes (
  id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES bindings(id),
  from_level INTEGER NOT NULL, to_level INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('promote','demote')),
  reason TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE health_events (
  id TEXT PRIMARY KEY, binding_id TEXT REFERENCES bindings(id),   -- NULL = sự kiện toàn hệ thống
  type TEXT NOT NULL, severity TEXT NOT NULL, source TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE INDEX ix_events_binding_time ON health_events(binding_id, occurred_at);

CREATE TABLE proxy_checks (
  id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES bindings(id),
  ok INTEGER NOT NULL, exit_ip TEXT, country TEXT, city TEXT, timezone TEXT,
  asn INTEGER, asn_org TEXT, asn_type TEXT,    -- isp|residential|mobile|hosting|unknown
  latency_ms INTEGER, error TEXT, checked_at TEXT NOT NULL);

CREATE TABLE asn_attestations (                -- người vận hành xác nhận loại ASN khi không tự phân loại được
  asn INTEGER PRIMARY KEY, asn_type TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL);

CREATE TABLE probe_results (
  id TEXT PRIMARY KEY, binding_id TEXT NOT NULL REFERENCES bindings(id),
  fury_version TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('manual_import','flow')),
  captured_at TEXT NOT NULL, data_json TEXT NOT NULL,          -- NormalizedProbe (SPEC-02 §6.3)
  raw_path TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE detect_suite_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fury_version TEXT NOT NULL,
  binding_id TEXT REFERENCES bindings(id),     -- NULL = áp cho mọi profile của phiên bản này
  passed INTEGER NOT NULL, summary TEXT, recorded_at TEXT NOT NULL);

CREATE TABLE account_checklists (
  binding_id TEXT PRIMARY KEY REFERENCES bindings(id),
  account_region TEXT, channel_country TEXT, account_language TEXT,
  recovery_email_hmac TEXT, recovery_phone_hmac TEXT,
  twofa_enabled INTEGER, exclusive_login_confirmed INTEGER, studio_language_set INTEGER,
  confirmed_at TEXT, expires_at TEXT, updated_at TEXT NOT NULL);

CREATE TABLE host_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, os TEXT NOT NULL, os_version TEXT NOT NULL,
  gpus_json TEXT NOT NULL, displays_json TEXT NOT NULL, ram_mb INTEGER NOT NULL, captured_at TEXT NOT NULL);

CREATE TABLE consistency_rules (
  id TEXT PRIMARY KEY,                         -- A1.exit_country_matches_market
  layer TEXT NOT NULL, severity TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  params_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);

CREATE TABLE consistency_runs (
  id TEXT PRIMARY KEY, trigger TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT);

CREATE TABLE consistency_results (
  run_id TEXT NOT NULL REFERENCES consistency_runs(id),
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  rule_id TEXT NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL,
  actual_json TEXT, expected_json TEXT, hint TEXT,
  PRIMARY KEY (run_id, binding_id, rule_id));

CREATE TABLE jobs (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, flow_id TEXT NOT NULL,
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  idempotency_key TEXT NOT NULL, input_json TEXT NOT NULL,
  mode TEXT,                                   -- 'L2' | 'L3' | NULL (flow không có chế độ)
  status TEXT NOT NULL, result_json TEXT, error_code TEXT, error_detail_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (client_id, idempotency_key));

CREATE TABLE runs (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
  binding_id TEXT NOT NULL REFERENCES bindings(id),
  flow_id TEXT NOT NULL, flow_version TEXT NOT NULL,
  status TEXT NOT NULL, current_step TEXT, attempt INTEGER NOT NULL DEFAULT 1,
  checkpoint_json TEXT, needs_user_json TEXT,
  launched_by_run INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  error_code TEXT, error_detail_json TEXT, artifacts_dir TEXT);

CREATE TABLE run_steps (
  run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL, attempts INTEGER NOT NULL, started_at TEXT, finished_at TEXT, error_code TEXT,
  PRIMARY KEY (run_id, seq));

CREATE TABLE schedules (
  id TEXT PRIMARY KEY, flow_id TEXT NOT NULL, target_json TEXT NOT NULL,
  days_of_week TEXT NOT NULL,                  -- '1234567'
  window_start TEXT NOT NULL, window_end TEXT NOT NULL,   -- 'HH:MM' giờ địa phương
  params_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT, last_run_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE clients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_prefix TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL, flow_filter_json TEXT NOT NULL DEFAULT '["*"]',
  binding_filter_json TEXT NOT NULL DEFAULT '["*"]', rate_limit_per_min INTEGER NOT NULL DEFAULT 120,
  created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY, actor_type TEXT NOT NULL,   -- user | client | system
  actor_id TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
```

Quy tắc chung:
- `health_events`, `level_changes`, `audit_events`, `settings_history` chỉ **thêm**, không sửa/xóa (trừ dọn theo `retention.dataMonths`).
- Binding "đang bị dừng" = có ít nhất một dòng `binding_pauses` với `cleared_at IS NULL`.
- Migration bằng Drizzle; mỗi migration có số thứ tự; app từ chối chạy nếu CSDL mới hơn mã.

---

## 9. Mã lỗi dùng chung

Mọi lỗi trả qua API hoặc ghi vào job/run dùng mã dưới đây. Pack được khai thêm mã riêng dạng `<PACK>_<NAME>` (ví dụ `YOUTUBE_PROCESSING_STUCK`).

| Mã | Ý nghĩa | Thử lại? |
|---|---|---|
| `INPUT_INVALID` | Dữ liệu vào sai schema | Không |
| `UNAUTHORIZED` / `FORBIDDEN_SCOPE` | Thiếu token / thiếu quyền | Không |
| `RATE_LIMITED` | Vượt giới hạn gọi | Có, sau `retryAfter` |
| `FURY_OFFLINE` | Không gọi được Fury | Có |
| `FURY_VERSION_UNSUPPORTED` | Phiên bản Fury ngoài khoảng hỗ trợ | Không |
| `FURY_CAPABILITY_MISSING` | Fury không cung cấp năng lực cần thiết | Không |
| `ACCOUNT_NOT_BOUND` | Không có binding cho tài khoản | Không |
| `BINDING_PAUSED` | Binding đang bị dừng | Có, sau khi gỡ dừng |
| `LEVEL_TOO_LOW` | Mức binding thấp hơn mức tối thiểu của flow | Không |
| `FLOW_NOT_FOUND` / `FLOW_DISABLED` | Flow không tồn tại / pack bị vô hiệu (lỗi lint, sai phiên bản) | Không |
| `DAILY_LIMIT_REACHED` | Đạt giới hạn upload/ngày của tài khoản | Có, ngày sau |
| `DUPLICATE_JOB` | Trùng `idempotency_key` | Không (dùng job cũ) |
| `DUPLICATE_SUSPECTED` | Phía nền tảng có vẻ đã có nội dung này | Không, người quyết định |
| `FILE_NOT_ALLOWED` / `FILE_NOT_FOUND` / `FILE_CHANGED` | File ngoài thư mục cho phép / không có / sai hash | Không |
| `PROFILE_BUSY` | Profile bị mở ngoài ProfileVault quá thời gian chờ | Có |
| `SESSION_EXPIRED` | Phiên đăng nhập hết hạn | Không, cần người |
| `WRONG_ACCOUNT` | Đang đăng nhập/chọn sai tài khoản | Không, cần người |
| `CHALLENGE` | CAPTCHA / xác minh | Không, cần người |
| `SITE_CHANGED` | Giao diện nền tảng đổi, không tìm thấy phần tử | Không, cần sửa flow |
| `UPLOAD_REJECTED` | Nền tảng từ chối nội dung/file | Không |
| `FORBIDDEN_ACTION` | Flow cố thao tác bị cấm (đặt công khai…) | Không |
| `INTERRUPTED` | Run bị ngắt ở bước không thể chạy lại tự động | Không, cần người |
| `TIMEOUT` | Quá thời gian (run hoặc chờ người) | Tùy |
| `CANCELLED` | Bị hủy | — |
| `INTERNAL` | Lỗi không lường trước | Có, tối đa 1 lần |

Định dạng lỗi trên API: `{ "error": { "code": "LEVEL_TOO_LOW", "message": "…", "detail": { … } } }`.

---

## 10. Bus sự kiện nội bộ

Các package giao tiếp trong tiến trình qua một `EventBus` có kiểu (EventEmitter + Zod). Sự kiện chính:

| Sự kiện | Phát bởi | Nghe bởi |
|---|---|---|
| `health.event_recorded` | health | dashboard (SSE), notifier |
| `binding.level_changed` | health | runner (hủy run vượt mức), dashboard |
| `binding.pause_changed` | health | runner, jobs |
| `run.status_changed` | runner | jobs, health, dashboard, notifier |
| `run.needs_user` | runner | notifier, dashboard |
| `fury.status_changed` | fury-client poller | health, runner |

Dashboard nhận cập nhật thời gian thực qua Server-Sent Events `GET /internal/stream` (SPEC-05).

---

## 11. Đóng gói và cài đặt

- Phân phối dạng thư mục gồm `node.exe` (Node 22) + mã đã build + dashboard tĩnh; trình cài đặt NSIS tạo lối tắt và khóa tự khởi động `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- Lần chạy đầu: tạo thư mục §5, khởi tạo CSDL, sinh khóa HMAC, ghi luật nhất quán và ngưỡng mặc định, mở dashboard trang "Kết nối Fury".
- Một phiên bản chạy tại một thời điểm (khóa file `%APPDATA%\ProfileVault\service.lock`).
