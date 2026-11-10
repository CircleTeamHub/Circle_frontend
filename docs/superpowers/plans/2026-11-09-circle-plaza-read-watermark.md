# Circle Plaza Snapshot Read Watermark Implementation Plan

**Goal:** 让圈子广场红点在列表成功刷新后一次性读掉该响应快照内的全部帖子，同时保留快照之后的新帖红点。

**Architecture:** 后端在 feed 查询前读取数据库时间作为 `snapshotAt`，用它限制帖子查询并随响应返回。客户端在成功应用 reset feed 后把该水位提交给 seen 接口；后端以单调、不可越过数据库当前时间的方式推进用户水位，再计算是否仍有更新。状态查询先读取数据库 observedAt，限制 createdAt <= observedAt，并以该时刻判断到期。true/false 状态都携带 observedAt；前端对 HTTP、实时事件和快照使用同一版本门禁，失败回滚不得覆盖更高版本。

**Tech Stack:** NestJS, Prisma/PostgreSQL, class-validator, Expo/React Native, TypeScript, Zustand, Jest

## Global Constraints

- 刷新失败或响应被判定为陈旧时，不提交 seen，不清红点。
- 一次成功的 reset feed 只确认该响应返回的 `snapshotAt`；不使用客户端当前时间。
- feed 的帖子和 count 都使用 `createdAt <= snapshotAt` 的同一范围。
- seen 水位单调前进，并在数据库中 clamp 到 `CURRENT_TIMESTAMP`。
- seen 后在数据库观察水位内仍存在 `createdAt > circlePlazaSeenAt` 的可见新帖时，接口返回并实时广播 `hasUpdate: true`；新路由 seen-through 返回 `{ hasUpdate, changedAt }`，旧 seen 保留空 body / 204。
- 不增加迁移，不改变逐帖/滚动位置状态，不引入通用抽象。
- 每个仓库独立提交；不推送、不创建 PR。

### Task 1: 后端快照与 seen 水位契约

**Files:**
- Modify: `src/circle-plaza/dto/circle-plaza.dto.ts`
- Modify: `src/circle-plaza/circle-plaza.controller.ts`
- Modify: `src/circle-plaza/circle-plaza.controller.spec.ts`
- Modify: `src/circle-plaza/circle-plaza.service.ts`
- Modify: `src/circle-plaza/circle-plaza.service.spec.ts`
- Modify: `src/realtime/realtime.service.ts`
- Modify: `src/realtime/realtime.service.spec.ts`
- Modify: `test/postgres/circle-plaza-update.pg-spec.ts`

1. 先写失败测试：feed 返回数据库 `snapshotAt`，`findMany`/`count` 都带 `createdAt <= snapshotAt`；seen controller 接收 ISO 水位；seen SQL 单调推进且不超过数据库现在；推进后返回并广播实际 `hasUpdate`。
2. 运行聚焦测试，记录预期失败。
3. 最小实现 `PlazaSeenDto`、feed 响应字段、数据库快照查询、受限 feed 查询、单调 seen SQL 和实际未读重算。
4. 运行 service/controller/realtime 单测与 PostgreSQL 聚焦测试（数据库环境不可用时明确记录），再运行 typecheck/build 级验证。
5. 自查 diff 并创建一个后端本地提交。

### Task 2: 前端成功刷新后确认快照

**Files:**
- Modify: `src/services/api/plaza.ts`
- Modify: `src/features/discover/store/use-discover-store.ts`
- Add: `src/features/discover/store/use-discover-store.spec.ts`
- Modify: `src/features/discover/utils/circle-plaza-update.ts`
- Modify: `src/features/discover/utils/circle-plaza-update.spec.tsx`
- Modify: `src/features/discover/components/plaza-feed.tsx`
- Modify: `src/features/discover/components/plaza-feed.spec.tsx`
- Modify: `test/plaza.api.test.js`

1. 先写失败测试：API 透传 `snapshotAt` 并用 body 提交；用真实 Zustand store 验证只有已成功应用的 reset 响应返回水位，刷新失败/陈旧响应返回 `null`；首次加载、tab 点击和下拉刷新都通过统一刷新确认函数。
2. 为确认流程写行为测试：先完成 feed 再调用 seen；feed 失败不清红点也不调用 seen；seen 失败恢复原红点；seen 返回 `hasUpdate: true` 时红点保持/恢复为亮；seen 请求期间实时事件点亮红点后，即使 seen 返回 `hasUpdate: false` 也不得再次清掉。
3. 运行聚焦测试，记录预期失败。
4. 最小实现本地 feed 响应类型、store 返回值、统一 `refreshCirclePlazaUpdate` 流程，并替换页面与 tab 入口的旧先清后拉逻辑。
5. 运行聚焦 Jest/Node 测试、`npm run typecheck` 和 `npm run lint`，自查 diff并创建一个前端本地提交。

### Task 3: 跨仓契约与最终审查

1. 对照接口检查字段名、ISO 格式、请求体和响应 `{ hasUpdate }` 完全一致。
2. 分别运行两个仓库与改动风险相称的测试和静态检查，记录任何环境限制。
3. 生成两个分支的完整 diff 包，做独立最终代码审查；修复所有 Critical/Important 问题并复验。
4. 确认没有临时进程、未提交目标改动或远端变更，汇报两个本地分支、提交和验证结果。
