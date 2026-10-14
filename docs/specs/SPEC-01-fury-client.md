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

## 4. Ánh xạ nguồn **[SPIKE-P2, SPIKE-P5]**

| Năng lực | Nguồn dự kiến | Bắt buộc ở M0? |
|---|---|---|
| `health` / phiên bản | Endpoint trạng thái của automation API | Có |
| `listProfiles` | Automation API | Có |
| `getStatus` | Automation API | Có |
| `launch` (CDP) | Automation API, tham số bật CDP | Có (session-check ở L1) |
| `stop` | Automation API | Có |
| `getProfile` (cấu hình persona, múi giờ, ngôn ngữ, geolocation) | Automation API; nếu không có: đọc file cấu hình profile trong `fury.dataDir` (chỉ đọc) | Có |
| `seed` | Như trên | Không (luật D3 dùng `unknown` nếu thiếu) |
| `checkExit` | Kiểm exit qua proxy do Fury thực hiện | Có |
| `asnType` | Fury hoặc `.mmdb` cục bộ; nếu không có: `unknown` + xác nhận tay | Không |

Bảng được cập nhật sau spike P2/P5; giao diện §3 giữ nguyên.

## 5. Kết nối và cấu hình

- Địa chỉ: `config.fury.apiBaseUrl`; token bearer đọc từ `secrets.bin`.
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
