# 风信助手：信息订阅与笔记状态提醒

**文档类型**：产品 PRD + 开发方案
**产品**：风信 windnote.ai
**版本**：MVP v0.1
**日期**：2026-10-29
**状态**：待产品确认、待后端接口评审

## 1. 背景

风信已经具备消息、圈子/动态、笔记、通知中心和推送能力。用户希望有一个统一的“风信助手”，像一个聊天联系人一样主动告诉自己两类信息：

1. 用户关注的圈子对应城市和主题出现新内容，例如某个圈子绑定了北京，用户希望收到北京的活动、政策或租房信息。
2. 用户添加的他人笔记被作者下架、删除或变为不可访问。

这两个场景的第一版不依赖大模型。信息提醒由订阅规则匹配，笔记提醒由后端状态事件触发；统一通过“风信助手”会话展示，让用户形成稳定的产品心智。后续可以在同一会话中加入自然语言设置、相关性排序和摘要能力。

## 2. 产品目标

- 在消息页提供清晰、低成本的风信助手入口。
- 用户可以在助手会话中查看提醒、管理订阅和暂停提醒。
- 关注信息和笔记状态提醒都能跨设备、跨登录周期保留。
- 助手消息支持站内跳转、原文查看和已读状态。
- 同一事件只发送一次，网络重试、设备重连和后台任务重跑不会重复打扰用户。
- 使用现有的 OpenIM/聊天、推送和通知基础设施，减少新的消息同步系统。

## 3. MVP 范围

### 3.1 信息订阅

MVP 只处理风信站内可控内容，来源包括：

- 广场帖
- 圈子内容
- 朋友圈/动态
- 公开或用户有权限查看的笔记

用户通过当前圈子、主题关键词、内容来源和提醒频率创建订阅。第一版直接复用现有圈子的 `cities` 配置作为城市筛选来源，不新增独立的城市选择器：用户选择哪个圈子，就使用哪个圈子的城市范围。第一版采用圈子城市和关键词匹配，不支持任意网页抓取。外部新闻或网页信息接入作为第二阶段能力，需要单独评估数据源、版权、抓取频率和服务成本。

城市上下文规则：

- 有当前选中的圈子时，订阅默认绑定该圈子，并读取该圈子的 `cities`。
- 没有当前选中的圈子时，助手要求用户先选择一个已加入或自己创建的圈子，不静默使用北京、个人资料城市或上一次无关的筛选城市。
- 圈子的 `cities` 有值时，内容的城市与其任一城市相交才匹配。
- 圈子的 `cities` 为空时，沿用现有圈子“全国/不限定城市”的语义。
- 圈子城市发生变更后，后端按最新圈子配置匹配新内容，并刷新助手订阅卡片中的城市展示。

### 3.2 笔记状态提醒

当用户添加/收藏的来源笔记从 `ACTIVE` 变为 `UNLISTED` 或 `DELETED` 时，向该用户的风信助手会话发送一条提醒。

第一版不对以下状态变化发送助手消息：

- 用户自己编辑自己的笔记
- 来源笔记重新上架
- 仅订单工作状态变化（`WORKING`/`CLOSED`）
- 客户端暂时拉不到笔记但服务端状态没有变化

### 3.3 助手会话

助手会话是一对一的专用系统会话，名称为“风信助手”，头像使用开屏动画中的气泡精灵图标。它不是普通好友，不出现在联系人列表、好友搜索或好友关系中。

推荐复用现有 `SUPPORT` 会话语义和聊天传输，后端为每个用户维护一个专用助手会话。这样可以复用聊天历史、已读水位、离线同步、推送和会话列表能力，同时通过 `assistantKey`/结构化消息类型区分普通客服。

## 4. 用户入口和信息架构

### 4.1 主入口

消息页当前标题栏已经有“一键已读、搜索、增加”等操作。新增一个小按钮：

