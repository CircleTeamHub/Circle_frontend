# 聊天历史恢复 · OpenIM 本地库回填设计

- **状态**：设计已确认，待实施计划
- **日期**：2026-06-05
- **作者**：circle-im 团队
- **范围**：`circle_be` 后端 + `circle-im` App
- **依赖**：OpenIM MongoDB、OpenIM RN SDK 本地插入接口

---

## 1. 背景

当前 App 的会话列表来自 OpenIM 会话同步，聊天详情页历史来自 OpenIM RN SDK 的本地历史接口：

```ts
OpenIMSDK.getAdvancedHistoryMessageList({
  conversationID,
  count,
  startClientMsgID: '',
  viewType: ViewType.History,
})
```

当用户新安装、重装、换设备、清除 App 数据，或 OpenIM 本地 `DocumentDirectoryPath/openim` 数据目录被重建时，会出现：

- 服务端 OpenIM Mongo 仍有历史消息；
- 会话列表能同步出来；
- 当前设备本地 OpenIM 消息库只有新消息；
- `getAdvancedHistoryMessageList()` 只返回本地已有消息，旧消息不自动回填。

已验证的本地例子：服务端单聊 `si_0a9ad3d6ef1d47bd9cbccda1cee57547_d6bbe83841ea4a0dae8689d5509c1881` 有 seq 1-15，但 App 只返回最新 seq 15。

---

## 2. 目标

1. 用户新安装、重装、换设备或本地库损坏后，打开会话能自动恢复服务端已有历史。
2. 恢复后的消息写回 OpenIM SDK 本地消息库，而不是只存在 App 自己的缓存里。
3. 恢复后现有聊天页、历史搜索、分页、已读和后续消息收发继续走 OpenIM SDK。
4. 恢复逻辑幂等、可分页、可中断，不重复插入同一条消息。

## 3. 非目标

- 不做跨端端到端加密历史恢复。
- 不做登录后一口气全量恢复所有会话。
- 不把 OpenIM 消息长期复制到业务 PostgreSQL。
- 不直接写客户端 OpenIM 本地数据库文件。
- 不恢复已被当前用户显式删除的消息。

---

## 4. 方案选择

采用 **服务端历史快照 + 客户端写回 OpenIM 本地库**。

### 被选方案

1. 后端新增只读历史接口，从 OpenIM Mongo 的 `openim_v3.msg` 读取指定会话消息。
2. 后端做会话权限校验和删除过滤。
3. 客户端检测本地历史缺口，分页请求后端历史。
4. 客户端用 OpenIM RN SDK 的本地插入接口回填：
   - 单聊：`insertSingleMessageToLocalStorage`
   - 群聊：`insertGroupMessageToLocalStorage`
5. 回填后重新调用 `loadConversationMessages()` 刷新 UI。

### 不采用：App 自维护历史缓存

这种方案会让聊天页同时读取 OpenIM SDK 和业务缓存，短期容易显示历史，但会让搜索、分页、去重、已读、撤回和后续 SDK 事件都变复杂。当前需求是恢复 OpenIM 本地库，不能绕过 SDK。

---

## 5. 后端设计

新增模块：

```text
circle_be/src/chat-history/
├── chat-history.module.ts
├── chat-history.controller.ts
├── chat-history.service.ts
└── dto/
    └── chat-history.dto.ts
```

接口：

```http
GET /api/v1/chat-history/conversations/:conversationID/messages?limit=100&beforeSeq=
Authorization: Bearer <accessToken>
```

返回：

```ts
type ChatHistoryMessagePageDto = {
  conversationID: string;
  messages: RestorableMessageDto[];
  hasMore: boolean;
  nextBeforeSeq: number | null;
  serverMinSeq: number | null;
  serverMaxSeq: number | null;
};
```

`RestorableMessageDto` 使用客户端能转换成 OpenIM `MessageItem` 的字段命名，至少包含：

