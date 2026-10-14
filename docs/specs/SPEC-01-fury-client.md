# SPEC-01 — FuryClient

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M0 · **Yêu cầu PRD:** F3, F9 · **Phụ thuộc:** SPEC-00

## 1. Mục đích

Lớp duy nhất trong ProfileVault nói chuyện với Fury. Mọi package khác gọi `FuryClient`, không gọi Fury trực tiếp. Khi Fury đổi API hoặc spike P2 chốt nguồn dữ liệu khác, chỉ package `fury-client` thay đổi.

## 2. Nguyên tắc

- Fury là tiến trình riêng; `FuryClient` không khởi động, cài đặt hay nâng cấp Fury.
- Không nhận, không lưu, không log bí mật của profile (cookie, mật khẩu, thông tin đăng nhập proxy). Chỉ giữ token automation API của Fury (qua DPAPI).
- Chỉ đọc cấu hình profile; **không** sửa cấu hình profile trong Fury (tạo profile do người vận hành hoặc skill làm qua Fury).
- Mọi phương thức có timeout và trả lỗi theo mã SPEC-00 §9.

## 3. Giao diện

```ts
interface FuryClient {
  health(): Promise<FuryHealth>;
  listProfiles(): Promise<FuryProfileSummary[]>;
  getProfile(profileId: string): Promise<FuryProfileDetail>;
  getStatus(profileId: string): Promise<FuryProfileStatus>;
  launch(profileId: string, opts: { cdp: true }): Promise<FuryLaunchResult>;
  stop(profileId: string): Promise<void>;
  checkExit(profileId: string): Promise<ExitInfo>;
  capabilities(): Promise<FuryCapabilities>;
}

type FuryHealth = { reachable: boolean; version?: string; supported: boolean; checkedAt: string };

type FuryProfileSummary = {
  id: string; name: string; tags: string[];
  personaId?: string;            // id persona trong danh mục Fury
  osFamily?: 'windows' | 'macos' | 'other';
};

type FuryProfileDetail = FuryProfileSummary & {
  persona?: {
    platform: string; userAgent?: string; gpuRenderer?: string;
    screen?: { width: number; height: number }; hardwareConcurrency?: number; deviceMemory?: number;
  };
  seed?: string;                 // seed nhiễu (nếu Fury cho đọc)
  timezone?: string;             // IANA, hoặc 'auto'
  languages?: string[];
  geolocation?: { mode: 'off' | 'auto' | 'manual'; lat?: number; lon?: number };
  webrtcMode?: string;
  proxyRef?: string;             // định danh proxy trong Fury, không chứa thông tin đăng nhập
};

type FuryProfileStatus = { open: boolean; via?: 'app' | 'api' | 'mcp' | 'unknown'; since?: string };

type FuryLaunchResult = { cdpEndpoint: string; sessionRef: string };

type ExitInfo = {
  ok: boolean; ip?: string; country?: string; city?: string; timezone?: string;
  asn?: number; asnOrg?: string; asnType?: 'isp' | 'residential' | 'mobile' | 'hosting' | 'unknown';
  latencyMs?: number; error?: string; checkedAt: string;
};

type FuryCapabilities = Record<
  'listProfiles' | 'getStatus' | 'launchCdp' | 'stop' | 'profileConfig' | 'seed' | 'checkExit' | 'asnType',
  'native' | 'fallback' | 'missing'
>;
```

Trường tùy chọn (`?`) có thể thiếu tùy nguồn; nơi dùng phải xử lý `undefined` thành trạng thái `unknown` (SPEC-02).

## 4. Ánh xạ nguồn (đã xác minh SPIKE-P2 và SPIKE-P5 với Fury 0.3.22)

Automation API của Fury: bật khi `fury-agent serve` có biến môi trường `FURY_API_PORT` (quy ước 35000), chỉ nghe `127.0.0.1`, bearer token trong `<thư mục dữ liệu Fury>/api-token` (`%APPDATA%\Fury` hoặc `FURY_HOME`), từ chối request có `Origin`. Phản hồi `{ ok: true, data }`; lỗi `{ error, message }` (400 khi từ chối thao tác, 401 token, 403 Origin/Host, 404 route). Chỉ có 6 endpoint.