- 位置：`MessagesScreen` 标题栏右侧操作区，建议放在“一键已读”之前或搜索按钮之前。
- 图标：复用现有 `ChatBubbleIcon`，尺寸约 24–28 px，保持与开屏图标一致。
- 点击区域：至少 40×40 pt，增加 `hitSlop`。
- 无障碍名称：`打开风信助手`。
- 有未读提醒时：图标右上显示小红点或数字徽标。

入口不建议一开始放到每个页面，消息页是用户最容易理解的“主动提醒收件箱”。为了保留圈子上下文，可以在圈子广场标题栏或当前圈子筛选条旁提供同一个入口；从那里打开时直接把当前 `selectedCircleId` 传给助手。

### 4.2 次级入口

用户首次打开助手后，在消息列表顶部固定一个“风信助手”会话行：

- 使用精灵图标作为头像。
- 标题为“风信助手”。
- 预览显示最近一条提醒的摘要。
- 默认置顶，但允许用户取消置顶或关闭助手提醒。
- 点击进入同一个助手会话。

这样用户既能通过按钮快速进入，也能像普通会话一样回看历史提醒。

### 4.3 路由建议

新增路由：

```text
app/(tabs)/messages/assistant.tsx
src/features/assistant/screens/AssistantChatScreen.tsx
```

如果后端最终采用现有 `SUPPORT` 会话并完全复用 `ChatDetailScreen`，路由可以通过 `conversationID` 和 `conversationKind=support` 打开现有聊天页；助手消息卡片仍需要在消息渲染层增加结构化分支。建议保留 `AssistantChatScreen` 作为薄包装层，负责入口初始化、助手专用头部和快捷操作，避免把助手判断散落到普通私聊逻辑中。

建议新增前端目录：

```text
src/features/assistant/
  components/AssistantAvatar.tsx
  components/AssistantInfoAlertCard.tsx
  components/AssistantNoteStatusCard.tsx
  components/AssistantQuickActions.tsx
  hooks/use-assistant-bootstrap.ts
  screens/AssistantChatScreen.tsx
  store/use-assistant-store.ts
  types.ts
  utils/assistant-deeplink.ts
```

## 5. 页面和交互流程

### 5.1 首次打开流程

1. 用户在消息页点击精灵按钮。
2. 客户端调用 `GET /assistant/bootstrap`。
3. 服务端返回助手资料、助手会话、已有订阅和能力开关。
4. 如果没有助手会话，服务端幂等创建；客户端进入加载态，不显示空白聊天。
5. 如果没有订阅，显示欢迎消息和三个快捷操作：
   - 设置信息提醒
   - 查看我的订阅
   - 如何管理提醒
6. 如果已有订阅，直接加载聊天历史，顶部展示当前订阅状态摘要。

### 5.2 设置信息提醒流程

点击“设置信息提醒”后打开底部弹层或助手内的步骤卡片。若入口来自圈子广场，当前选中的圈子默认高亮；若入口来自消息页且没有可用的当前圈子，则先显示圈子选择。

**步骤一：选择圈子**

- 展示用户已加入和自己创建的圈子。
- 每个圈子行展示圈子名称和已配置的城市，例如“北京、上海”。
- 当前选中的圈子默认高亮，但用户必须确认后才创建订阅。
- 不单独选择城市；城市范围来自圈子的 `cities`。
- 圈子没有配置城市时显示“全国/不限城市”。

**步骤二：选择主题**

- 预置主题：活动、政策、招聘、租房、交通、教育、其他。
- 允许添加最多 10 个关键词。
- 关键词长度、数量和字符集由后端校验。

**步骤三：选择来源**

- 广场
- 圈子
- 动态
- 笔记

**步骤四：选择提醒频率**

- 即时提醒
- 每日摘要（MVP 可以先只保留即时提醒，数据结构提前支持摘要）

**步骤五：确认**

确认后：

- 创建订阅。
- 助手发送确认消息，列出圈子、圈子城市、主题、来源和频率。
- 默认开启助手推送，但遵循系统通知权限和用户的助手推送开关。

