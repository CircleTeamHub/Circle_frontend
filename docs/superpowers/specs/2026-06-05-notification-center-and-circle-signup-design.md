# 通知中心 + 圈子帖子报名 — 设计文档

**日期**: 2026-06-05
**仓库**: circle-im (Expo/RN 前端) + circle_be (NestJS 后端)
**参考**: squady (Flutter app) 的 `lib/pages/notification/*` 与 squady-be-notification 的通知接口形态

---

## 1. 目标

从消息页（[MessagesScreen.tsx](../../../src/features/messages/screens/MessagesScreen.tsx)）右上角铃铛点进一个「消息通知」管理页，视觉与交互对齐参考图（squady 通知页）。页面分两栏：

- **互动消息** — 来自 `Notification` 表：朋友圈互动（`TRACE_LIKE` / `TRACE_COMMENT` / `COMMENT_REPLY`）+ `FRIEND_REQUEST_*` + `SQUAD_REQUEST_*` + `SYSTEM`。
- **圈子动态** — 来自 `CircleActivity` 表：现有圈子事件（验证/邀请/管理员审批）**+ 新增的「帖子报名」事件**，按时间混排。

为了让「圈子动态」有报名数据，本期新增一个**圈子帖子报名**功能：任意圈子帖子可被点「报名」，帖子作者与报名者本人都会在「圈子动态」收到事件；帖子卡片底部以**报名数**取代原来的浏览数。

### 关键名词澄清（避免再次混淆）
- **朋友圈 / 动态 = `Trace`**（`TraceType.MOMENT`）：有点赞/评论，产生 `TRACE_*` 通知 → **互动消息**。
- **圈子 = `Circle`**：独立社群实体，有 `CircleActivity`（验证/邀请/审批）feed → **圈子动态**。
- **圈子帖子 = `CirclePost`**：圈子内发的帖子，与朋友圈帖子不同。本期给它加**报名**，报名事件进 `CircleActivity` → **圈子动态**。

---

## 2. 范围（本期四块全做）

1. 报名后端（circle_be）
2. 通知中心后端（circle_be）— 互动消息（Notification）列表/已读/删除 + 圈子动态「全部已读」
3. 通知中心前端（circle-im）— 主交付，图1 界面
4. 帖子报名按钮前端（circle-im）

非目标（明确排除）：圈子帖子的点赞/评论（产品上不做）；圈子动态的滑动删除（`CircleActivity` 无 `deleted` 字段，且参考实现第二栏也无删除）；报名取消的二次通知。

---

## 3. 架构关键决策

**报名事件复用 `CircleActivity` 表**（而非新建独立表 + API 层合并）。
- 给 `CircleActivityType` 增加 `POST_SIGNUP_RECEIVED`（发给作者）、`POST_SIGNUP_CONFIRMED`（发给报名者）。
- 给 `CircleActivity` 增加可空 `postID` + 关系。
- 现有 `GET /circle/activities/list` 自动把报名事件与验证/邀请事件按 `createdAt desc` 混排返回，前端零额外合并逻辑；现有 `unread-count` / `:id/read` / realtime 广播自动覆盖报名事件。

理由：单一 feed、单一已读模型、单一未读计数，最小化新代码与数据死结风险。

---

## 4. 数据模型（circle_be / Prisma）

### 4.1 新模型 `CirclePostSignup`
```prisma
model CirclePostSignup {
  id        String   @id @default(uuid())
  postID    String
  userID    String
  createdAt DateTime @default(now())

  post CirclePost @relation(fields: [postID], references: [id], onDelete: Cascade)
  user User       @relation(fields: [userID], references: [id], onDelete: Cascade)

  @@unique([postID, userID])   // 幂等：一人对一帖只报一次
  @@index([postID])
}
```

### 4.2 `CirclePost` 增量
```prisma
signupCount Int                @default(0)   // 去规范化，列表/卡片快速展示
signups     CirclePostSignup[]
```
（`viewCount` 字段保留，仅前端卡片不再展示。）

### 4.3 `CircleActivityType` 增量
```prisma
POST_SIGNUP_RECEIVED    // 发给帖子作者："X 报名了你的帖子《摘要》"
POST_SIGNUP_CONFIRMED   // 发给报名者本人："你已报名《摘要》"
```

### 4.4 `CircleActivity` 增量
```prisma
postID String?
post   CirclePost? @relation(fields: [postID], references: [id], onDelete: SetNull)
```

迁移：新增一支 prisma migration；`signupCount` 默认 0，存量数据无需回填。

---

## 5. 后端接口（circle_be）

