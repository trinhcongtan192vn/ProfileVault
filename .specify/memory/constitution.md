# ProfileVault Constitution

## Core Principles

### I. `docs/` là nguồn sự thật
`docs/profilevault-prd.md`, `docs/profilevault-agent-architecture.md`, `docs/specs/SPEC-00…09` và
`docs/specs/SPIKE-ke-hoach.md` là nguồn sự thật. Mã nguồn và mọi tài liệu Spec Kit
(`specs/NNN-*/spec.md`, `plan.md`, `tasks.md`) PHẢI khớp `docs/`; khi khác nhau, `docs/` thắng.
Muốn đổi một quyết định trong `docs/` thì PHẢI sửa file trong `docs/` và ghi vào
`docs/decisions.md` (ngày, quyết định, lý do). Mục đánh dấu **[SPIKE-Pn]** PHẢI được cài theo
giao diện/hợp đồng trong spec với giả lập, phần chưa chắc đặt sau adapter có `TODO(SPIKE-Pn)`;
KHÔNG ĐƯỢC đoán định dạng dữ liệu thật của Fury rồi viết cứng.

### II. TypeScript strict, Zod ở `packages/contract`
Mọi package dùng TypeScript `strict`. Mọi dữ liệu vào/ra (API, job, flow input/output, sự kiện,
cấu hình, payload JSON trong CSDL) PHẢI định nghĩa bằng Zod trong `packages/contract`; kiểu
TypeScript suy ra từ Zod, không định nghĩa kiểu trùng ở nơi khác.

### III. Fury là tiến trình riêng, chỉ qua `FuryClient`
Fury (AGPL) là tiến trình riêng. Mọi package chỉ gọi Fury qua giao diện `FuryClient`
(`packages/fury-client`); KHÔNG ĐƯỢC nhúng mã Fury, KHÔNG ĐƯỢC gọi HTTP tới Fury từ nơi khác.
Ngoại lệ duy nhất về cài đặt: khi máy chưa có Fury, ProfileVault tự cài **bản đã ghim** (bộ cài +
core tải từ GitHub release chính thức, kiểm SHA-256 và kích thước trước khi chạy; SPEC-00 §11.1).
Ngoài việc đó ProfileVault không khởi động, nâng cấp, gỡ hay sửa cấu hình profile trong Fury.

### IV. Không giữ bí mật của profile; bí mật riêng qua DPAPI
ProfileVault KHÔNG ĐƯỢC nhận, lưu hay log cookie, mật khẩu, thông tin đăng nhập proxy.
Bí mật của chính nó (token Fury, khóa HMAC, token client, khóa LLM) PHẢI lưu qua Windows DPAPI
trong `secrets.bin`. Email/số khôi phục trong checklist chỉ lưu dạng HMAC-SHA256. Log và audit
KHÔNG ĐƯỢC chứa bí mật, nội dung trang hay giá trị checklist gốc.

### V. Gateway chỉ loopback
Gateway PHẢI bind địa chỉ loopback (mặc định `127.0.0.1:50410`) và từ chối khởi động nếu
host không phải loopback. PHẢI từ chối request có `Host` khác `127.0.0.1:<port>` /
`localhost:<port>`. KHÔNG bật CORS; request có `Origin` khác origin của Gateway → 403.

### VI. Không bao giờ đặt công khai; thao tác chỉ qua `ctx.ui`
Không có flow, tool hay endpoint nào đặt nội dung công khai hoặc hẹn giờ công khai. Flow chỉ
thao tác trang qua `ctx.ui` (kiểm danh sách cấm theo accessible name, kiểm domain theo
`manifest.site`); linter `tools/eslint-plugin-pv` PHẢI chặn thao tác thô (`locator.click()`,
`page.keyboard`, …) và chuỗi cấm ở mọi pack, chính thức lẫn người dùng; pack lỗi lint →
`FLOW_DISABLED`.

### VII. L0 không CDP; Runner chỉ chạy trên profile do nó mở
Binding ở L0 KHÔNG BAO GIỜ bật CDP. Runner kiểm `binding.level ≥ flow.minLevel` ngay trước khi
mở profile, chỉ chạy trên profile do chính nó mở qua `FuryClient.launch({ cdp: true })`, và
PHẢI đóng profile khi run kết thúc ở mọi trạng thái; CDP chỉ bật trong lúc chạy.

