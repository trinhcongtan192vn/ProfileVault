# Plan 007

TypeScript strict, Node22, Playwright, SQLite/Drizzle, Zod, ESLint, Vitest/Playwright Test theo SPEC-00.

## Cấu trúc
- contract/src/flow.ts: Zod cho dữ liệu runner/pack/checkpoint.
- runner/src/{flow,safe-ui,pack-loader,store,runner,scheduler}.ts; data/forbidden-global.json.
- tools/eslint-plugin-pv/src/index.ts: 4 rule, chạy lúc nạp pack.
- packs/{generic,youtube}/pack.json, flows/session-check/index.ts, data và fixture.
- service bootstrap nạp pack, recover, start/stop; gateway dùng RunnerFacade cấu trúc tương thích.

## Thiết kế
- Store chỉ thao tác 4 bảng hiện có: jobs/runs/run_steps/schedules; checkpoint phiên bản 1.
- Runner tick serialized, reserve profile trước launch, theo dõi promise và đợi shutdown cleanup.
- SafeUi kiểm domain trước/sau điều hướng và thao tác; kiểm accessible name/text, global+pack deny.
- Scheduler lưu slots trong settings transaction với enqueue/idempotency để tránh trùng sau restart.
- Pack loader lint trước import; cache theo hash nội dung; kiểm appApi/Fury range, schema pack.
- Browser connector tiêm được; test dùng Chromium fixture và FakeFury, không mạng ngoài.

## Constitution check
I–XI PASS khi thực hiện các task: docs thắng; schema trong contract; Fury chỉ qua client;
không log secret/page; loopback giữ nguyên; SafeUi+linter; L0 không launch; gate chỉ user;
health chỉ đo; test đủ; tài liệu/UI tiếng Việt. Không thêm dependency ngoài stack.
