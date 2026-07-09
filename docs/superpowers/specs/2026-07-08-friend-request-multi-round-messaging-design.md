# 好友申请多轮留言 — 设计文档

日期：2026-07-08
状态：设计已确认（待实现计划）
涉及仓库：`circle_be`（后端）+ `circle-im`（前端）

## 1. 需求

加好友申请目前只有单向「附言」（`Friend.message` 一条）。要做到：**申请双方在「接受/拒绝」前可多轮文字留言往来**，对方**接受后这些留言写入两人 OpenIM 会话、成为聊天首屏历史**。

约束/前提：
- 申请双方**还不是好友**，走不了 OpenIM 聊天（需要好友关系），所以留言走 **REST 异步**：一方发出 → 通知提醒对方 → 对方进来看到并可回复。不是实时聊天。
- **纯文本**（v1 不做图片，与微信验证消息一致）。
- **防刷软限制**：对方尚未回复前，发起方最多连发 5 条；对方一回复即解除。

## 2. 数据模型（circle_be / Prisma）

新增 `FriendRequestMessage`：

```prisma
model FriendRequestMessage {
  id        String   @id @default(uuid())
  requestId String   // → Friend.id（那条好友关系/申请记录）
  senderId  String   // → User.id
  content   String   // 纯文本
  createdAt DateTime @default(now())

  request Friend @relation(fields: [requestId], references: [id], onDelete: Cascade)
  sender  User   @relation(fields: [senderId], references: [id], onDelete: Cascade)

  @@index([requestId, createdAt])
}
```

- 创建好友申请时，把首条附言同时写入本表首条（线程的唯一来源）。`Friend.message` 保留做兼容/快照，不再是渲染源。
- `Friend`（既有）挂 `messages FriendRequestMessage[]` 反向关系。
- 迁移用 `prisma migrate`（注意仓库已知问题：`migrate dev` 因历史迁移的 shadow DB 报错，用 `migrate deploy`；见 project_backend_prisma_migrate 记忆）。

## 3. 后端端点（friend 模块）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/friend/requests/:id/messages?page=` | 拉线程（分页，asc）。**仅该请求的双方**可读（`Friend.userID`/`friendID` 之一 = 当前用户），否则 404。 |
| POST | `/friend/requests/:id/messages` `{content}` | 追加一条。**仅 `state=PENDING`** 允许；发送者必须是双方之一。校验防刷软限制。成功后给对方发**通知**。 |

- **防刷校验**：若发送者是发起方（`Friend.userID`）、且线程里对方（`friendID`）**还没发过任何一条**，则发起方已发条数 ≥ 5 时拒绝（`errorCode: FriendRequestMessageLimit`，前端映射友好文案）。对方回复后计数解除。
- **通知**：复用现有通知系统，新增类型 `FRIEND_REQUEST_MESSAGE`。`toUserId` = 对方，`content` = 留言摘要。点击落地到好友申请详情页（`push-notification-route` / `snackbar-route` 增加该类型 → `getFriendActivityDetailHref`）。
- 输入校验：`content` trim 后非空、长度上限（如 500）。

## 4. 接受时写入聊天（复用现成 OpenIM 发消息路径）

现状：`friend.service` 在 accept 时已通过 OpenIM 发一条「问候语」（`friend_request_accepted`，见 friend.service.ts:457-498 区）。**复用同一路径**：

- accept 事务提交后，按 `createdAt` 顺序取出该请求的整条 `FriendRequestMessage`，逐条以**各自 senderID** 注入两人新建的 OpenIM 会话 → 成为聊天首屏历史。
- 保持原「问候语」行为不变，或放在留言历史之后。
- 失败降级：注入历史是 best-effort，失败不能让 accept 失败（accept 已是 best-effort 触发多条 OpenIM 调用）。

⚠️ 已知取舍：OpenIM 发消息用**服务器时间**，历史留言会以「接受那一刻的一批」按原顺序出现，而非各自原始时间戳。可接受（否则要 hack sendTime）。

## 5. 前端（circle-im）

### 5.1 数据层
`services/api/friends.ts` 增：
- `fetchFriendRequestMessages(requestId, page)` → `FriendRequestMessage[]`
- `sendFriendRequestMessage(requestId, content)` → `void`（失败抛 `ApiError`，`FriendRequestMessageLimit` 走 `getApiErrorMessage`）
- 类型 `FriendRequestMessage { id; senderId; content; createdAt; }`

### 5.2 UI：`FriendActivityDetailScreen`
- 现「附言」单条区 → **留言列表**（气泡：自己右/对方左，含时间）+ **底部输入框**（text-only）。
- `state=PENDING` 时可发；已 ACCEPTED/REJECTED/WITHDRAWN 时只读展示历史。
- 拉取：进入即拉一次；发送后本地乐观追加 + 后端确认。
- 新留言经**通知**触发（用户点通知进来会重新拉），v1 不做主动轮询/实时。
- 双侧对称：`REQUEST_RECEIVED`（接收方）与 `REQUEST_SENT`（发起方）详情都用这套列表+输入框。

### 5.3 通知落地
`push-notification-route.ts` / `snackbar-route.ts` / 通知中心点击：`FRIEND_REQUEST_MESSAGE` → 好友申请详情页。

## 6. 单元/边界（实现时补测）
- 后端：拉/发权限（非双方 404）、非 PENDING 拒发、防刷软限制（发起方连发 5 条上限、对方回复后解除）、accept 注入历史。
- 前端：`friends.ts` 新 API（源读断言，遵循 project_frontend_test_convention）、路由映射断言（`FRIEND_REQUEST_MESSAGE` → 详情页）。

## 7. 明确不做（YAGNI）
- 实时聊天/输入中状态/已读回执（非好友阶段不需要）。
- 图片/语音/表情等富媒体（v1 纯文本）。
- 主动轮询（靠通知驱动刷新）。

## 8. 分块（便于实现计划拆分）
1. 后端：模型 + 迁移 + 端点 + 防刷 + 通知类型。
2. 后端：accept 注入 OpenIM 历史。
3. 前端：数据层 API + 类型。
4. 前端：详情页留言列表 + 输入框（双侧对称）。
5. 前端：通知类型落地路由 + i18n（5 语言）。