### 5.1 报名（circle-plaza 模块）
| 方法 | 路径 | 行为 |
|---|---|---|
| `POST` | `/circle-plaza/posts/:id/signup` | 幂等创建 `CirclePostSignup`（命中 unique 即视为已报名、不报错）；首次报名时 `signupCount++` 并建两条 `CircleActivity`（作者 `POST_SIGNUP_RECEIVED`、报名者 `POST_SIGNUP_CONFIRMED`，均带 `postID` / `circleID` / `actorID=报名者`）；对两个 viewer 广播圈子未读。返回 `{ signed: true, signupCount }`。 |
| `DELETE` | `/circle-plaza/posts/:id/signup` | 删除报名记录；存在则 `signupCount--`（下限 0）。不删已生成的 activity（保持简单）。返回 `{ signed: false, signupCount }`。 |
| `GET` | `/circle-plaza/posts/:id/signups` | 报名者列表（分页，含 nickname/avatar）。供「谁报名了」详情；卡片只用 count。 |

并发与一致性：报名/取消在 `$transaction` 内完成（写 signup + 改 count + 建 activity）；`signupCount` 自增用 `{ increment/decrement }`。作者就是报名者本人时（自己报名自己帖子）不建 `RECEIVED`，只建 `CONFIRMED`，避免自己给自己发两条。

DTO 改动：`/circle-plaza/feed` 与 `/circle-plaza/posts/:id` 的帖子 DTO 增加 `signupCount: number`、`signedByMe: boolean`（按当前用户是否在 signups 内计算）。

### 5.2 圈子动态 DTO（circle.service `getActivities`）
当 `type ∈ {POST_SIGNUP_RECEIVED, POST_SIGNUP_CONFIRMED}` 时，DTO 附带 `post: { id, excerpt }`（`excerpt` = `content` 截断，因 `CirclePost` 无 title）。其余事件 `post: null`。

### 5.3 圈子动态「全部已读」（circle 模块）
| 方法 | 路径 | 行为 |
|---|---|---|
| `POST` | `/circle/activities/read-all` | `updateMany(viewerID=me, readAt=null) → readAt=now`；count>0 时广播圈子未读。返回 `{ count }`。 |

### 5.4 互动消息（notification 模块，Notification 表）
| 方法 | 路径 | 行为 |
|---|---|---|
| `GET` | `/notification/list?page=N` | `toUserID=me, deleted=false`，时间倒序，分页（每页固定大小，如 20）。DTO 含 `id, type, content, read, createdAt, fromUser{ id, nickname, avatarUrl }, fromTrace{ id, contentExcerpt, firstImage } | null, fromReply{ id, content } | null`。 |
| `PUT` | `/notification/:id/read` | 标单条已读（`toUserID=me` 校验）；广播互动未读。 |
| `PUT` | `/notification/read-all` | `updateMany(toUserID=me, deleted=false, read=false) → read=true`；count>0 广播。返回 `{ count }`。 |
| `DELETE` | `/notification/:id` | 软删 `deleted=true`（`toUserID=me` 校验）；若该条未读则广播。 |

未读广播：复用/扩展现有 `realtimeService`（`broadcastSystemNotificationUnread` 系列 + `broadcastCircleUnreadCount`）。互动消息未读的广播 channel 沿用现有「互动/discover/profile」通道；不混入 IM 会话未读。

权限：所有接口 `JwtGuard` + `toUserID/viewerID === req.user.userId`，越权返回 403/404。

---

## 6. 前端（circle-im）

### 6.1 报名（Part 4）
- [plaza.ts](../../../src/services/api/plaza.ts)：`signupForPost(id): Promise<{signed; signupCount}>`、`cancelSignup(id)`、`fetchPostSignups(id)`。
- `CirclePlazaPost` 类型加 `signupCount: number`、`signedByMe: boolean`。
- [plaza-post-card.tsx](../../../src/features/discover/components/plaza-post-card.tsx) footer：**删除浏览数**（`eye-outline + viewCount`），改为可点的「报名」控件：icon + `signupCount`，已报名态高亮/文案切换；点击乐观更新 + 调接口，失败回滚。`canInteract=false` 时禁用并复用现有受限提示。

