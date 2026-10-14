# SPEC-03 — Flow contract, Runner và lịch chạy

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M0 · **Yêu cầu PRD:** F9, F10, F11 · **Phụ thuộc:** SPEC-00, SPEC-01, SPEC-02

## 1. Mục đích

Định nghĩa cách viết flow (pack, manifest, `FlowContext`), cách Runner chạy flow trên profile Fury an toàn (hàng đợi, giới hạn, CDP, checkpoint, chờ người), cách lịch chạy hoạt động, và linter chặn thao tác bị cấm.

## 2. Flow pack

### 2.1 Cấu trúc

```
packs/<pack>/
  pack.json
  flows/<flow>/index.ts
  flows/<flow>/test/            # kịch bản test (SPEC-09)
  data/                         # bảng phụ (selector theo ngôn ngữ, chữ ký…)
```

### 2.2 `pack.json`

```json
{
  "id": "youtube",
  "version": "1.0.0",
  "platform": "youtube",
  "appApi": "^1.0.0",
  "furyVersions": ">=0.2.21 <0.4.0",
  "bindingConfigSchema": "./binding-config.schema.json",
  "forbiddenActions": ["./data/forbidden.json"],
  "flows": ["session-check", "upload"]
}
```

- `appApi`: khoảng phiên bản Flow contract mà pack tương thích. Không tương thích → pack bị vô hiệu (`FLOW_DISABLED`), dashboard hiện lý do.
- `bindingConfigSchema`: JSON Schema cho `bindings.pack_config_json` của binding thuộc nền tảng này (ví dụ ngôn ngữ Studio).
- `forbiddenActions`: danh sách nhãn/thao tác bị cấm cho nền tảng (§7).

Pack `generic` có `platform: "*"`; flow của nó chạy cho mọi binding, nhận cấu hình từ pack nền tảng (§2.4 SPEC-04).

## 3. Flow manifest

```ts
const manifest = defineFlow({
  id: 'youtube/upload',
  version: '1.0.0',
  description: 'Upload video lên YouTube Studio, để riêng tư',
  minLevel: 2,
  modes: ['L2', 'L3'],                  // tùy chọn; không khai = flow một chế độ
  site: ['studio.youtube.com'],         // domain flow được phép điều hướng tới
  input: UploadInput,                   // Zod
  output: UploadOutput,                 // Zod
  errors: ['YOUTUBE_PROCESSING_STUCK'], // mã riêng của pack
  timeoutMinutes: 60,
  countsAsUpload: true,                 // tính vào giới hạn upload/ngày
});
```

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `minLevel` | Có | Mức binding tối thiểu (SPEC-02 §2) |
| `modes` | Không | Có `L2` → flow phải có một bước đánh dấu `final: true` (§4.3) |
| `site` | Có | Điều hướng ra ngoài danh sách → `FORBIDDEN_ACTION` |
| `timeoutMinutes` | Có | Tính từ lúc `running`, không tính thời gian `needs_user` |

## 4. FlowContext

```ts
export async function run(ctx: FlowContext<UploadInput>): Promise<UploadOutput> { … }

interface FlowContext<I> {
  input: I;
  mode: 'L2' | 'L3' | null;
  binding: { id: string; platform: string; accountId: string; marketCountry: string; packConfig: object };
  page: Page;                                   // tab mới trong context có sẵn của profile
  state: Record<string, unknown>;               // dữ liệu giữ qua checkpoint (JSON hóa được)

  step<T>(name: string, fn: () => Promise<T>, opts?: StepOptions): Promise<T>;
  ui: SafeUi;                                    // §4.2 — mọi thao tác lên trang đi qua đây
  humanGate(gate: HumanGate): Promise<GateResult>;
  fail(code: string, message: string, detail?: object): never;
  log(msg: string, data?: object): void;
  artifact(name: string, data: Buffer | string): Promise<string>;
  ai?: AiHelper;                                 // M3, chỉ dùng trong bước fragile
}

type StepOptions = {
  idempotent?: boolean;      // mặc định true
  retry?: number;            // mặc định 1 nếu idempotent, 0 nếu không
  final?: boolean;           // bước cuối (chỉ một bước); ở chế độ L2 Runner chèn humanGate trước bước này
  fragile?: boolean;         // cho phép ctx.ai (M3)
  timeoutSeconds?: number;   // mặc định 120
};
```

