# 群管理 + 群日志 设计（2026-09-08）

双仓分支：`feat/group-admin-log`（circle-im / circle_be 同名，跨仓契约测试按同名分支对齐）。

## 1. 现状与问题

- 群有两种：**圈子群**（`ChatConversation.circleID` 非空，角色真值在 `CircleMember`）和
  **独立群聊**（`circleID = null`，成员即 `ChatMember`，群主只有 `ownerID` 一个字段）。
- 「群日志」页现在只是把会话里的 `type='system'` 消息列出来：受清空水位/焚毁影响会消失、
  后入群的人看不到入群前的记录、文案全是被动句（"有成员被移出群聊"）不点名、也没有禁言事件。
- 群设置页的管理动作只存在于**圈子群**成员头像长按菜单（设/撤管理员、移出），入口不可发现；
  **独立群聊**没有任何管理能力：没有管理员角色、不能禁言、不能踢人。

## 2. 目标

1. 群日志 = 独立于聊天记录的**群事件账本**：谁进群/退群/被移出、谁被设为/取消管理员、谁被禁言/解除、
   改群名/公告、清空全群记录、群主转让。所有在座成员可翻，按时间倒序分页。
2. 群设置页新增「群管理」页：设置管理员（群主）、禁言成员（群主/管理员）、移出成员（群主/管理员）。
   两种群共用同一页面，差异只在调用哪套端点。
3. 独立群聊补齐管理员角色与逐人禁言；圈子群补齐逐人禁言。
4. 被禁言的人：发消息被服务端拒绝（新错误码），聊天页输入区显示禁言横幅。

不做：全员禁言的群主开关（现有 `muteAllAt` 仍是管理台能力）、群主转让入口、历史系统消息回填进新表
（测试服无真实数据，迁移保持纯增量）。

## 3. 数据模型（circle_be / prisma）

```prisma
enum ChatMemberRole { MEMBER ADMIN }   // 独立群聊管理员标记；群主看 ChatConversation.ownerID；圈子群忽略此列

model ChatMember {
  role          ChatMemberRole @default(MEMBER)
  /// 禁言（不能发言）。与 muted（免打扰，只影响推送）无关。
  /// silencedAt 非空 = 处于禁言；silencedUntil 空 = 直到解除。
  silencedAt    DateTime?
  silencedUntil DateTime?
}

model ChatGroupEvent {
  id             String   @id @default(uuid())
  conversationID String
  kind           String   // 见 §4
  actorID        String?  // null = 系统/对账
  targetIDs      String[] @default([])
  payload        Json?    // {name} / {role} / {durationSec} / {via:'qr'}
  createdAt      DateTime @default(now())
  conversation   ChatConversation @relation(fields: [conversationID], references: [id], onDelete: Cascade)
  @@index([conversationID, createdAt, id])
}
```

迁移：`20260908000000_add_group_admin_and_event_log`，纯 expand（新枚举、新列带默认值、新表），
蓝绿窗口旧二进制不受影响，不抬 `SCHEMA_COMPATIBILITY`。

词汇约定：代码里 **mute = 免打扰（通知）**，**silence = 禁言（发言）**；仅 `muteAllAt` /
`CHAT_CONVERSATION_MUTED` 是历史遗留，注释里标明。

## 4. 事件种类与写点

| kind | actor | targets | payload | 写点 |
|---|---|---|---|---|
| group-created | 建群人 | 初始成员 | — | createGroupConversation |
| member-joined | 邀请人 / 扫码人 / null(对账) | 入群者 | `{via:'qr'}` 可选 | invite / joinViaQr / 圈子对账 |
| member-left | 本人 | 本人 | — | leave / 圈子退出 |
| member-removed | 操作者 | 被移出者 | — | 独立群踢人 / 圈子群踢人 |
| member-role-changed | 操作者 | 目标 | `{role}` | 独立群设角色 / 圈子群设角色 |
| member-silenced | 操作者 | 目标 | `{durationSec: number\|null}` | 禁言 |
| member-unsilenced | 操作者 | 目标 | — | 解除禁言 |
| owner-transferred | 原群主 | 新群主 | — | 独立群群主退群自动转让 |
| group-renamed | 操作者 | — | `{name}` | 独立群改名 / 圈子改名 |
| group-notice-updated | 操作者 | — | — | 圈子改简介 |
| history-cleared | 操作者 | — | — | 删除所有人的记录 |

事件与系统消息成对写：**在同一事务里**能进事务的（角色/踢人/禁言/圈子改名）进事务；原本
fire-and-forget 的系统提示（进群/退群/改名）事件也以尽力而为方式写，失败只记日志。

新增系统消息 kind：`member-silenced`、`member-unsilenced`、`owner-transferred`（前端
`systemNoticeText` 必须加 case，否则渲染空白气泡）。

