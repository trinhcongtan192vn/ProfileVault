# Nhật ký quyết định (thay đổi với `docs/`)

Ghi mọi lần một quyết định trong `docs/` bị đổi khi triển khai, và mọi dependency thêm ngoài stack SPEC-00 §3. Định dạng: ngày · quyết định · lý do · file `docs/` đã sửa.

| Ngày | Quyết định | Lý do | File đã sửa |
|---|---|---|---|
| 2026-10-14 | Giữ tên file `docs/profilevault-prd.md` và `docs/profilevault-agent-architecture.md` (yêu cầu triển khai gọi là `docs/prd.md`, `docs/architecture.md`) | Hai file tham chiếu chéo nhau bằng tên hiện tại; đổi tên không thêm giá trị. CLAUDE.md và progress.md ghi rõ ánh xạ | — |
| 2026-10-14 | Thêm gói `packages/core` (`@sctech/profilevault-core`) vào cấu trúc repo | `fury-client`, `health`, `gateway` cần SecretStore/EventBus/Clock/config; package không import được từ `apps/service`; `contract` chỉ nên chứa schema (SPEC-00 §2) | `docs/specs/SPEC-00-nen-tang.md` §4 |