### 5.3 助手消息流

信息提醒卡片包含：

- 来源类型和来源名称
- 内容标题
- 一到两行摘要
- 命中的主题
- 发布时间
- “查看原文”按钮
- “不再提醒此主题”或“管理订阅”入口

笔记状态卡片包含：

- 笔记标题
- 原作者昵称（保留安全快照）
- 状态：作者下架、作者删除或内容不可用
- 状态变化时间
- “查看我的笔记”按钮
- 如果原文已不可访问，按钮进入本地收藏副本或说明页，不继续尝试打开原文

### 5.4 文本输入和快捷操作

第一版保留聊天输入框，但把“自然语言自由理解”限制在有限命令范围内。推荐优先通过快捷操作完成设置，文本输入只支持明确的命令或帮助：

- `查看订阅`
- `暂停所有提醒`
- `恢复所有提醒`
- `帮助`

未识别输入返回固定说明和快捷按钮，不声称已经理解了任意自然语言。后续接入 AI 意图识别时，可以保持同一页面和消息协议。

### 5.5 入口点击和跳转

- 点击提醒卡片：打开对应站内详情页。
- 点击笔记状态卡片：打开用户自己的收藏/笔记副本，或打开状态说明页。
- 从系统推送点击：先进入助手会话；若 payload 带有安全的内部目标 ID，可以继续跳转到具体卡片。
- 所有跳转只接受内部 route 名称和资源 ID，不直接接受外部 URL。

## 6. 前端组件和状态设计

### 6.1 头像和入口

复用 `src/components/app/chat-bubble-icon.tsx` 中的 `ChatBubbleIcon`，新增：

```ts
type AssistantAvatarProps = {
  size?: number;
  withBackground?: boolean;
};
```

入口组件建议：

```tsx
<Pressable
  testID="messages-open-assistant"
  accessibilityRole="button"
  accessibilityLabel={t('assistant.open')}
  hitSlop={8}
  onPress={openAssistant}
>
  <AssistantAvatar size={26} />
  {unreadCount > 0 ? <UnreadDot count={unreadCount} /> : null}
</Pressable>
```

### 6.2 前端状态

```ts
type AssistantSubscription = {
  id: string;
  circleId: string;
  circleName: string;
  circleCities: string[];
  topics: string[];
  sourceTypes: Array<'PLAZA_POST' | 'CIRCLE_POST' | 'MOMENT' | 'NOTE'>;
  deliveryMode: 'REALTIME' | 'DAILY_DIGEST';
  enabled: boolean;
  pushEnabled: boolean;
  quietHours: { start: string | null; end: string | null };
  createdAt: string;
  updatedAt: string;
};

type AssistantState = {
  assistantKey: string | null;
  conversationId: string | null;
  assistantUserId: string | null;
  subscriptions: AssistantSubscription[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  refreshSubscriptions: () => Promise<void>;
  markAssistantRead: () => Promise<void>;
  reset: () => void;
};
```

状态只保存助手会话元数据、订阅和未读计数。聊天正文继续由现有 chat-core 管理，不在助手 store 中复制一份完整消息列表。

### 6.3 结构化消息类型

现有 `ChatMessageDto.type` 是字符串，可以增加以下类型：

```ts
type AssistantMessageType =
  | 'assistant-welcome'
  | 'assistant-command-result'
  | 'assistant-subscription-confirmed'
  | 'assistant-info-alert'
  | 'assistant-note-status';
```

消息 `content` 使用结构化载荷，客户端必须做边界校验。示例：