### VIII. Hành động chỉ dành cho người chỉ có trên dashboard
Lên mức, gỡ dừng có lý do do người gỡ (R1, R2, R7), xác nhận checklist tài khoản, xác nhận loại
ASN, nhập detect-suite, sửa ngưỡng/luật, tạo/thu hồi token, trả lời gate L2 chỉ có qua phiên
dashboard. KHÔNG có tool MCP hay endpoint `/api/v1` nào làm các việc này. Lên mức chỉ khi đạt
ngưỡng và người xác nhận; cờ đỏ tự hạ mức và dừng job ≤ 1 phút.

### IX. Health service chỉ báo và chặn
Health service (gồm kiểm tra độ nhất quán) chỉ ghi nhận, đánh giá, báo và chặn; KHÔNG BAO GIỜ
tự sửa cấu hình profile hay gọi API ghi nào tới Fury. Mọi outcome trượt có gợi ý sửa tiếng Việt.

### X. Mọi feature có test; không merge khi test đỏ
Mỗi feature PHẢI có test theo SPEC-09 (unit cho hàm thuần; integration với SQLite thật, FakeFury,
đồng hồ giả; flow với fixture HTML; API qua Gateway thật). Toàn bộ lint + test PHẢI xanh trước
khi commit feature. Không test nào gọi Fury thật hay YouTube thật trong CI.

### XI. Tài liệu tiếng Việt, identifier tiếng Anh
Tài liệu, thông điệp cho người dùng, gợi ý sửa, nhãn dashboard: tiếng Việt. Identifier, tên
bảng/trường, mã lỗi, tên file mã nguồn: tiếng Anh. Thời gian lưu UTC ISO 8601.

## Ràng buộc kỹ thuật

Stack cố định theo SPEC-00 §3: TypeScript, Node.js 22 LTS, pnpm workspace, Fastify 5,
`@modelcontextprotocol/sdk` (M1), SQLite qua `better-sqlite3` + Drizzle, Zod, Playwright
(`chromium.connectOverCDP`), React + Vite + Recharts + TanStack Query/Table, `systray2`,
`node-notifier`, DPAPI (`@primno/dpapi`), `argon2` + HMAC-SHA256, OpenTelemetry, Vitest,
Playwright Test. Cấu trúc repo theo SPEC-00 §4; ID theo SPEC-00 §6; enum §7; schema CSDL §8;
mã lỗi §9; bus sự kiện §10. Thêm dependency ngoài stack chỉ khi cần thiết và PHẢI ghi lý do
vào `docs/decisions.md`.

## Quy trình phát triển

Mỗi feature đi qua `/speckit-specify` → `/speckit-clarify` (trả lời từ `docs/`; câu `docs/`
không trả lời → chọn phương án nhất quán với kiến trúc, ghi vào `docs/progress.md` mục
"Giả định khi triển khai") → `/speckit-plan` (không đổi stack) → `/speckit-tasks` →
`/speckit-analyze` (sửa mâu thuẫn trước khi code) → `/speckit-implement` ↔ `/speckit-converge`
tới khi xong → lint + test xanh → commit `feat(NNN): <tên>` → cập nhật `docs/progress.md`.
Commit nhỏ; không commit `secrets.bin`, CSDL, artifact run. Test không gọi Fury thật hay mạng
(dùng FakeFury, bộ cài giả); trong phiên phát triển không truy cập YouTube. Fury thật chỉ được
cài/chạy trên máy cho spike do người vận hành làm.

## Governance

Constitution này đứng trên mọi quy ước khác trong repo nhưng dưới `docs/`: nếu một nguyên tắc
ở đây mâu thuẫn `docs/`, sửa constitution. Sửa đổi PHẢI kèm cập nhật tương ứng trong `docs/`
(và `docs/decisions.md` nếu đổi quyết định) và tăng phiên bản theo semver: MAJOR khi bỏ/định
nghĩa lại nguyên tắc, MINOR khi thêm nguyên tắc hoặc mở rộng đáng kể, PATCH khi sửa câu chữ.
`/speckit-plan` và `/speckit-analyze` PHẢI kiểm tra tuân thủ từng nguyên tắc; vi phạm MUST là
CRITICAL và phải sửa spec/plan/tasks, không được làm mềm nguyên tắc.

**Version**: 2.0.0 | **Ratified**: 2026-10-14 | **Last Amended**: 2026-10-14
