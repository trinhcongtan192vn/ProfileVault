# SPEC-09 — Kiểm thử

**Phiên bản:** 1.0 · **Ngày:** 14/10/2026 · **Giai đoạn:** M-1 → M2 · **Nguồn:** PRD §12; SPEC-01 → SPEC-08

## 1. Mục đích

Định nghĩa các lớp kiểm thử, môi trường, công cụ giả lập, và ánh xạ tiêu chí nghiệm thu PRD sang test cụ thể. Không có test nào chạy upload trên kênh thật.

## 2. Lớp kiểm thử

| Lớp | Phạm vi | Công cụ | Khi chạy |
|---|---|---|---|
| Unit | Hàm thuần: điều kiện ngưỡng, luật nhất quán, chuẩn hóa probe, chọn giờ lịch, kiểm file, băm checklist | Vitest | Mỗi commit |
| Integration | Service + SQLite thật (file tạm) + `FakeFury` + Runner với flow giả | Vitest | Mỗi commit |
| Flow (fixture) | Flow chạy trên trang HTML giả lập màn hình nền tảng, Chromium thường | Playwright Test | Mỗi commit |
| API | REST + MCP qua Gateway thật, client mẫu từ contract package | Vitest + `@modelcontextprotocol/sdk` client | Mỗi commit |
| Contract | Bộ test của `@sctech/profilevault-contract` | Vitest | Mỗi commit; app gọi chạy với server của họ |
| Live | Fury thật + kênh test | Playwright + script | Hằng ngày/tuần, khi nâng Fury, khi nâng pack |
| Nghiệm thu | Kịch bản §6 | Thủ công có checklist + test tự động tương ứng | Cuối mỗi giai đoạn |

## 3. Công cụ giả lập

### 3.1 `FakeFury`
HTTP server trong `packages/fury-client/test/fake-fury.ts`, cài đặt cùng hợp đồng HTTP mà adapter Fury dùng (API Fury 0.3.22 đã xác minh ở SPIKE-P2; thêm route chỉ cho test `/v1/test/check-exit` qua `TEST_ENDPOINT_MAP` vì Fury chưa có kiểm exit):
- Danh sách profile, cấu hình persona/múi giờ/ngôn ngữ chỉnh được theo kịch bản.
- Trạng thái mở/đóng; giả lập "người đang mở profile".
- `launch` khởi một Chromium thường có CDP và trả endpoint; `stop` đóng nó.
- `checkExit` trả kết quả theo kịch bản (đổi quốc gia, đổi ASN, lỗi, trùng IP giữa hai profile).
- Phiên bản Fury đổi được để test R5 và khoảng hỗ trợ.

### 3.2 Đồng hồ giả
Health service và Scheduler nhận `Clock` qua DI; test dùng đồng hồ giả để chạy nhanh cửa sổ 14/30 ngày, khung giờ ngẫu nhiên (seed cố định), hết hạn checklist.

### 3.3 Trang giả lập nền tảng
`packs/<pack>/flows/<flow>/test/fixtures/*.html`: tái hiện cấu trúc ngữ nghĩa (role, accessible name) của các màn hình cần thiết, có biến thể: đăng xuất, challenge, sai kênh, phần tử bị đổi tên (để kiểm `SITE_CHANGED`), nút "Publish" (để kiểm `FORBIDDEN_ACTION`). Fixture cập nhật khi locator đổi.

### 3.4 Probe mẫu
`packages/health/test/probes/`: file capture thật lấy ở **[SPIKE-P3]** (đã xóa thông tin định danh), cộng biến thể: múi giờ lệch, WebRTC lộ IP, voices macOS, hash đổi cùng phiên bản, nâng Fury chỉ đổi phiên bản, nâng Fury đổi thêm GPU.

## 4. Live test

| Test | Môi trường | Tần suất | Đạt khi |
|---|---|---|---|
| `fury-detect gate` | Fury thật, profile test | Khi Fury ra bản mới (trước khi nâng) | Gate xanh |
| `youtube/session-check` | Kênh test ở L1 | Hằng ngày | `logged_in`, đúng kênh, `studioLanguageOk` |
| `youtube/upload` L3 | Kênh test ở L3 | Hằng tuần; khi nâng Fury; khi sửa pack | Video riêng tư 10 giây, đúng metadata, đọc đúng `videoId` |
| `youtube/upload` L2 | Kênh test ở L2 | Khi sửa pack | Dừng đúng trước Save; read-back sau gate |
| `generic/probe` | Profile test | Khi nâng Fury; khi sửa flow | Import được, E2 pass |

Live test chạy qua Job service bằng client `test-harness`, ghi vào dashboard như job thường. Video test xóa tay hằng tháng. Kênh test không bao giờ dùng chung profile, proxy, email khôi phục với kênh thật (luật D1–D5 kiểm cả kênh test).