```ts
type AssistantInfoAlertContent = {
  kind: 'info-alert';
  alertId: string;
  subscriptionId: string;
  circleId: string;
  sourceType: 'PLAZA_POST' | 'CIRCLE_POST' | 'MOMENT' | 'NOTE';
  sourceId: string;
  title: string;
  summary: string;
  sourceLabel: string;
  matchedCities: string[];
  matchedTopics: string[];
  publishedAt: string;
  target: {
    route: 'plaza-post-detail' | 'moments' | 'note-detail';
    id: string;
  };
};

type AssistantNoteStatusContent = {
  kind: 'note-status';
  alertId: string;
  sourceNoteId: string;
  collectedNoteIds: string[];
  title: string;
  owner: { id: string | null; nickname: string };
  status: 'UNLISTED' | 'DELETED' | 'MODERATION_REMOVED';
  changedAt: string;
  target: {
    route: 'my-note' | 'note-status-help';
    id: string;
  };
};
```

服务端同时保留一个经过长度限制的 `text` 兜底字段，旧客户端遇到未知类型时显示通用文本，不把原始 JSON 直接展示给用户。

## 7. API 设计

### 7.1 助手初始化

```http
GET /assistant/bootstrap?contextCircleId=<circle-id>
```

`contextCircleId` 是可选的入口上下文：从圈子广场打开时传入当前 `selectedCircleId`；从消息页打开且没有上下文时省略，客户端再让用户选择圈子。服务端只返回当前用户有权限查看的圈子预选结果。

响应：

```json
{
  "assistant": {
    "key": "windnote-assistant",
    "displayName": "风信助手",
    "avatarKey": "windnote-mascot-v1",
    "userId": "system-assistant-user-id",
    "conversationId": "conversation-uuid"
  },
  "subscriptions": [],
  "unreadCount": 0,
  "capabilities": {
    "infoSubscriptions": true,
    "noteStatusAlerts": true,
    "dailyDigest": false
  }
}
```

该接口必须幂等。用户重复点击入口、多个设备同时打开、登录恢复重复调用，都只能得到同一个助手会话。

### 7.2 订阅列表

```http
GET /assistant/subscriptions
```

### 7.3 创建订阅

```http
POST /assistant/subscriptions
Idempotency-Key: <client-request-id>
Content-Type: application/json
```

```json
{
  "circleId": "circle-uuid",
  "topics": ["活动", "政策"],
  "keywords": ["周末", "亲子"],
  "sourceTypes": ["PLAZA_POST", "CIRCLE_POST"],
  "deliveryMode": "REALTIME",
  "pushEnabled": true,
  "quietHours": { "start": null, "end": null }
}
```

响应返回完整的 `AssistantSubscription`，其中包含当前圈子名称和 `cities` 快照。服务端必须校验当前用户是该圈子成员或创建者，从圈子权威数据读取城市范围，去重主题和关键词，并拒绝不存在或无权限的圈子。

### 7.4 更新订阅

```http
PATCH /assistant/subscriptions/:id
```

支持修改圈子、主题、关键词、来源、频率、推送开关和启用状态。更新只能作用于当前用户自己的订阅，修改圈子时重新校验成员关系并刷新圈子城市。

### 7.5 删除订阅

```http
DELETE /assistant/subscriptions/:id
```

删除后不再产生新提醒，历史助手消息保留。

### 7.6 助手命令

```http
POST /assistant/commands
Idempotency-Key: <client-request-id>
```

```json
{
  "conversationId": "conversation-uuid",
  "command": {
    "kind": "pause-all"
  }
}
```

MVP 支持的 `kind`：

```ts
type AssistantCommand =
  | { kind: 'list-subscriptions' }
  | { kind: 'pause-all' }
  | { kind: 'resume-all' }
  | { kind: 'open-subscription-form' }
  | { kind: 'help' };
```

服务端执行后向助手会话写入一条 `assistant-command-result` 消息。命令接口只接受白名单命令，不能把任意用户文本当作数据库查询条件。

### 7.7 推送和聊天同步

助手提醒使用现有聊天消息同步和推送链路：

- 聊天消息写入助手专用 `SUPPORT` 会话。
- 推送 payload 带 `conversationId`、`conversationKind: "support"`、`assistantKey` 和 `alertId`。
- 点击推送先打开助手会话，再按内部 `target` 跳转。
- 不额外创建一条相同内容的互动通知，避免通知中心和聊天未读重复计数。
- 新增助手专用推送开关，关闭时消息仍保留在会话中，但不发送离线推送。

