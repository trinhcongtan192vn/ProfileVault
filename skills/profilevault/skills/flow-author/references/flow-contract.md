# Flow contract (tóm tắt SPEC-03)

## Pack

```
<pack>/
  pack.json            # id, version, platform, appApi "^1.0.0", furyVersions, bindingConfigSchema, forbiddenActions, flows
  src/index.ts         # export const flows = [...]
  src/flows/<flow>.ts
  data/locators.en.json
  data/forbidden.json  # nhãn cấm riêng nền tảng (regex)
  flows/<flow>/test/fixtures/*.html
  dist/index.js        # bản build ProfileVault nạp
```

## Manifest

| Trường | Ý nghĩa |
|---|---|
| `id` | `<pack>/<flow>` |
| `minLevel` | 1 (chỉ đọc) · 2 (có ghi; cần `modes`) |
| `modes` | `['L2','L3']` → bắt buộc đúng một bước `final: true` |
| `site` | domain được điều hướng; ra ngoài → `FORBIDDEN_ACTION` |
| `timeoutMinutes` | tính từ lúc chạy, không tính lúc chờ người |
| `countsAsUpload` | tính vào giới hạn upload/ngày |

## FlowContext

- `ctx.input`, `ctx.mode` (`'L2' | 'L3' | null`), `ctx.binding`, `ctx.state` (giữ qua checkpoint, phải JSON hóa được), `ctx.page` (chỉ để **tạo** locator/đọc), `ctx.fury.probeUrl`.
- `ctx.step(name, fn, { idempotent = true, retry, final, timeoutSeconds = 120 })` — tên duy nhất; bước xong được checkpoint; tắt máy giữa bước idempotent → chạy lại bước đó; giữa bước không idempotent → chờ người (`INTERRUPTED`).
- `ctx.ui` — `goto`, `click(target, expect?)`, `fill(target, value, { typing? })`, `check`, `select`, `press`, `upload(target, path)` (chỉ file Job service đã kiểm, băm lại trước khi tải), `read`, `waitFor`, `exists`. Trước mỗi click/check/select/Enter: so accessible name với danh sách cấm.
- `ctx.humanGate({ reason, message, choices, keepProfileOpen })` → `{ choice, note }`. Lựa chọn `cancel` → run hủy.
- `ctx.fail(code, message, detail)` — mã SPEC-00 §9 hoặc `<PACK>_<NAME>` khai trong `errors`.

## Linter (pack bị vô hiệu nếu vi phạm)

`pv/no-raw-interaction` (`.click(`, `.fill(`, `.type(`, `.press(`, `.check(`, `.selectOption(`, `.setInputFiles(`, `page.keyboard`, `page.mouse`), `pv/no-forbidden-literal`, `pv/no-eval-page` (chỉ `page.evaluate` với hàm tĩnh đọc dữ liệu), `pv/no-network` (`fetch`, `http`, `fs`, `child_process`, `process`, `globalThis`; import ngoài `@sctech/profilevault-contract`, `@sctech/profilevault-runner`).

## Mã lỗi hay dùng

`SITE_CHANGED` (không thấy phần tử mong đợi), `SESSION_EXPIRED`, `CHALLENGE`, `WRONG_ACCOUNT`, `FORBIDDEN_ACTION`, `FILE_CHANGED`, `TIMEOUT`, `INTERRUPTED`.