```ts
{
  clientMsgID: string;
  serverMsgID: string;
  sendID: string;
  recvID: string;
  groupID: string;
  senderNickname: string;
  senderFaceUrl: string;
  sessionType: number;
  contentType: number;
  status: number;
  seq: number;
  sendTime: number;
  createTime: number;
  content: string;
  attachedInfo: string;
  ex: string;
  isRead: boolean;
}
```

后端从 Mongo 原始字段转换：

| Mongo 字段 | DTO 字段 |
| --- | --- |
| `client_msg_id` | `clientMsgID` |
| `server_msg_id` | `serverMsgID` |
| `send_id` | `sendID` |
| `recv_id` | `recvID` |
| `group_id` | `groupID` |
| `content_type` | `contentType` |
| `send_time` | `sendTime` |
| `create_time` | `createTime` |
| `attached_info` | `attachedInfo` |

## 6. 后端权限与过滤

后端必须使用当前 JWT 用户做鉴权，不能信任客户端传入的 `sendID` / `recvID`。

### 单聊

单聊会话 ID 格式：

```text
si_<imUserA>_<imUserB>
```

规则：

- 当前用户 UUID 先转 OpenIM userID：去掉连字符。
- 当前用户 IM userID 必须是会话 ID 两端之一。
- 否则返回 404，避免泄露会话存在性。

### 群聊

群聊会话 ID 格式：

```text
sg_<groupID>
```

规则：

- 当前用户 IM userID 必须存在于 OpenIM Mongo `group_member` 中对应 `group_id` 的成员记录。
- 不在群里返回 404。

### 删除过滤

OpenIM Mongo `msg.msgs[]` 中每项包含 `del_list`。如果 `del_list` 包含当前用户 IM userID，该消息不返回。`msg: null` 占位项不返回。

## 7. Mongo 读取方式

第一版读取单个会话的 OpenIM 分片文档：

```text
<conversationID>:0
<conversationID>:1
...
```

查询策略：

1. 用 `doc_id` 前缀匹配 `^${conversationID}:`。
2. 展平每个文档的 `msgs[]`。
3. 过滤 `msg != null`、权限删除项、无效 seq。
4. 按 seq 降序分页。
5. `beforeSeq` 存在时返回 `seq < beforeSeq` 的消息。
6. 每页返回时按 seq 升序，方便客户端按历史顺序插入和显示。

第一版默认 `limit=100`，最大 `limit=200`。

## 8. 客户端设计

新增 API 文件：

```text
src/services/api/chat-history.ts
```

新增 IM 恢复逻辑，放在 `src/im/client.ts` 或拆出 `src/im/history-restore.ts`：

```ts
export async function restoreConversationMessages(params: {
  conversationID: string;
  sourceID: string;
  sessionType: SessionType;
  maxMessages?: number;
}): Promise<{ inserted: number; fetched: number }>;
```

流程：

1. `ensureOpenIMInitialized()`。
2. 调用 `getAdvancedHistoryMessageList()` 获取本地第一页。
3. 调后端历史接口获取服务端第一页和 seq 范围。
4. 判断是否缺口：
   - 本地为空；
   - 或本地最早 `seq` 大于服务端最早 `seq`；
   - 或服务端第一页存在本地缺失的 `clientMsgID`。
5. 对每条服务端消息用 `findMessageList()` 做去重。
6. 缺失消息转成 OpenIM `MessageItem`。
7. 按会话类型调用：
   - 单聊：`insertSingleMessageToLocalStorage({ message, recvID, sendID })`
   - 群聊：`insertGroupMessageToLocalStorage({ message, groupID, sendID })`
8. 插入完调用 `loadConversationMessages(conversationID)` 刷新 store。

单聊 `recvID` 规则：

- 对当前用户收到的消息，`recvID` 是当前用户 IM id，`sendID` 是对方。
- 对当前用户发出的消息，`recvID` 是对方 IM id，`sendID` 是当前用户。
- 后端返回原始 `sendID` / `recvID`，客户端按原值传入 SDK，避免自己重算方向。

## 9. 触发时机

第一版只做按需恢复当前会话：