## 8. 后端数据结构

### 8.1 AssistantSubscription

```text
AssistantSubscription
---------------------
id                  UUID PK
userId              UUID NOT NULL
assistantKey        VARCHAR NOT NULL DEFAULT 'windnote-assistant'
circleId            UUID NOT NULL
circleNameSnapshot  VARCHAR NOT NULL
circleCitiesSnapshot JSONB NOT NULL DEFAULT []
topics              JSONB NOT NULL DEFAULT []
keywords            JSONB NOT NULL DEFAULT []
sourceTypes         JSONB NOT NULL DEFAULT []
deliveryMode        ENUM('REALTIME','DAILY_DIGEST')
enabled             BOOLEAN NOT NULL DEFAULT true
pushEnabled         BOOLEAN NOT NULL DEFAULT true
quietHoursStart     VARCHAR NULL
quietHoursEnd       VARCHAR NULL
createdAt           TIMESTAMPTZ NOT NULL
updatedAt           TIMESTAMPTZ NOT NULL
```

索引：

- `(userId, enabled)`
- `(circleId, enabled)`
- `assistantKey`

### 8.2 AssistantAlertDelivery

```text
AssistantAlertDelivery
----------------------
id                  UUID PK
userId              UUID NOT NULL
assistantKey        VARCHAR NOT NULL
subscriptionId      UUID NULL
eventType           ENUM('INFO_PUBLISHED','NOTE_STATUS_CHANGED')
sourceId            VARCHAR NOT NULL
sourceVersion       VARCHAR NOT NULL
dedupeKey           VARCHAR NOT NULL UNIQUE
status              ENUM('PENDING','SENT','SKIPPED','FAILED')
conversationId      UUID NULL
messageId           UUID NULL
payloadSnapshot     JSONB NOT NULL
failureCode         VARCHAR NULL
createdAt           TIMESTAMPTZ NOT NULL
sentAt              TIMESTAMPTZ NULL
```

推荐 dedupe key：

```text
<userId>:<eventType>:<sourceId>:<sourceVersion>
```

同一用户的多条重叠订阅命中同一来源时，只发送一条助手消息，并在 `payloadSnapshot` 中保存合并后的 `matchedTopics` 和 `matchedSubscriptionIds`。笔记状态提醒需要把状态版本或状态变更时间放入 key，防止重试重复发送，也避免旧事件覆盖新状态。

### 8.3 AssistantConversation

如果直接复用现有聊天会话表，只需增加助手标记字段：

```text
assistantKey      VARCHAR NULL
isSystemAssistant BOOLEAN NOT NULL DEFAULT false
```

约束：

- `(userId, assistantKey)` 唯一。
- 系统助手不进入好友、联系人和好友搜索。
- 系统助手不能被普通用户拉入群聊。
- 用户只能清空自己的助手历史，不能删除服务端助手身份。

## 9. 后端事件流程

### 9.1 信息发布提醒

```text
内容发布成功
  -> 产生 content.published outbox 事件
  -> assistant matcher 按 circleId/圈子城市/sourceType/keywords 匹配订阅
  -> 创建 AssistantAlertDelivery(PENDING)
  -> 事务或可靠队列写入助手聊天消息
  -> 更新 delivery 为 SENT
  -> 按 pushEnabled 和 quietHours 发推送
```

MVP 匹配规则：

- 每条订阅绑定一个圈子，服务端读取该圈子的最新 `cities`。
- 圈子有城市时，内容的 `cities`/`city` 与圈子城市任一相交才匹配。
- 圈子没有城市时，按现有圈子语义视为全国/不限定城市。
- 来源类型必须命中。
- 主题或关键词满足任一匹配条件。
- 内容被用户屏蔽、无权限或已删除时不发送。
- 同一用户同一来源只发送一次；多条重叠订阅合并成一条消息。
- 单用户每日即时提醒数量设上限，超出后进入摘要或丢弃并记录原因。

