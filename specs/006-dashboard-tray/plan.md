# Implementation Plan: Dashboard, tray, toast (006)

**Branch**: `006-dashboard-tray` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

## Summary

SPA React 19 + Vite 8 trong `apps/dashboard`, dữ liệu qua `/internal/*` (005) + SSE; thêm 3 endpoint tổng hợp/undo ở gateway; tray + toast trong `apps/service`.

## Technical Context

TypeScript 5.9 · react 19.3, react-dom 19.3, react-router-dom 7, @tanstack/react-query 5, @tanstack/react-table 8 (API ổn định; v9 mới đổi API), recharts 3, vite 8 + @vitejs/plugin-react 6 · systray2 2.1, node-notifier 11 · Test: Vitest node + `react-dom/server`.

## Constitution Check

| Nguyên tắc | Trạng thái |
|---|---|
| II Zod/contract | Dashboard chỉ `import type` từ contract; schema tổng hợp mới ở `contract/src/dashboard.ts` | PASS |
| IV bí mật | Checklist không hiển thị lại; token client hiển thị một lần | PASS |
| VIII người | Lên mức/gỡ dừng/xác nhận/ASN/detect-suite/token/luật chỉ trên dashboard | PASS |
| X test | logic + SSR + tray/notifier | PASS |
| XI ngôn ngữ | UI tiếng Việt | PASS |

## Project Structure

```text
packages/contract/src/dashboard.ts          # OverviewRow, InboxItem
packages/health  (undoManualEvent; event_count bỏ sự kiện bị hoàn tác)
packages/gateway/src/routes/dashboard.ts    # /internal/overview, /internal/inbox, undo
apps/dashboard/
├── package.json  tsconfig.json  vite.config.ts  index.html  vitest.config.ts
├── src/main.tsx  App.tsx  styles.css
├── src/lib/{api,sse,format,labels,events,query}.ts
├── src/components/{TopBar,LevelBadge,ConfirmDialog,EventMenu,Toast,Tabs,DataTable,Charts,ConsistencyTable,ChecklistForm,ProbeDrop}.tsx
├── src/pages/{Overview,BindingDetail,NewBinding,Inbox,Jobs,RunDetail,System,Schedules,Settings}.tsx
└── test/{format,events,sse-map,render}.test.ts(x)
apps/service/src/{tray,tray-icons,notifier,autostart,open-browser}.ts  test/{tray,notifier}.test.ts
```

## Thiết kế chính
- **Build**: root `build` = `tsc -b && pnpm --filter @sctech/profilevault-dashboard build`; dashboard bỏ khỏi `tsconfig.json` references (DOM lib/JSX riêng), `typecheck` riêng bằng `tsc --noEmit -p apps/dashboard`.
- **ESLint**: override `apps/dashboard/**` dùng `apps/dashboard/tsconfig.json`, globals browser.
- **SSE → cache**: `health.event_recorded` → `['events', bindingId]`, `['overview']`, `['readiness', bindingId]`, `['inbox']`; `binding.*` → overview/binding/pauses/readiness/inbox; `run.*` → jobs/runs/inbox/system; `fury.status_changed` → fury/system.
- **Tray**: `TrayBackend` interface (`setMenu`, `onClick`, `setIcon`, `kill`); `Systray2Backend` dùng `systray2`; `TrayController.refresh()` mỗi 15 s và khi có sự kiện bus.
- **Notifier**: `notify({ title, message, url })` tiêm; dedupe theo `title|message` 30 phút (Clock); bấm toast → mở URL (`/auth/open?code=…&next=<đường dẫn>`).
- **`/auth/open?next=`**: redirect tới `next` nếu là đường dẫn nội bộ bắt đầu `/` (cho toast mở đúng trang).