### 4.1 Bước (`step`)
- Mỗi bước có tên duy nhất trong flow. Runner ghi `run_steps` (bắt đầu, kết thúc, số lần thử, mã lỗi).
- Bước thành công → lưu checkpoint `{ stepIndex, state }` vào `runs.checkpoint_json`.
- Bước lỗi:
  - `ctx.fail(code)` hoặc lỗi có mã → không thử lại nếu mã thuộc nhóm "Không" ở SPEC-00 §9.
  - Lỗi khác (timeout Playwright, lỗi mạng) → thử lại theo `retry`, sau đó `SITE_CHANGED` nếu lỗi là không tìm thấy phần tử, ngược lại `INTERNAL`.
- Khi lỗi: chụp ảnh màn hình và lưu Playwright trace của bước vào artifact.

### 4.2 Thao tác an toàn (`ctx.ui`)

```ts
interface SafeUi {
  goto(url: string): Promise<void>;                          // kiểm domain theo manifest.site
  click(target: Locator, expect?: Expectation): Promise<void>;
  fill(target: Locator, value: string, opts?: { typing?: boolean }): Promise<void>;
  check(target: Locator): Promise<void>;
  select(target: Locator, value: string): Promise<void>;
  press(key: string): Promise<void>;
  upload(target: Locator, filePath: string): Promise<void>;  // chỉ file đã được Job service xác minh
  read(target: Locator): Promise<string>;
  waitFor(target: Locator, opts?: { state?: 'visible' | 'hidden'; timeoutSeconds?: number }): Promise<void>;
  exists(target: Locator, timeoutSeconds?: number): Promise<boolean>;
}
type Expectation = { visible?: Locator; urlMatches?: RegExp; valueEquals?: string };
```

- Trước `click`/`check`/`select`/`press Enter`: lấy accessible name + text của phần tử, so với danh sách cấm (§7); khớp → `FORBIDDEN_ACTION`, run thất bại, sự kiện audit.
- `click` có `expect` → chờ kỳ vọng thành hiện thực (hậu kiểm); không thành → lỗi bước.
- Độ trễ tự nhiên: mỗi thao tác chờ ngẫu nhiên 300–1200 ms trước khi thực hiện; `fill` với `typing: true` gõ từng ký tự 40–140 ms. Tham số chỉnh ở `settings.runner.humanize`.
- Pack **không được** gọi trực tiếp `locator.click()`, `page.keyboard`, `page.mouse`, `locator.fill()`… (linter §7.2).

### 4.3 Chờ người (`humanGate`)

```ts
type HumanGate = {
  reason: 'review_before_final' | 'session_expired' | 'challenge' | 'wrong_account' | 'duplicate_suspected' | 'custom';
  message: string;                                 // tiếng Việt, hiển thị trên dashboard/toast
  choices: { id: string; label: string }[];        // ví dụ [{id:'continue',...},{id:'cancel',...}]
  keepProfileOpen: boolean;                        // true: người thao tác trong cửa sổ profile
};
type GateResult = { choice: string; note?: string; resolvedAt: string };
```

- Run chuyển `needs_user`, ghi `runs.needs_user_json`, phát `run.needs_user`, toast có liên kết tới run.
- Người chọn trên dashboard (hoặc qua API admin) → run tiếp tục với `GateResult`.
- Quá `config.runner.humanGateTimeoutHours` → run `failed` (`TIMEOUT`), đóng profile nếu run mở.
- **Chế độ L2:** Runner tự chèn gate `review_before_final` ngay trước bước `final` với hai lựa chọn: `done_correct` ("Đúng hết, tôi đã bấm") và `done_fixed` ("Phải sửa tay rồi mới bấm"), cùng `cancel`. Bước `final` **không chạy** ở L2; flow nhận `GateResult` qua `ctx.state.l2Result` để đọc kết quả sau khi người đã bấm (ví dụ đọc `video_id`). Lựa chọn được ghi vào kết quả run (SPEC-02 §3.4).

## 5. Runner

### 5.1 Hàng đợi
- Mỗi job có đúng một run đang hoạt động. Run lưu trong `runs`, trạng thái theo `RunStatus` (SPEC-00 §7).
- Vòng lặp lập lịch mỗi 2 giây chọn run `queued` theo thứ tự `queued_at`, bỏ qua run có binding đang có run khác ở trạng thái `launching | running | needs_user | finalizing`.

### 5.2 Giới hạn đồng thời
`maxConcurrent = min(máy bận ? maxConcurrentBusy : maxConcurrentIdle, floor(RAM trống MB / ramPerProfileMb))`, tối thiểu 0.

"Máy bận" khi một trong: CPU trung bình 1 phút > 60%; RAM trống < 8 GB; người vận hành bật "Chế độ bận" trên tray. Run đếm vào giới hạn ở các trạng thái `launching | running | needs_user | finalizing` (profile đang mở).