### 9.2 笔记下架提醒

当前前端已经接收 `note.source.status.changed` 实时信号来刷新来源笔记状态。后端在修改来源笔记状态的同一业务事务中增加 outbox 事件：

```json
{
  "type": "note.source.status.changed",
  "sourceNoteId": "source-note-id",
  "ownerId": "owner-id",
  "previousStatus": "ACTIVE",
  "status": "UNLISTED",
  "available": false,
  "changedAt": "2026-10-29T12:00:00.000Z",
  "version": 18
}
```

消费流程：

1. 查找所有 `collectedFrom.sourceNoteId = sourceNoteId` 的用户副本。
2. 排除 owner 自己和已删除账号。
3. 对每个用户按根来源笔记聚合，不按副本数量重复发送。
4. 写入 `AssistantAlertDelivery`，dedupe key 使用用户、来源笔记、状态版本。
5. 发送 `assistant-note-status` 聊天消息和离线推送。
6. 前端继续通过原有实时信号更新笔记列表的 `status/available` 字段。

如果用户在离线期间错过实时信号，助手消息仍然通过聊天历史同步恢复；不能依赖客户端在线监听来生成提醒。

## 10. 推送内容和隐私

默认锁屏推送使用低敏感文案：

- 标题：`风信助手`
- 内容：`你有一条新的提醒`

用户在助手设置中开启“显示提醒摘要”后，才允许在推送正文中展示标题或主题。笔记状态提醒尤其不要在锁屏上显示原笔记正文。

日志和 Sentry 中不得记录：

- 笔记正文
- 用户聊天内容
- 私有笔记媒体 URL
- 完整推送 payload
- 访问令牌和第三方凭证

助手消息卡片只保存跳转所需的内部资源 ID、短标题和状态快照。深链只接受内部 route 和资源 ID，不接受任意 URL。

## 11. 失败处理和一致性

- `bootstrap` 失败：显示可重试状态，不创建本地假会话。
- 订阅创建失败：保留表单内容，允许用户重试；使用 `Idempotency-Key` 防止重复创建。
- 消息写入成功但推送失败：消息仍标记为已发送，推送单独记录失败并有限重试。
- 消息写入超时：由 `dedupeKey` 保护，重试不能产生重复助手消息。
- 目标内容已删除：助手卡片保留状态，点击进入“内容已不可用”页面。
- 老客户端不认识助手消息类型：显示安全的文本兜底，不崩溃、不展示原始 JSON。
- 用户退出登录：清理助手本地状态和未读缓存；服务端订阅保留，重新登录后恢复。
- 用户切换账号：助手会话、订阅和未读数必须按 userId 隔离。

## 12. 开发拆分

### Phase 0：契约和基础设施

- 后端增加助手身份、专用会话标记和 bootstrap 接口。
- 定义助手消息类型及跨仓协议测试。
- 增加 `AssistantAlertDelivery` 和 outbox 任务。
- 增加 feature flag：`assistantAlertsEnabled`。

### Phase 1：助手入口和会话

- 消息页标题栏增加精灵按钮。
- 从圈子广场打开时读取 `useDiscoverStore.selectedCircleId`，通过 `useCirclesStore` 展示圈子名称和 `Circle.cities`；没有上下文时进入圈子选择。
- 新增 `AssistantAvatar` 和助手会话列表行。
- 新增助手路由和欢迎态。
- 复用 chat-core 的历史同步、已读、推送和返回逻辑。
- 增加助手消息卡片渲染和未知类型兜底。

### Phase 2：笔记状态提醒

- 后端接入 `ACTIVE -> UNLISTED/DELETED` 状态事件。
- 根据 `sourceNoteId` 查找收藏副本和受影响用户。
- 发送结构化 `assistant-note-status` 消息。
- 前端处理卡片点击和不可用页面。
- 补齐离线恢复、重复事件和多副本聚合测试。

