# Báo cáo spike — mẫu chưa thực hiện

**Trạng thái:** P6 đã chạy và đạt (2026-10-14). P1–P5, P7 chưa chạy. Không xem test FakeFury/fixture là bằng chứng live.
Nguồn kế hoạch: `SPIKE-ke-hoach.md`; hướng dẫn: `../../spikes/README.md`.

| Spike | Bắt đầu/kết thúc | Môi trường/phiên bản | Bằng chứng đã loại bí mật | Kết quả | Adapter/spec cần sửa |
|---|---|---|---|---|---|
| P1 Giữ phiên | — | — | — | Chưa chạy | SPEC-09 |
| P2 API | 2026-10-14 | Fury 0.3.22 (core 155.0.8059.39), Windows 10 Pro 19045, 1 profile test không proxy | Đọc mã nguồn tag v0.3.22 (`agent/src/http.rs`, `ipc.rs`, `store.rs`, `shared-rs/src/overrides.rs`, `desktop/src-tauri/src/agent.rs`); gọi thật `GET /v1/status`, `/v1/profiles`, `/v1/personas` (chỉ đọc, không mở profile) | **Đạt một phần**: 6 endpoint `/v1`, phong bì `{ok,data}`, bật bằng `FURY_API_PORT`, token file `api-token`, không token → 401. Đủ cho health/list/status/launch/stop/getProfile/seed. **Không có** kiểm exit proxy và asnType (→ P5). Phát hiện: `fp_seed` i64 vượt độ chính xác số JS → đọc dạng chuỗi; geolocation ở `overrides`. `launch` CDP chưa gọi (thuộc P4) | `packages/fury-client/src/adapter/endpoint-map.ts`; SPEC-01 §4–5; SPEC-00 §11.1 |
| P3 Probe | 2026-10-15 | Fury 0.3.22, mã nguồn `tools/detect-suite/probe.js`, `probe.html` | Đọc mã nguồn trang probe; viết `furyDetectSuiteConverter` + fixture cùng cấu trúc | **Đạt một phần**: đủ trường bắt buộc của `NormalizedProbe` trừ `furyVersion`/`capturedAt` (lấy từ ngữ cảnh nhập); có hash canvas/WebGL/audio, voices, fonts, WebRTC, nhất quán đa ngữ cảnh. **Còn**: người vận hành xuất capture thật trên profile test, nhập 2 lần cùng phiên bản để kiểm E2 (hash ổn định) | `packages/health/src/probe/converters.ts`; SPEC-02 §6.3 |
| P4 CDP/Studio | — | — | — | Chưa chạy | SPEC-03/04, locators |
| P5 Exit/ASN | — | — | — | Chưa chạy | SPEC-01/02 |
| P6 Host | 2026-10-14, 3 lần liên tiếp | Windows 10 Pro 19045, Node 22.14, không quyền admin | `node spikes/host-check.mjs`: os windows, osVersion 10.0.19045, RAM 32607 MB, GPU "NVIDIA GeForce RTX 5060 Ti", màn hình 1920×1080 primary; 167–176 ms | **Đạt** (đủ trường `host_snapshots`, < 3 s). Phát hiện: `AdapterRAM` báo 4095 MB (trần uint32) cho card 16 GB → bỏ `vramMb` khi chạm trần | `packages/host-info/src/parse.ts`; SPEC-02 §6.2 |
| P7 MCP | — | — | — | Chưa chạy | SPEC-05/08 |

## P2 — Ma trận năng lực (điền sau xác minh)
| Năng lực | Method/endpoint | Request/response schema | Nguồn fallback | native/fallback/missing |
|---|---|---|---|---|
| health | — | — | — | — |
| listProfiles | — | — | — | — |
| getProfile | — | — | — | — |
| getStatus | — | — | — | — |
| launch CDP | — | — | — | — |
| stop | — | — | — | — |
| checkExit | — | — | — | — |

## Kết luận phát hành
Chưa đủ điều kiện phát hành/live. P4 cần ba upload riêng tư và bảy ngày theo dõi;
không bắt đầu M1 trước khi P4 đạt. Mọi TODO chỉ được bỏ khi có bằng chứng tương ứng.