### 5.3 Kiểm tra trước khi mở profile
Theo thứ tự, ngay trước khi chuyển `launching`:
1. Fury `health().supported` → nếu không: giữ `queued`, thử lại mỗi 60 s; quá 30 phút → `failed` (`FURY_OFFLINE` / `FURY_VERSION_UNSUPPORTED`).
2. Binding không bị dừng → nếu dừng: `cancelled` (`BINDING_PAUSED`).
3. `binding.level ≥ flow.minLevel` → nếu không: `cancelled` (`LEVEL_TOO_LOW`).
4. Pack còn hợp lệ (lint, phiên bản) → nếu không: `failed` (`FLOW_DISABLED`).
5. `FuryClient.getStatus(profile).open == false` → nếu đang mở: `waiting_profile`, hỏi lại mỗi 60 s; quá `profileBusyTimeoutMinutes` → `failed` (`PROFILE_BUSY`).

Runner **chỉ chạy trên profile do chính nó mở** (đảm bảo CDP chỉ bật trong lúc chạy và không chen vào phiên người đang dùng).

### 5.4 Vòng đời CDP **[SPIKE-P4]**
1. `FuryClient.launch(profile, { cdp: true })` → `cdpEndpoint`; ghi `launched_by_run = 1`.
2. `chromium.connectOverCDP(cdpEndpoint)`; dùng `browser.contexts()[0]` (context có sẵn chứa phiên đăng nhập); tạo tab mới làm `ctx.page`.
3. Chạy flow.
4. Kết thúc (mọi trạng thái kết thúc, kể cả lỗi/hủy/timeout): đóng tab của flow → ngắt kết nối Playwright → `FuryClient.stop(profile)` → xác nhận `getStatus().open == false` (tối đa 15 s, sau đó ghi cảnh báo).
5. Gate có `keepProfileOpen: true`: giữ profile và kết nối mở trong lúc chờ.

### 5.5 Khôi phục sau khi tiến trình tắt
Khi khởi động, với mọi run ở `launching | running | finalizing`:
- Nếu profile còn mở và `launched_by_run = 1` → đóng profile.
- Bước đang chạy dở `idempotent = true` → run về `queued`, tiếp tục từ checkpoint (chạy lại bước đó), `attempt + 1`.
- Bước đang chạy dở `idempotent = false` → run `needs_user` với gate `custom`, mã `INTERRUPTED`, thông điệp nói rõ bước nào bị ngắt và người cần kiểm tra gì trên nền tảng; lựa chọn "Đã kiểm, chạy tiếp từ bước sau" / "Hủy".
- Run ở `needs_user` giữ nguyên; profile đã đóng → khi người chọn tiếp tục, Runner mở lại profile rồi chạy tiếp.

### 5.6 Hủy
`cancel(runId)`: run `queued`/`waiting_profile` → `cancelled` ngay; run đang chạy → đặt cờ hủy, dừng sau bước hiện tại (bước không idempotent được chạy hết); thực hiện bước 4 của §5.4.