## 5. 后端端点（circle_be `ChatController`）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/chat/conversations/:id/events?cursor&limit` | 在座成员；圈子群同成员目录闸（圈主/管理员） | 倒序 keyset，`nextCursor` |
| PATCH | `/chat/conversations/:id/members/:userId/role` `{role:'ADMIN'\|'MEMBER'}` | 独立群群主 | 圈子群 → `CHAT_GROUP_CIRCLE_MANAGED`（走 `/group/...`） |
| DELETE | `/chat/conversations/:id/members/:userId` | 独立群群主/管理员；管理员只能移普通成员 | 离座 + 房间踢出 + `removed` 个人事件 |
| PUT | `/chat/conversations/:id/members/:userId/silence` `{durationSec: int\|null}` | 两种群的群主/管理员；只能对低于自己的角色 | 60s ≤ durationSec ≤ 30d，null = 直到解除 |
| DELETE | `/chat/conversations/:id/members/:userId/silence` | 同上 | 解除 |

授权在**会话行锁之后**读锁后快照（与退群/解散/清空同一锁序），先鉴权再取锁的探测防护
沿用 group.service 的写法。角色变化/禁言变化给目标推 `chat:conversation {kind:'updated'}`，
客户端刷新会话 DTO。

发消息：`sendMessage` 锁外用座位行判断 `silencedAt && (silencedUntil == null || > now)` →
`CHAT_MEMBER_SILENCED`；锁内 `assertStillSendable` 再查一次（座位行已在手）。

独立群聊管理员额外获得与圈子管理员对齐的两项：删除所有人的记录、设置阅后即焚
（`clearHistory` / `setBurnDuration` 的独立群授权从「仅群主」放宽到「群主或管理员」）。
群主退群转让顺序：最早入群的管理员，否则最早入群的成员。

新错误码（`ChatErrorCode`，前端镜像 + 五语种 serverErrors）：
`CHAT_GROUP_MANAGER_ONLY`、`CHAT_GROUP_MEMBER_NOT_FOUND`、`CHAT_GROUP_TARGET_PROTECTED`、
`CHAT_GROUP_SELF_TARGET`、`CHAT_MEMBER_SILENCED`、`CHAT_SILENCE_DURATION_INVALID`。

DTO 变化：`ChatMemberDto` 增 `silenced: boolean; silencedUntil: string|null`，独立群 `role`
从 `ownerID` + `ChatMember.role` 派生（不再永远 null）；`ChatConversationDto` 增本人视角的
`silenced` / `silencedUntil`。

## 6. 前端（circle-im）

- `chat-core/api.ts`：`fetchChatGroupEvents`、`setGroupChatMemberRole`、`removeGroupChatMember`、
  `silenceChatMember`、`unsilenceChatMember`。
- `chat-core/group-events.ts`：`ChatGroupEventDto` → 一行本地化文案（点名：actor / targets 昵称加粗），
  未知 kind 兜底「群聊活动」。`chat-core/silence-durations.ts`：档位表
  10 分钟 / 1 小时 / 6 小时 / 1 天 / 7 天 / 直到解除 + 任意秒数的兜底格式化。
- `GroupLogScreen` 改读 events 端点（cursor 分页），行内显示操作者头像 + 文案 + 时间。
- 新 `GroupManageScreen`（路由 `group-manage` ×4 个 tab 栈 + `routes.ts` 的 `getGroupManageHref`
  + `route-segments`）：三段——群管理员（群主可增删）、禁言中的成员（可解除；可新增：选人 → 选时长）、
  移出群成员（选人 → 确认）。选人用新的 `GroupMemberPickerSheet`（带搜索，过滤掉不可操作的角色）。
- 管理动作统一收进 `useGroupAdminActions` hook（按群类型选端点；圈子群设角色/踢人仍走
  `/group/...`，禁言走 chat 端点），`ChatInfoScreen` 的头像长按菜单与 `GroupManageScreen` 共用。
- `ChatInfoScreen`：独立群聊本人角色从成员目录里取（`ownerId` / `role`），`canManageGroup`
  对独立群生效；新增「群管理」行（群主/管理员可见）；长按菜单加「禁言 / 解除禁言」。
- `ChatDetailScreen`：本人 `silenced` 时输入区上方显示禁言横幅（含解除时间或「直到解除」）。
- 新 kind 的 `systemNoticeText` case；`send-errors` 把 `CHAT_MEMBER_SILENCED` 加入预期内拒绝码。
- i18n 五语种：`chat.groupManage.*`、`chat.silence.*`、`im.notification.*` 新 kind、
  `serverErrors.*` 新码。

## 7. 测试

- BE jest：`chat-group-admin.service.spec.ts`（角色/踢人/禁言权限矩阵、锁后鉴权、圈子群拒绝
  独立群端点）、`chat-group-event.service.spec.ts`（目录闸、cursor 分页、targets 解析）、
  `chat.service.spec` 补发消息被禁言拒绝、迁移 spec（schema ↔ migration 一致）。
- FE node:test：`test/group-admin-log.test.js`（端点/客户端函数/hook 接线/新 kind 有文案/
  路由四栈齐全/跨仓端点存在）；`api-error-localization` 与 `i18n-locale-parity` 自动覆盖新码与新词条。
