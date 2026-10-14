# Tasks: Dashboard, tray, toast (006)

**Tests**: bắt buộc (logic + SSR + gateway + tray/notifier).

## Phase 1: Setup
- [x] T001 `apps/dashboard` package (react, react-dom, react-router-dom, @tanstack/react-query, @tanstack/react-table@8, recharts, vite, @vitejs/plugin-react), `tsconfig.json`, `vite.config.ts`, `index.html`, `vitest.config.ts`; root build/lint cập nhật
- [x] T002 `apps/service` deps `systray2`, `node-notifier` (+ `@types/node-notifier`)

## Phase 2: Foundational (gateway/health/contract)
- [x] T003 `contract/src/dashboard.ts` (`OverviewRowSchema`, `InboxItemSchema`)
- [x] T004 Health `undoManualEvent(bindingId, eventId, actor)` + `event_count` bỏ sự kiện bị hoàn tác; test
- [x] T005 Gateway `routes/dashboard.ts`: `/internal/overview`, `/internal/inbox`, undo; `/auth/open?next=`; test

## Phase 3: US1 — khung SPA + tổng quan + một chạm
- [x] T006 [US1] `src/lib/{api,sse,query,format,labels,events}.ts`
- [x] T007 [US1] `App.tsx` (router 8 trang), `TopBar`, `LevelBadge`, `ConfirmDialog`, `Toast`, `EventMenu`, `DataTable`, `styles.css` (sáng/tối)
- [x] T008 [US1] `pages/Overview.tsx`

## Phase 4: US2 — chi tiết, wizard, Chờ bạn
- [x] T009 [US2] `pages/BindingDetail.tsx` (7 thẻ), `components/{Charts,ConsistencyTable,ChecklistForm,ProbeDrop}.tsx`
- [x] T010 [US2] `pages/NewBinding.tsx` (wizard 6 bước), `pages/Inbox.tsx`

## Phase 5: US3 — hệ thống, lịch, cài đặt, job
- [x] T011 [US3] `pages/{System,Schedules,Settings,Jobs,RunDetail}.tsx`

## Phase 6: US4 — tray + toast
- [x] T012 [US4] `apps/service/src/{tray-icons,tray,autostart,open-browser,notifier}.ts`; nối bootstrap/main
- [x] T013 [US4] Test `apps/service/test/{tray,notifier}.test.ts`

## Phase 7: Test + polish
- [x] T014 Test dashboard `test/{format,events,sse-map,render}.test.ts(x)`
- [ ] T015 `pnpm build && pnpm lint && pnpm test`; chạy dịch vụ thật, mở dashboard kiểm thủ công; cập nhật `docs/progress.md`, quickstart

  Phần tự động đã đạt: build/lint, 255 Vitest + 7 Playwright, dịch vụ thật với FakeFury và wizard/SSE/CSV trong Chromium.
  Còn nghiệm thu desktop Windows: tray/toast hiển thị, bấm toast và autostart qua restart. Không đánh dấu phần thủ công bằng test giả.

## Phase 8: Convergence
- [x] T016 Bổ sung chọn khoảng ngày cho cả 7 biểu đồ theo SPEC-07 §4.2.1 (partial)
- [x] T017 Kiểm thử hoàn tác sai kênh, sự kiện đỏ, quá hạn và lặp; kiểm ngưỡng sau hoàn tác theo FR-007 (partial)
- [x] T018 Đánh giá readiness định kỳ khi dashboard đóng; vô hiệu cache checklist qua SSE theo FR-003/FR-009 (partial)