## 5. Contract test
- Mỗi endpoint/tool của `profilevault/v1`: request hợp lệ, request sai schema, thiếu scope, ngoài bộ lọc, trùng idempotency, các mã lỗi 422 (§3 SPEC-06).
- Chạy được ở hai chế độ: với server giả lập trong package (cho app gọi phát triển offline) và với ProfileVault thật.

## 6. Ánh xạ nghiệm thu PRD §12

### M-1
| ID | Kịch bản | Loại |
|---|---|---|
| AT-M-1-1 | 3 upload riêng tư bằng script trên kênh test, đúng `videoId`, không cảnh báo trong 7 ngày | Live (spike P4) |
| AT-M-1-2 | Đọc được cấu hình persona/múi giờ/ngôn ngữ từ Fury | Live (P2) |
| AT-M-1-3 | Xuất và đọc được file probe đủ trường bắt buộc | Live (P3) |
| AT-M-1-4 | Lấy được trạng thái mở/đóng profile | Live (P2) |

### M0
| ID | Kịch bản | Loại |
|---|---|---|
| AT-M0-1 | Gắn 2 kênh ở L0 qua wizard | Integration + thủ công |
| AT-M0-2 | Khai báo sự kiện hiện trên dòng thời gian (SSE) | API + thủ công |
| AT-M0-3 | Kiểm proxy theo lịch; đổi quốc gia → hạ một mức + toast | Integration (FakeFury, đồng hồ giả) |
| AT-M0-4 | Giả lập đủ điều kiện → "Lên mức" sáng; lên L1 → session-check được lập lịch | Integration |
| AT-M0-5 | Khai báo CAPTCHA → về L0, dừng, run chờ bị hủy, ≤ 1 phút | Integration |
| AT-M0-6 | Xuất CSV khớp CSDL | API |
| AT-M0-7 | Múi giờ lệch exit → A2 fail, "Lên mức" tắt, có gợi ý | Unit + integration |
| AT-M0-8 | Hai binding cùng exit IP → cả hai về L0; đổi một bên → tự gỡ | Integration |
| AT-M0-9 | Nhập probe hai lần cùng phiên bản → E2 pass | Unit |
| AT-M0-10 | Checklist thiếu → C3 fail, không rời L0 | Unit |
| AT-M0-11 | Profile đang mở khi tới lượt → `waiting_profile` | Integration |
| AT-M0-12 | Pack dùng `locator.click()` → bị vô hiệu | Unit (lint) |
| AT-M0-13 | Lịch 3 binding → 3 thời điểm khác nhau trong khung; chạy bù sau khi tắt 3 giờ | Unit (đồng hồ giả) |
| AT-M0-14 | Request với `Host` lạ bị từ chối; mã `/auth/open` dùng lại bị từ chối | API |

### M1
| ID | Kịch bản | Loại |
|---|---|---|
| AT-M1-1 | Kênh test L2: dừng trước Save, người bấm, nhận `videoId`, ghi `l2Review` | Live |
| AT-M1-2 | Kênh test L3: 5 job liên tiếp `done`; gửi lại cùng `idempotencyKey` không trùng | Live + API |
| AT-M1-3 | Tắt tiến trình giữa bước idempotent → tiếp tục; giữa bước 3 → `needs_user` (`INTERRUPTED`) | Flow (fixture) + Integration |
| AT-M1-4 | Job cho kênh L1 → `LEVEL_TOO_LOW` | API |
| AT-M1-5 | App mock gửi qua MCP với token scope hẹp; tool ngoài quyền không hiện | API |
| AT-M1-6 | Flow bấm "Publish" → `FORBIDDEN_ACTION` | Flow (fixture) |
| AT-M1-7 | File đổi sau khi gửi → `FILE_CHANGED`; upload thứ 11/ngày → `DAILY_LIMIT_REACHED` | API |
| AT-M1-8 | `generic/probe` chạy theo lịch, import được | Live |

### M2
| ID | Kịch bản | Loại |
|---|---|---|
| AT-M2-1 | Hỏi "kênh nào đủ điều kiện lên mức" qua Claude → khớp dashboard | Thủ công |
| AT-M2-2 | Đẩy 3 video lên kênh L3 qua Claude → 3 `videoId` | Thủ công + Live |
| AT-M2-3 | Yêu cầu lên mức qua Claude → bị từ chối, có đường dẫn dashboard | Thủ công |
| AT-M2-4 | `flow-author` tạo flow đọc tiêu đề 5 video gần nhất, lint sạch, chạy xanh trên kênh test | Thủ công + Live |

## 7. Tiêu chí phát hành mỗi giai đoạn
- Toàn bộ unit/integration/flow/API/contract xanh.
- Live test của giai đoạn xanh trong 3 lần chạy liên tiếp.
- Mọi kịch bản nghiệm thu của giai đoạn đạt.
- Không có cảnh báo đỏ từ nền tảng trên kênh test trong 7 ngày trước phát hành.