### 6.2 通知中心（Part 3）— 新 feature `src/features/notifications/`
```
src/features/notifications/
  screens/NotificationCenterScreen.tsx
  components/
    NotificationTabBar.tsx        // 互动消息 / 圈子动态 + 各自未读红点 + 下划线指示
    ReadFilterBar.tsx             // 全部 / 未读 chip + 「全部已读」按钮（带 spinner，幂等可重点）
    InteractiveNotificationRow.tsx// Notification → 头像行
    CircleActivityRow.tsx         // CircleActivity → 头像行（报名/验证/邀请文案）
    NotificationEmptyState.tsx
  hooks/
    useInteractiveNotifications.ts// list/分页/下拉刷新/乐观标已读+删除
    useCircleActivities.ts        // list/下拉刷新/乐观标已读
  utils/
    notification-summary.ts       // 按 type → 摘要文案 + 图标
    circle-activity-summary.ts
```
- **行视觉统一**：两栏共用图1 头像行（头像 + 未读红点 + 名称 + 时间 + 类型图标 + 一行摘要 + 可选右侧预览图）。两种数据各写「→行属性」适配器；`SYSTEM` 用系统/铃铛头像、正文当摘要、无预览图。
- **交互**：下拉刷新；滑动 — 互动消息=标已读+删除、圈子动态=标已读；点击 — `TRACE_*`/`COMMENT_REPLY` 跳对应朋友圈动态；`FRIEND_REQUEST_RECEIVED` 走现有好友申请流程；报名事件跳对应圈子帖子；`SYSTEM` 就地标已读。
- **筛选**：全部/未读 + 全部已读（互动调 `/notification/read-all`、圈子调 `/circle/activities/read-all`，按当前栏作用）。
- **状态空/错误/加载**：复用参考实现的空态与「未读为空时把过滤器拨回全部」逻辑。

### 6.3 路由 + 入口 + 角标
- 新增 `app/(tabs)/messages/notifications.tsx` → `NotificationCenterScreen`。
- [MessagesScreen.tsx:343](../../../src/features/messages/screens/MessagesScreen.tsx#L343) 铃铛 `onPress` 由 `/(tabs)/discover` 改为 `/(tabs)/messages/notifications`。
- 铃铛角标 = 互动消息未读 + 圈子动态未读（两者皆由 realtime 维护，进 `tabBadgeStore`）。

### 6.4 i18n（[en.json](../../../src/i18n/locales/en.json) / [zh.json](../../../src/i18n/locales/zh.json)）
新增 namespace（如 `notifications.*`）：标题「消息通知」、Tab「互动消息/圈子动态」、筛选「全部/未读/全部已读」、空态文案、各互动 `NotificationType` 摘要模板、各 `CircleActivityType`（含两个报名类型）文案模板、报名按钮「报名/已报名」、帖子卡片相关。

---

## 7. 测试（TDD，沿用仓库 `test/*.test.js` 风格）

**后端（circle_be）**
- 报名：幂等（重复 POST 不重复计数/不重复发事件）、`signupCount` 增减、双 viewer 各一条 activity、自己报自己只发 CONFIRMED、取消减计数、并发（事务）。
- 互动消息：list 分页/排序/越权过滤、单条已读、read-all 计数与幂等、软删与未读广播触发。
- 圈子动态：activities list 含报名事件混排、read-all。

**前端（circle-im）**
- API client：signup/cancel、notification list/read/read-all/delete、activities read-all 的请求形态与错误处理。
- hooks/store：乐观标已读+删除+回滚、分页累加、「未读为空拨回全部」。
- 行适配器：各 `NotificationType` / `CircleActivityType` → 摘要文案 + 图标 + 预览图映射。

覆盖率目标 ≥ 80%。

---

## 8. 实施阶段

1. **报名后端**：prisma 迁移 → signup 接口 + activity 发射 + DTO（含 feed/详情 `signupCount/signedByMe`）+ 测试。
2. **通知中心后端**：Notification list/read/read-all/delete + circle activities read-all + DTO + 测试。
3. **通知中心前端**：feature 目录 + 路由 + 铃铛改向 + 角标 + i18n + 测试（主交付，对齐图1）。
4. **报名按钮前端**：帖子卡片浏览数→报名数 + plaza API + 类型 + 测试。

阶段间可独立验收；③ 是用户主诉求界面，①②为其数据支撑，④独立可后置但本期一并交付。

---

## 9. 风险 / 待澄清

- **报名文案中的帖子标识**：`CirclePost` 无 title，统一用 `content` 摘要；若摘要为空（纯图帖）回退为「图片帖子」类占位文案。
- **未读通道命名**：复用现有互动/圈子未读广播，确认不与 IM 会话未读混淆（沿用 `tabBadgeStore` 既有字段，新增圈子动态字段如已存在则复用）。
- **分页一致性**：互动消息服务端按 type 全量分页；圈子动态沿用现有 `take:100`（暂不分页，量级足够）。