### 5.7 Artifact
`%LOCALAPPDATA%\ProfileVault\runs\<runId>\`: `log.ndjson` (luôn), `trace-<step>.zip` và `screenshot-<step>.png` (khi lỗi hoặc khi bật `settings.runner.traceAlways`). Xóa sau `retention.runArtifactsDays`.

### 5.8 Kết quả
- `done`: `output` hợp lệ theo `manifest.output` → ghi vào `jobs.result_json`.
- Mọi kết thúc phát `run.status_changed`; Health service nhận để ghi sự kiện (SPEC-02 §5).

## 6. Kết quả chế độ L2
Run L2 kết thúc `done` khi người chọn `done_correct` hoặc `done_fixed` và bước đọc kết quả sau đó thành công. `jobs.result_json.l2Review = 'correct' | 'fixed'`.

## 7. Thao tác bị cấm

### 7.1 Danh sách cấm
- **Toàn cục** (mọi pack): nhãn/văn bản khớp các mẫu đặt nội dung công khai hoặc hẹn giờ công khai, đa ngôn ngữ, ví dụ `/^(publish|public|schedule|go live|đăng|công khai|lên lịch|veröffentlichen|öffentlich|planen)$/i`; thao tác xóa tài khoản/kênh; trang bảo mật tài khoản (đổi mật khẩu, khôi phục, phiên đăng nhập).
- **Theo nền tảng:** `forbiddenActions` của pack (ví dụ YouTube: lựa chọn hiển thị "Public", lựa chọn "Schedule", nút "Publish").
- Danh sách nằm trong `packages/runner/data/forbidden-global.json` và file của pack; người dùng không sửa được qua dashboard.

### 7.2 Linter (lúc nạp pack)
ESLint plugin `pv` chạy trên mã pack khi nạp (kết quả cache theo hash file):
- `pv/no-raw-interaction`: cấm gọi `.click(`, `.dblclick(`, `.fill(`, `.type(`, `.press(`, `.check(`, `.selectOption(`, `.setInputFiles(`, `page.keyboard`, `page.mouse` ngoài `ctx.ui`.
- `pv/no-forbidden-literal`: cấm chuỗi trong mã khớp danh sách cấm (trừ trong file `data/forbidden.json`).
- `pv/no-eval-page`: cấm `page.evaluate` với chuỗi động (cho phép hàm tĩnh đọc dữ liệu).
- `pv/no-network`: cấm `fetch`, `http`, `child_process`, `fs` ghi file trong pack (đọc file chỉ qua `ctx.ui.upload`).
Pack có lỗi lint → `FLOW_DISABLED`.

### 7.3 Kiểm tra lúc chạy
`ctx.ui` kiểm danh sách cấm theo accessible name thật của phần tử (§4.2); `goto` kiểm domain. Hai lớp này áp cho cả pack chính thức lẫn pack người dùng.

## 8. Lịch chạy

### 8.1 Mô hình
`schedules`: `flowId`, `target` (danh sách `bindingId`, hoặc `{ "furyTag": "…" }`, hoặc `{ "all": true, "platform": "youtube" }`), `days_of_week`, khung `window_start`–`window_end` (giờ địa phương), `params`.

### 8.2 Chọn thời điểm
- Với mỗi ngày hợp lệ, mỗi binding trong target nhận **một thời điểm ngẫu nhiên đều** trong khung (khác nhau giữa các binding), lưu thành job hẹn giờ nội bộ (`next_run_at`).
- Khi tới giờ: tạo job với `client_id = 'scheduler'`, `idempotency_key = '<scheduleId>:<bindingId>:<YYYY-MM-DD>'`.
- Binding dưới `flow.minLevel` hoặc đang dừng: bỏ qua lượt, không báo lỗi.

### 8.3 Chạy bù
Khi tiến trình khởi động: lượt đã lỡ trong 12 giờ qua → chạy sau độ trễ ngẫu nhiên 1–15 phút; lỡ quá 12 giờ → bỏ, tính lượt kế tiếp.

### 8.4 Lịch mặc định (tạo khi binding lên L1)
| Flow | Ngày | Khung |
|---|---|---|
| `youtube/session-check` | Mọi ngày | 07:00–22:00 |
| `generic/probe` | Thứ Hai | 09:00–18:00 (tạo khi flow có mặt, từ M1) |

### 8.5 Tạm dừng toàn cục
Tray "Tạm dừng mọi job": Runner không bắt đầu run mới; run đang chạy chạy hết. Lịch vẫn tạo job nhưng job chờ ở `queued`.

## 9. Giao diện nội bộ

```ts
interface Runner {
  enqueue(job: Job): Promise<Run>;
  cancel(runId: string, actor: string): Promise<void>;
  resolveGate(runId: string, result: { choice: string; note?: string }, actor: 'user'): Promise<void>;
  listFlows(): FlowInfo[];                      // id, version, minLevel, modes, status (enabled/disabled + lý do)
  reloadPacks(): Promise<PackLoadReport>;
  setGlobalPause(paused: boolean): void;
}
interface Scheduler {
  list(): Schedule[]; create(s: ScheduleInput): Schedule; update(id: string, p: Partial<ScheduleInput>): Schedule; remove(id: string): void;
}
```

## 10. Nghiệm thu

| Kịch bản | Mong đợi |
|---|---|
| Profile đang mở trong Fury khi tới lượt session-check | Run `waiting_profile`, chạy khi profile đóng |
| Binding L1 nhận job `youtube/upload` | `LEVEL_TOO_LOW` |
| Flow gọi `ctx.ui.click` vào nút "Publish" | `FORBIDDEN_ACTION`, run thất bại, audit |
| Pack dùng `locator.click()` trực tiếp | Pack bị vô hiệu khi nạp |
| Tắt tiến trình giữa bước idempotent | Khởi động lại → run tiếp từ checkpoint |
| Tắt tiến trình giữa bước không idempotent | Run `needs_user` (`INTERRUPTED`) |
| Lịch 07:00–22:00 cho 3 binding | Ba thời điểm khác nhau trong khung; lỡ lượt 3 giờ → chạy bù |
| Chế độ L2 | Dừng trước bước `final`, profile giữ mở, lựa chọn được ghi vào kết quả |