| Năng lực | Nguồn | Loại |
|---|---|---|
| `health` / phiên bản | `GET /v1/status` → `data.version` | native |
| `listProfiles` | `GET /v1/profiles` → `id`, `name`, `tags`, `persona_id` (OS suy từ tiền tố, vd `win11-…`) | native |
| `getStatus` | `running` của hàng trong `GET /v1/profiles`; không biết mở qua app hay API (`via: unknown`) | fallback |
| `launch` (CDP) | `POST /v1/profiles/start` `{ id, cdp: true }` → `data.ws_endpoint`, `data.pid`; không có `ws_endpoint` (team server cấm CDP) → `FURY_CAPABILITY_MISSING` | native |
| `stop` | `POST /v1/profiles/stop` `{ id }` | native |
| `getProfile` | Hàng trong `GET /v1/profiles` + `GET /v1/personas` (`os`, `gpu`, `screen` "W×H"). `timezone`/`languages` `null` = theo quốc gia exit (để trống). Geolocation: `overrides.geolocation {latitude, longitude}` → manual, không có → auto. `overrides.screen/gpu/cores/memory_gb` thắng persona. Chỉ lấy `proxy_id`, bỏ đối tượng `proxy` | fallback |
| `seed` | `fp_seed` (i64 — vượt `Number.MAX_SAFE_INTEGER`, đổi sang chuỗi trước khi parse JSON) | native |
| `checkExit` | API công khai không có (IPC `proxies.check` của app cần URL proxy có mật khẩu). Thay bằng **tra exit** (`config.fury.exitLookup`, mặc định ipinfo.io như Fury): profile không proxy (`proxy_id` null) → tra IP của máy; có proxy → `GET /v1/proxies`, chỉ đọc `id`, `last_ip`, `last_country`, `last_timezone` (bỏ host/username/password khi parse), rồi tra `last_ip` từ máy (không đi qua proxy). Không có `last_ip` → `ok: false, error: EXIT_UNKNOWN`; dịch vụ tra lỗi → `LOOKUP_FAILED` | fallback |
| `asnType` | Nguồn tra miễn phí chỉ có số ASN + tên (`org: "AS3320 …"`), không có loại → `unknown`, người xác nhận ở Cài đặt → ASN (`asn_attestations`) | missing |

Không có bằng chứng (`FURY_CAPABILITY_MISSING`, `EXIT_UNKNOWN`, `LOOKUP_FAILED`): lần kiểm ghi `ok = false` và **không** phát `proxy.check_failed`. Giới hạn: với profile có proxy, exit chỉ mới bằng lần Fury kiểm proxy gần nhất (Fury ghi `last_ip` khi người bấm kiểm proxy trong app hoặc lần mở đầu tiên); đổi exit âm thầm của proxy xoay chỉ thấy sau khi Fury kiểm lại. Tra exit gửi IP tới dịch vụ tra (giống Fury); tắt bằng `config.fury.exitLookup = null`. Giao diện §3 giữ nguyên.

## 5. Kết nối và cấu hình

- Địa chỉ: `config.fury.apiBaseUrl` (thiếu `FURY_API_PORT` → 35000). Token: token người dùng lưu ở Cài đặt (`secrets.bin`) nếu có, không thì đọc file `api-token` của Fury mỗi lần gọi (không lưu, không log).
- Trang "Kết nối Fury" trên dashboard (SPEC-07) cho nhập token, kiểm `health()`, hiển thị `capabilities()`.
- Timeout: `health` 3 s; `listProfiles`/`getProfile`/`getStatus` 5 s; `checkExit` 30 s; `launch` 60 s; `stop` 15 s.
- Thử lại: chỉ với lỗi mạng/5xx, tối đa 2 lần, backoff 1 s → 3 s. Không thử lại `launch` nếu không chắc profile chưa mở (gọi `getStatus` trước).

## 6. Phiên bản Fury

- Khoảng hỗ trợ: `config.fury.supportedVersions` (semver range).
- Ngoài khoảng → `health().supported = false`; mọi lệnh `launch` trả `FURY_VERSION_UNSUPPORTED`; dashboard hiện cảnh báo đỏ. Các thao tác chỉ đọc vẫn chạy.
- Bộ theo dõi (§7) phát hiện phiên bản đổi → ghi sự kiện `fury.version_changed` (SPEC-00 §7.1) và Health service xử lý theo SPEC-02 §5.

## 7. Bộ theo dõi trạng thái (poller)

Chạy trong tiến trình nền:

| Việc | Chu kỳ | Kết quả |
|---|---|---|
| `health()` | 60 s | Phát `fury.status_changed` khi reachable/version đổi |
| `getStatus()` cho mọi profile có binding | 5 phút | Phát sự kiện `fury.profile_opened`/`closed` khi đổi trạng thái (dùng cho nhắc khai báo, SPEC-07 §6) |

Fury offline: poller giữ trạng thái cuối, không sinh sự kiện mở/đóng giả; dashboard hiện "Fury offline".

## 8. Lỗi

| Tình huống | Mã |
|---|---|
| Không kết nối được, timeout `health` | `FURY_OFFLINE` |
| 401/403 từ Fury | `FURY_OFFLINE` kèm `detail.reason = "auth"` (dashboard nhắc nhập lại token) |
| Phiên bản ngoài khoảng | `FURY_VERSION_UNSUPPORTED` |
| Năng lực `missing` được gọi | `FURY_CAPABILITY_MISSING` |
| Profile không tồn tại | `ACCOUNT_NOT_BOUND` khi gọi qua binding; `INPUT_INVALID` khi gọi trực tiếp |

## 9. Kiểm thử

- `FakeFury` (HTTP server giả lập hành vi đã ghi nhận ở spike) cho unit/integration test — SPEC-09 §3.
- Test hợp đồng: mỗi năng lực `native` có test chạy với Fury thật trên máy dev (tag `@fury-live`).