1. 用户进入聊天详情页。
2. `loadConversationMessages()` 返回后，如果消息数量很少或本地最早 seq 不等于服务端最早 seq，触发一次恢复。
3. 恢复进行中不阻塞用户发送新消息。
4. 恢复完成后刷新当前会话消息。

为了避免每次打开都请求后端，客户端记录每个会话的恢复状态：

```text
chat-history-restore:<currentUserID>:<conversationID>
```

内容：

```ts
{
  checkedAt: number;
  restoredThroughSeq: number | null;
}
```

缓存可放 MMKV。第一版 TTL 设为 24 小时；手动“恢复聊天记录”不受 TTL 限制。

## 10. UI 与用户反馈

聊天页不新增复杂流程：

- 自动恢复时在 dev 打日志；产品 UI 可不打扰。
- 如果恢复超过 1 秒，可在消息列表顶部显示轻量文案：`正在恢复聊天记录...`。
- 恢复失败不影响当前本地消息显示，也不阻止发送。
- 聊天设置页后续可增加“恢复聊天记录”动作，第一版不是必须。

## 11. 错误处理

| 场景 | 行为 |
| --- | --- |
| 后端 404 | 当前用户无权或会话不存在；不重试，记录恢复失败 |
| 后端 401 | 走现有 `apiClient` token refresh |
| Mongo/OpenIM 后端不可用 | 返回 503，客户端保留本地消息 |
| 插入单条消息失败 | 记录失败，继续下一条 |
| 全部插入失败 | 不更新恢复状态，下次可重试 |
| 部分插入成功 | 刷新 UI，恢复状态记录到成功插入的最小 seq |

## 12. 安全与隐私

- 历史接口只按 JWT 当前用户授权。
- 单聊和群聊均返回 404 而不是 403，避免枚举会话。
- 不暴露 Mongo `_id`、内部 doc 结构、用户不可见删除消息。
- 不允许通过接口查询任意 Mongo 集合或任意 `doc_id`。
- `limit` 有上限，接口加现有全局限流即可。

## 13. 测试计划

后端：

- 单聊：当前用户是 A/B 时可读；第三方用户 404。
- 群聊：成员可读；非成员 404。
- `del_list` 包含当前用户时过滤。
- `msg: null` 占位过滤。
- `beforeSeq` 分页正确。
- Mongo Long / number 转换正确。

客户端：

- `restoreConversationMessages()` 本地为空时插入服务端消息。
- 本地已有消息时不重复插入。
- 单聊调用 `insertSingleMessageToLocalStorage`。
- 群聊调用 `insertGroupMessageToLocalStorage`。
- 恢复后调用 `loadConversationMessages()` 刷新 store。
- 后端失败时保留本地消息并不阻塞聊天页。

端到端手动验证：

1. 用已有账号进入单聊，确认服务端历史存在。
2. 清空模拟器 OpenIM 本地目录或重装 App。
3. 登录后进入该单聊。
4. 首屏先显示本地新消息，随后恢复旧消息。
5. 重进会话不会重复插入。

## 14. 实施分期

### v1：按需恢复当前会话

- 后端历史分页接口。
- 客户端进入聊天页时检测并恢复当前会话最近 500 条。
- 写回 OpenIM 本地库。
- 基础日志与测试。

### v2：后台恢复最近会话

- 登录后低优先级恢复最近 N 个会话。
- 队列并发限制。
- 更完整的恢复状态可视化。

### v3：服务端摘要接口

- 增加只返回 `serverMinSeq/serverMaxSeq/count` 的轻量接口。
- 客户端先查摘要，再决定是否拉完整消息页。

---

## 15. 自审结果

- 权限边界明确：单聊两端、群聊成员。
- 恢复目标明确：写回 OpenIM 本地库，不另建 UI 消息源。
- 第一版范围收敛：只按需恢复当前会话，避免登录时全量同步造成性能风险。
- 已知风险：OpenIM `insert*MessageToLocalStorage` 对历史消息字段完整度要求需要实现阶段实测；如果 SDK 拒绝服务端原始消息，需要补齐字段转换或降级为只读展示方案。