### Phase 3：站内信息订阅

- 创建订阅表单和快捷操作。
- 复用现有圈子选择和 `Circle.cities`，不再新增一套独立城市选择器。
- 实现圈子城市/主题/来源匹配。
- 接入内容发布 outbox。
- 实现提醒卡片、推送和管理订阅。
- 增加频控、静默时段和每日数量上限。

### Phase 4：AI 增强（后续）

- 用自然语言创建订阅。
- 语义相关性判断和重复内容聚合。
- 自动摘要和日报。
- 后端统一 AI gateway，客户端不保存模型密钥。

## 13. 测试要求

### 前端

- 消息页精灵按钮在 iOS、Android、Web 和桌面分栏布局可见且可点击。
- 助手头像和开屏图标使用同一 SVG 组件。
- 首次打开、已有订阅、无网络、重试和退出登录状态正确。
- 助手消息类型解析失败时渲染文本兜底。
- 信息提醒卡片正确跳转站内详情。
- 笔记下架卡片在原文不可访问时不循环跳转。
- 未读数、已读水位和推送点击路由不与普通聊天重复计数。
- 当前圈子预选使用该圈子的 `cities`；没有当前圈子时不会自动选择北京或个人资料城市。

### 后端

- bootstrap 并发调用只创建一个助手会话。
- 订阅创建、修改、删除按用户权限隔离。
- 内容事件重复投递只生成一条助手消息。
- 一个用户收藏同一来源的多个副本只收到一条状态提醒。
- `ACTIVE -> UNLISTED`、`ACTIVE -> DELETED` 发送提醒；重复同状态事件不重复发送。
- owner 自己不收到“自己下架自己的笔记”提醒。
- 推送失败不会回滚已写入的助手消息。
- 用户离线后重新同步能拿到错过的助手消息。
- 订阅只允许绑定当前用户可见的圈子；圈子城市变化和全国/不限城市语义与发现页保持一致。

### 行为测试建议

- `assistant-bootstrap.spec.ts`
- `assistant-subscription-matching.test.mts`
- `assistant-alert-dedupe.test.mts`
- `assistant-note-status-delivery.test.mts`
- `AssistantChatScreen.spec.tsx`
- `MessagesScreen.assistant-entry.spec.tsx`

## 14. 验收标准

MVP 发布前必须满足：

1. 用户从消息页点击精灵按钮能稳定进入风信助手。
2. 助手会话在消息列表中有独立头像、名称和未读状态。
3. 用户能够创建、查看、暂停、恢复和删除信息订阅。
4. 笔记 owner 下架或删除来源笔记后，已添加该笔记的用户收到一条助手提醒。
5. 离线、重连、重复事件和多设备场景不会产生重复消息。
6. 助手消息能打开合法的站内目标，失效内容有明确说明。
7. 未知消息类型、旧版本服务端字段缺失和异常响应不会导致消息页崩溃。
8. 日志、推送和错误上报不泄露笔记正文、私密 URL 或访问令牌。
9. 信息订阅不把北京作为默认城市；从圈子上下文打开时使用所选圈子的最新城市范围。

## 15. 工程量级估算

以下是熟悉当前代码的前后端各一名开发者的粗略量级，不包含外部信息源接入和模型训练：

| 范围 | 量级 |
|---|---:|
| 助手入口、头像、路由、欢迎态 | 3–5 个开发日 |
| 专用会话和结构化消息接入 | 4–8 个开发日 |
| 笔记状态提醒端到端 | 5–10 个开发日 |
| 站内圈子城市/主题订阅 | 7–12 个开发日 |
| 外部信息源接入 | 另计，通常显著高于站内订阅 |

建议先做 Phase 0、Phase 1 和 Phase 2，先把“风信助手”变成可靠的消息入口，再接信息订阅。这样即使第一版没有真正的大模型，用户也能得到完整、可信的助手体验。
