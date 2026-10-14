# Research: 003

## R1. Giao dịch + bus
- **Decision**: ghi CSDL trong `db.transaction()` (better-sqlite3 đồng bộ), gom sự kiện bus vào danh sách, phát sau khi commit. Listener lỗi không ảnh hưởng dữ liệu.
- **Rationale**: SPEC-02 §4.3 "xử lý đồng bộ trong cùng giao dịch ghi sự kiện".

## R2. RNG có seed
- **Decision**: `mulberry32` (32-bit) tự cài ~10 dòng; seed = `hash(seedBase, bindingId, YYYY-MM-DD)`.
- **Rationale**: SPEC-09 §3.2 "khung giờ ngẫu nhiên (seed cố định)"; không thêm dependency.

## R3. Giờ địa phương theo `config.ui.timezone`
- **Decision**: `Intl.DateTimeFormat` với `timeZone`, `hourCycle: 'h23'`, `formatToParts`; chuyển "giờ địa phương → UTC" bằng: ước lượng `Date.UTC(y,m,d,H,M)` rồi hiệu chỉnh bằng offset đo được tại thời điểm đó (lặp 2 lần).
- **Rationale**: SPEC-00 §2 hiển thị theo múi giờ máy (mặc định Asia/Bangkok); không thêm `luxon`/`date-fns-tz`.

## R4. Tỉ lệ session-check
- **Decision**: `ok / (ok + logged_out + wrong_account + failed)` trong cửa sổ; `minSamples` chưa đủ → `met:false`, `current` ghi `"9/10 mẫu"`.
- **Rationale**: SPEC-02 §3.2 `session_check_rate { min, minSamples }`; PRD §4 "thành công ≥ 95%".

## R5. Nguồn số liệu run cho ngưỡng
- **Decision**: tính từ `health_events` (`run.done/failed/needs_user`, payload `flowId`, `mode`, `l2Review`), không đọc bảng `runs`.
- **Rationale**: Health không phụ thuộc Runner (007), test độc lập; Runner ghi qua `recordRunOutcome`.

## R6. Phát hiện trùng exit IP ở 003
- **Decision**: sau mỗi `ProxyCheckService.check`, lấy `proxy_checks` `ok` gần nhất của mọi binding chưa archive, nhóm theo `exit_ip`; nhóm ≥ 2 → R3 cho các binding trong nhóm; binding có pause `duplicate_exit_ip` mở mà không còn trong nhóm nào → tự gỡ.
- **Rationale**: SPEC-02 §4.1 R3 "Tự gỡ khi lần kiểm kế tiếp không còn trùng" — lần kiểm = kiểm proxy.
