# 好友申请多轮留言 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让好友申请双方在「接受/拒绝」前可多轮文字留言，接受后留言注入两人 OpenIM 会话成为聊天首屏历史。

**Architecture:** 后端新增 `FriendRequestMessage` 表挂在既有 `Friend` 记录上，两个 REST 端点（拉/发），发留言复用通知系统提醒对方；accept 时扩展既有 `emitAcceptedFriendChatMessages` 把整条线程按序注入 OpenIM。前端在 `FriendActivityDetailScreen` 把单条附言换成留言列表+输入框，双侧对称。

**Tech Stack:** NestJS + Prisma（circle_be）；Expo/React Native + expo-router + i18next（circle-im）；node:test 源读断言（前端）、jest（后端）。

## Global Constraints

- 后端仓库：`/Users/yiboding/projects/circle_be`；前端：`/Users/yiboding/projects/circle-im`。
- Prisma 迁移用 `npx prisma migrate deploy`（`migrate dev` 因历史迁移 shadow DB 报错）；改 schema 后 `npx prisma generate`。
- 后端错误抛 `{ message, errorCode }`（既有 `FriendErrorCode` 风格），前端 `getApiErrorMessage` 映射 `serverErrors.<code>`。
- 前端所有面向用户文案走 i18next，**5 个语言包**（zh/en/ja/ko/es）同步补键（有 parity 测试）。
- 前端测试 = `node --test`「源读断言」（不是 RTL/jest），后端测试 = jest。
- 留言纯文本，trim 后非空，长度 ≤ 500。
- 防刷软限制：对方（`Friend.friendID`）未发过任何留言前，发起方（`Friend.userID`）已发条数 ≥ 5 时拒发。

---

## File Structure

**后端（circle_be）**
- `prisma/schema.prisma` — 新增 `model FriendRequestMessage` + `Friend.messages` 反向关系。
- `src/friend/dto/friend.dto.ts` — 新增 `SendFriendRequestMessageDto`。
- `src/friend/friend.controller.ts` — 新增 `GET/POST /friend/requests/:requestId/messages`。
- `src/friend/friend.service.ts` — 新增 `listRequestMessages` / `appendRequestMessage`（含防刷 + 通知）；`handleRequest`（发送申请）里把首条 message 写入线程；扩展 `emitAcceptedFriendChatMessages` 注入线程历史；`FriendErrorCode` 加 `FriendRequestMessageLimit`。
- `src/notification/notification.service.ts` — `createFriendRequestNotification` 支持 `FRIEND_REQUEST_MESSAGE` 类型。
- `prisma/schema.prisma` `enum NotificationType` — 加 `FRIEND_REQUEST_MESSAGE`。
- 测试：`src/friend/friend.service.spec.ts`、`src/friend/friend.controller.spec.ts`。

**前端（circle-im）**
- `src/services/api/friends.ts` — `FriendRequestMessage` 类型 + `fetchFriendRequestMessages` / `sendFriendRequestMessage`。
- `src/services/api/server-error-codes.ts` — 加 `FRIEND_REQUEST_MESSAGE_LIMIT`。
- `src/features/contacts/screens/FriendActivityDetailScreen.tsx` — 留言列表 + 输入框。
- `src/features/notifications/utils/push-notification-route.ts` + `snackbar-route.ts` — `FRIEND_REQUEST_MESSAGE` → 好友申请详情。
- `src/i18n/locales/{zh,en,ja,ko,es}.json` — 留言相关文案 + `serverErrors.FRIEND_REQUEST_MESSAGE_LIMIT`。
- 测试：`test/friends.api.test.js`（若无则建）、`test/friend-activity-detail.test.js`、`test/notification-targeting.test.js`。

---

## Task 1: 后端数据模型 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（`model Friend` 加反向关系；新增 `model FriendRequestMessage`；`enum NotificationType` 加值）
- Test: `src/friend/friend.service.spec.ts`（现有，跑通即可）

**Interfaces:**
- Produces: Prisma model `FriendRequestMessage { id, requestId, senderId, content, createdAt }`；`Friend.messages: FriendRequestMessage[]`；`NotificationType.FRIEND_REQUEST_MESSAGE`。

- [ ] **Step 1: 加模型 + 关系**

在 `prisma/schema.prisma` 的 `model Friend { ... }` 内，`activities FriendActivity[]` 下一行加：
```prisma
  messages              FriendRequestMessage[]
```
文件末尾（其它 model 旁）新增：
```prisma
model FriendRequestMessage {
  id        String   @id @default(uuid())
  requestId String
  senderId  String
  content   String
  createdAt DateTime @default(now())

  request Friend @relation(fields: [requestId], references: [id], onDelete: Cascade)
  sender  User   @relation("friendRequestMessageSender", fields: [senderId], references: [id], onDelete: Cascade)

  @@index([requestId, createdAt])
}
```
在 `model User { ... }` 内加反向关系（找一处已有的 `@relation("...")` 反向集合旁）：
```prisma
  friendRequestMessages FriendRequestMessage[] @relation("friendRequestMessageSender")
```
在 `enum NotificationType { ... }` 的 `FRIEND_REQUEST_REJECTED` 下加：
```prisma
  FRIEND_REQUEST_MESSAGE
```

- [ ] **Step 2: 迁移 + 生成 client**

Run:
```bash
cd /Users/yiboding/projects/circle_be
npx prisma migrate deploy && npx prisma generate
```
Expected: 迁移成功、client 重新生成（`FriendRequestMessage` 出现在 `src/generated/prisma`）。
若 `migrate deploy` 因无待应用迁移无变化，先 `npx prisma migrate diff` 生成迁移文件再 deploy（遵循仓库既有迁移流程）。

- [ ] **Step 3: 验证 schema 编译**

Run: `cd /Users/yiboding/projects/circle_be && npx tsc --noEmit`
Expected: 0 error（生成的 client 含新模型）。

- [ ] **Step 4: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add prisma/schema.prisma src/generated/prisma
git commit -m "feat(friend): FriendRequestMessage 模型 + FRIEND_REQUEST_MESSAGE 通知类型"
```

---

## Task 2: 发送申请时把首条附言写入线程

**Files:**
- Modify: `src/friend/friend.service.ts`（`handleRequest` 事务内，创建 `Friend` 后写首条 `FriendRequestMessage`）
- Test: `src/friend/friend.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `FriendRequestMessage`。
- Produces: 每条新申请若带 message，则线程首条 = 发起方那条留言。

- [ ] **Step 1: 写失败测试**

在 `friend.service.spec.ts` 的发送申请测试块附近加：
```ts
it('seeds the message thread with the sender note on request', async () => {
  // 复用现有 sendRequest 成功用例的 mock 设置
  const createMany = tx.friendRequestMessage?.createMany ?? jest.fn();
  // 断言：创建申请后，用发起方 senderId + content 写入首条留言
  // （具体 mock 依现有 spec 的 tx 结构；核心是 friendRequestMessage.create 被调用）
  expect(tx.friendRequestMessage.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ senderId: 'user-1', content: expect.any(String) }),
    }),
  );
});
```
（先在 spec 的 tx mock 里补 `friendRequestMessage: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), count: jest.fn() }`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/friend/friend.service.spec.ts -t "seeds the message thread"`
Expected: FAIL（`friendRequestMessage.create` 未被调用）。

- [ ] **Step 3: 实现**

在 `handleRequest` 事务里（创建 `nextRequestRecord` 之后、`createFriendActivities` 之前）加：
```ts
const seedContent = nextRequestRecord.message?.trim();
if (seedContent) {
  await tx.friendRequestMessage.create({
    data: {
      requestId: nextRequestRecord.id,
      senderId: senderId,
      content: seedContent,
    },
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/friend/friend.service.spec.ts`
Expected: PASS（含既有全部）。

- [ ] **Step 5: Commit**

```bash
git add src/friend/friend.service.ts src/friend/friend.service.spec.ts
git commit -m "feat(friend): 发送申请时首条附言写入留言线程"
```

---

## Task 3: 后端拉/发留言端点 + 防刷 + 通知

**Files:**
- Modify: `src/friend/dto/friend.dto.ts`（`SendFriendRequestMessageDto`）
- Modify: `src/friend/friend.controller.ts`（两个路由）
- Modify: `src/friend/friend.service.ts`（`listRequestMessages` / `appendRequestMessage`；`FriendErrorCode.FriendRequestMessageLimit`）
- Modify: `src/notification/notification.service.ts`（`createFriendRequestNotification` 支持新类型）
- Test: `src/friend/friend.service.spec.ts`、`src/friend/friend.controller.spec.ts`

**Interfaces:**
- Produces:
  - `service.listRequestMessages(userId: string, requestId: string): Promise<Array<{id,senderId,content,createdAt}>>`
  - `service.appendRequestMessage(userId: string, requestId: string, content: string): Promise<{id,senderId,content,createdAt}>`
  - `GET /friend/requests/:requestId/messages`、`POST /friend/requests/:requestId/messages`
  - 错误码字符串 `FRIEND_REQUEST_MESSAGE_LIMIT`

- [ ] **Step 1: 写失败测试（service 权限/非 PENDING/防刷）**

在 `friend.service.spec.ts` 加：
```ts
describe('friend request messages', () => {
  it('rejects reading messages by a non-party (404)', async () => {
    prisma.friend.findUnique.mockResolvedValue({ id: 'r1', userID: 'user-1', friendID: 'user-2', state: 'PENDING' });
    await expect(service.listRequestMessages('outsider', 'r1')).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: expect.any(String) }),
    });
  });

  it('rejects sending on a non-PENDING request', async () => {
    prisma.friend.findUnique.mockResolvedValue({ id: 'r1', userID: 'user-1', friendID: 'user-2', state: 'ACCEPTED' });
    await expect(service.appendRequestMessage('user-1', 'r1', 'hi')).rejects.toBeDefined();
  });

  it('enforces sender soft cap until recipient replies', async () => {
    prisma.friend.findUnique.mockResolvedValue({ id: 'r1', userID: 'user-1', friendID: 'user-2', state: 'PENDING' });
    prisma.friendRequestMessage.count
      .mockResolvedValueOnce(0)   // recipient(user-2) messages = 0
      .mockResolvedValueOnce(5);  // sender(user-1) messages = 5
    await expect(service.appendRequestMessage('user-1', 'r1', 'spam')).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'FRIEND_REQUEST_MESSAGE_LIMIT' }),
    });
  });
});
```
（spec 顶部 prisma mock 补 `friendRequestMessage: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() }`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/friend/friend.service.spec.ts -t "friend request messages"`
Expected: FAIL（方法未定义）。

- [ ] **Step 3: 实现 service + 错误码**

`FriendErrorCode`（同文件枚举）加：
```ts
FriendRequestMessageLimit = 'FRIEND_REQUEST_MESSAGE_LIMIT',
```
加方法：
```ts
async listRequestMessages(userId: string, requestId: string) {
  const req = await this.prisma.friend.findUnique({ where: { id: requestId } });
  if (!req || (req.userID !== userId && req.friendID !== userId)) {
    throw new NotFoundException({ message: 'Request not found', errorCode: FriendErrorCode.PendingRequestNotFound });
  }
  const rows = await this.prisma.friendRequestMessage.findMany({
    where: { requestId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, senderId: true, content: true, createdAt: true },
  });
  return rows;
}

async appendRequestMessage(userId: string, requestId: string, contentRaw: string) {
  const content = contentRaw.trim();
  if (!content || content.length > 500) {
    throw new BadRequestException({ message: 'Invalid content', errorCode: FriendErrorCode.PendingRequestNotFound });
  }
  const req = await this.prisma.friend.findUnique({ where: { id: requestId } });
  if (!req || (req.userID !== userId && req.friendID !== userId)) {
    throw new NotFoundException({ message: 'Request not found', errorCode: FriendErrorCode.PendingRequestNotFound });
  }
  if (req.state !== FriendState.PENDING) {
    throw new ConflictException({ message: 'Request not pending', errorCode: FriendErrorCode.PendingRequestNotFound });
  }
  // 防刷：发起方在对方未回复前最多 5 条
  const isSenderSide = req.userID === userId;
  if (isSenderSide) {
    const recipientCount = await this.prisma.friendRequestMessage.count({
      where: { requestId, senderId: req.friendID },
    });
    if (recipientCount === 0) {
      const senderCount = await this.prisma.friendRequestMessage.count({
        where: { requestId, senderId: req.userID },
      });
      if (senderCount >= 5) {
        throw new ConflictException({
          message: 'Message limit reached',
          errorCode: FriendErrorCode.FriendRequestMessageLimit,
        });
      }
    }
  }
  const created = await this.prisma.friendRequestMessage.create({
    data: { requestId, senderId: userId, content },
    select: { id: true, senderId: true, content: true, createdAt: true },
  });
  const toUserId = req.userID === userId ? req.friendID : req.userID;
  await this.createAndBroadcastFriendRequestNotification({
    type: NotificationType.FRIEND_REQUEST_MESSAGE,
    toUserId,
    fromUserId: userId,
    content,
  });
  return created;
}
```
把 `createAndBroadcastFriendRequestNotification` 的 `type` 联合类型补上 `| typeof NotificationType.FRIEND_REQUEST_MESSAGE`。确保 `BadRequestException`/`ConflictException`/`NotFoundException` 已 import。

- [ ] **Step 4: 实现通知 service 分支**

`src/notification/notification.service.ts` 的 `createFriendRequestNotification` 里，把 type 联合类型补 `FRIEND_REQUEST_MESSAGE`，并确保它落库为该类型（复用现有创建逻辑，只是类型多一个值）。

- [ ] **Step 5: 实现 DTO + controller 路由**

`friend.dto.ts` 加：
```ts
import { IsString, MaxLength, MinLength } from 'class-validator';
export class SendFriendRequestMessageDto {
  @IsString() @MinLength(1) @MaxLength(500)
  content!: string;
}
```
`friend.controller.ts`（`acceptRequest` 附近）加：
```ts
@Get('requests/:requestId/messages')
listRequestMessages(
  @CurrentUser('id') userId: string,
  @Param('requestId', ParseUUIDPipe) requestId: string,
) {
  return this.friendService.listRequestMessages(userId, requestId);
}

@Post('requests/:requestId/messages')
sendRequestMessage(
  @CurrentUser('id') userId: string,
  @Param('requestId', ParseUUIDPipe) requestId: string,
  @Body() dto: SendFriendRequestMessageDto,
) {
  return this.friendService.appendRequestMessage(userId, requestId, dto.content);
}
```
（`@CurrentUser` 装饰器名以该 controller 现有 accept 路由为准。）

- [ ] **Step 6: 跑测试确认通过**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/friend`
Expected: PASS（含新增用例）。

- [ ] **Step 7: Commit**

```bash
git add src/friend src/notification/notification.service.ts
git commit -m "feat(friend): 好友申请留言拉/发端点 + 防刷软限制 + 通知"
```

---

## Task 4: accept 时把留言线程注入 OpenIM 会话

**Files:**
- Modify: `src/friend/friend.service.ts`（`emitAcceptedFriendChatMessages` 前置注入线程历史）
- Test: `src/friend/friend.service.spec.ts`

**Interfaces:**
- Consumes: `openimService.sendTextMessage`（既有）、`FriendRequestMessage`。

- [ ] **Step 1: 写失败测试**

```ts
it('injects the message thread into the conversation on accept', async () => {
  prisma.friendRequestMessage.findMany.mockResolvedValue([
    { id: 'm1', senderId: 'user-1', content: '你好', createdAt: new Date() },
    { id: 'm2', senderId: 'user-2', content: '你也好', createdAt: new Date() },
  ]);
  // 触发 accept 成功路径后：
  expect(openimService.sendTextMessage).toHaveBeenCalledWith(
    expect.objectContaining({ sendID: 'user-1', content: '你好' }),
  );
  expect(openimService.sendTextMessage).toHaveBeenCalledWith(
    expect.objectContaining({ sendID: 'user-2', content: '你也好' }),
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/friend/friend.service.spec.ts -t "injects the message thread"`
Expected: FAIL。

- [ ] **Step 3: 实现**

在 `emitAcceptedFriendChatMessages` 里，把「发 greeting」那段**替换为**先按序注入线程、再补一条 accept-reply（保留原行为兜底）：
```ts
const thread = await this.prisma.friendRequestMessage.findMany({
  where: { requestId: params.requestId }, // 需给该方法加 requestId 参数并在调用处传入
  orderBy: { createdAt: 'asc' },
  select: { senderId: true, content: true },
});
await this.openimService.importFriends(params.requesterUserID, [params.accepterUserID]);
await this.openimService.importFriends(params.accepterUserID, [params.requesterUserID]);
if (thread.length > 0) {
  for (const msg of thread) {
    const isRequester = msg.senderId === params.requesterUserID;
    await this.openimService.sendTextMessage({
      sendID: msg.senderId,
      recvID: isRequester ? params.accepterUserID : params.requesterUserID,
      content: msg.content,
      senderNickname: isRequester ? requesterName : accepterName,
      senderFaceURL: (isRequester ? requester : accepter)?.avatarUrl ?? '',
    });
  }
} else {
  // 无线程时退回原 greeting 行为
  await this.openimService.sendTextMessage({ sendID: params.requesterUserID, recvID: params.accepterUserID, content: greeting, senderNickname: requesterName, senderFaceURL: requester?.avatarUrl ?? '' });
}
await this.openimService.sendTextMessage({ sendID: params.accepterUserID, recvID: params.requesterUserID, content: FRIEND_ACCEPTED_REPLY_MESSAGE, senderNickname: accepterName, senderFaceURL: accepter?.avatarUrl ?? '' });
```
给 `emitAcceptedFriendChatMessages` 的 params 加 `requestId: string`，并在 line 537 调用处传 `requestId: nextRequest.id`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/yiboding/projects/circle_be && npx jest src/friend/friend.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/friend/friend.service.ts
git commit -m "feat(friend): 接受申请时把留言线程按序注入 OpenIM 会话成聊天首屏历史"
```

---

## Task 5: 前端数据层（friends.ts API + 错误码）

**Files:**
- Modify: `src/services/api/friends.ts`
- Modify: `src/services/api/server-error-codes.ts`
- Test: `test/friends.api.test.js`（无则建）

**Interfaces:**
- Produces:
  - `type FriendRequestMessage = { id: string; senderId: string; content: string; createdAt: string }`
  - `fetchFriendRequestMessages(requestId: string): Promise<FriendRequestMessage[]>`
  - `sendFriendRequestMessage(requestId: string, content: string): Promise<FriendRequestMessage>`

- [ ] **Step 1: 写失败测试（源读断言）**

`test/friends.api.test.js`：
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('src/services/api/friends.ts', 'utf8');

test('friends api exposes friend-request message thread endpoints', () => {
  assert.match(src, /export type FriendRequestMessage/);
  assert.match(src, /export async function fetchFriendRequestMessages/);
  assert.match(src, /export async function sendFriendRequestMessage/);
  assert.match(src, /\/friend\/requests\/\$\{[^}]+\}\/messages/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle-im && node --test test/friends.api.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

`friends.ts` 末尾加：
```ts
export type FriendRequestMessage = {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
};

export async function fetchFriendRequestMessages(
  requestId: string,
): Promise<FriendRequestMessage[]> {
  return apiClient<FriendRequestMessage[]>(`/friend/requests/${requestId}/messages`);
}

export async function sendFriendRequestMessage(
  requestId: string,
  content: string,
): Promise<FriendRequestMessage> {
  return apiClient<FriendRequestMessage>(`/friend/requests/${requestId}/messages`, {
    method: 'POST',
    body: { content },
  });
}
```
`server-error-codes.ts` 数组加 `'FRIEND_REQUEST_MESSAGE_LIMIT'`。

- [ ] **Step 4: 跑测试 + typecheck**

Run: `cd /Users/yiboding/projects/circle-im && node --test test/friends.api.test.js && npx tsc --noEmit`
Expected: PASS，tsc 0。

- [ ] **Step 5: Commit**

```bash
git add src/services/api/friends.ts src/services/api/server-error-codes.ts test/friends.api.test.js
git commit -m "feat(friend): 前端留言线程 API + 错误码"
```

---

## Task 6: 前端留言 UI（FriendActivityDetailScreen）

**Files:**
- Modify: `src/features/contacts/screens/FriendActivityDetailScreen.tsx`
- Modify: `src/i18n/locales/{zh,en,ja,ko,es}.json`（留言相关文案 + `serverErrors.FRIEND_REQUEST_MESSAGE_LIMIT`）
- Test: `test/friend-activity-detail.test.js`（无则建）

**Interfaces:**
- Consumes: Task 5 的 `fetchFriendRequestMessages` / `sendFriendRequestMessage` / `FriendRequestMessage`；`activity.requestId`、`activity.requestState`、当前用户 id。

- [ ] **Step 1: 写失败测试（源读断言）**

`test/friend-activity-detail.test.js`：
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync('src/features/contacts/screens/FriendActivityDetailScreen.tsx', 'utf8');

test('friend activity detail renders a message thread with a reply input', () => {
  assert.match(src, /fetchFriendRequestMessages/);
  assert.match(src, /sendFriendRequestMessage/);
  // PENDING 才可发
  assert.match(src, /requestState === 'PENDING'/);
  // 输入框 + 发送
  assert.match(src, /TextInput/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle-im && node --test test/friend-activity-detail.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

在 `FriendActivityDetailScreen`：
- import `fetchFriendRequestMessages` / `sendFriendRequestMessage` / `FriendRequestMessage`、`TextInput`、`getApiErrorMessage`、`ApiError`、`useAuthStore`（取当前 userId）。
- state：`const [messages, setMessages] = useState<FriendRequestMessage[]>([])`、`const [draft, setDraft] = useState('')`、`const [sending, setSending] = useState(false)`。
- 进入拉取：`useEffect` 里 `if (activity?.requestId) fetchFriendRequestMessages(activity.requestId).then(setMessages).catch(...)`。
- 把原「附言」单条区替换为：`messages` 列表（气泡：`senderId === currentUserId` 靠右，否则靠左；显示 content + createdAt）。若 `messages` 为空回退显示 `activity.messageSnapshot`。
- `activity.requestState === 'PENDING'` 时渲染底部 `TextInput`（`value={draft}`）+ 发送按钮：
```ts
const handleSend = useCallback(async () => {
  const content = draft.trim();
  if (!content || sending || !activity?.requestId) return;
  setSending(true);
  try {
    const created = await sendFriendRequestMessage(activity.requestId, content);
    setMessages((prev) => [...prev, created]);
    setDraft('');
  } catch (error) {
    Alert.alert(t('contacts.friendActivity.sendFailed'), getApiErrorMessage(error, t('contacts.friendActivity.sendFailed')));
  } finally {
    setSending(false);
  }
}, [draft, sending, activity?.requestId, t]);
```

- [ ] **Step 4: 5 语言补键**

每个 `locales/*.json` 的 `contacts.friendActivity` 下加（示例 zh）：
```json
"replyPlaceholder": "输入留言…",
"send": "发送",
"sendFailed": "发送失败，请稍后重试",
```
每个 `locales/*.json` 的 `serverErrors` 下加（示例 zh）：
```json
"FRIEND_REQUEST_MESSAGE_LIMIT": "对方回复前最多发送 5 条留言"
```
（en/ja/ko/es 对应翻译。）

- [ ] **Step 5: 跑测试 + typecheck + i18n parity**

Run:
```bash
cd /Users/yiboding/projects/circle-im
node --test test/friend-activity-detail.test.js && npx tsc --noEmit && node --test "test/*i18n*" "test/*locale*" 2>/dev/null || node --test test/*.js 2>&1 | grep -E '^ℹ (pass|fail)'
```
Expected: 目标测试 PASS，tsc 0，i18n parity 绿。

- [ ] **Step 6: Commit**

```bash
git add src/features/contacts/screens/FriendActivityDetailScreen.tsx src/i18n/locales/*.json test/friend-activity-detail.test.js
git commit -m "feat(friend): 好友申请详情留言列表 + 回复输入框(双侧对称) + 5 语言"
```

---

## Task 7: 前端通知落地路由（FRIEND_REQUEST_MESSAGE → 详情）

**Files:**
- Modify: `src/features/notifications/utils/push-notification-route.ts`
- Modify: `src/features/notifications/utils/snackbar-route.ts`
- Test: `test/notification-targeting.test.js`、`test/snackbar-route.test.js`

**Interfaces:**
- Consumes: 通知 data 里的好友申请标识（`requestId`/`activityId`）。落地到好友申请页（列表或详情）。

- [ ] **Step 1: 写失败测试**

`test/notification-targeting.test.js` 加：`FRIEND_REQUEST_MESSAGE` 类型的通知 → 路由解析到好友申请页（`new-friends`）。参照现有 `FRIEND_REQUEST_*` 用例断言 `resolvePushNotificationRoute({ type: 'FRIEND_REQUEST_MESSAGE', ... })` 返回 `/(tabs)/contacts/new-friends`（或带 id 的详情）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/yiboding/projects/circle-im && node --test test/notification-targeting.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现**

`push-notification-route.ts` 的 `FRIEND_NOTIFICATION_TYPES` Set 加 `'FRIEND_REQUEST_MESSAGE'`（复用现有 friend → `/(tabs)/contacts/new-friends` 分支）。`snackbar-route.ts` 里 `item.type.startsWith('FRIEND_REQUEST')` 已覆盖 `FRIEND_REQUEST_MESSAGE`（确认无需改；若详情需带 id，则加分支用 `getFriendActivityDetailHref`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/yiboding/projects/circle-im && node --test test/notification-targeting.test.js test/snackbar-route.test.js`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/features/notifications/utils/push-notification-route.ts src/features/notifications/utils/snackbar-route.ts test/notification-targeting.test.js
git commit -m "feat(friend): FRIEND_REQUEST_MESSAGE 通知落地到好友申请页"
```

---

## Task 8: 全量验证

- [ ] **Step 1: 后端全测 + typecheck**

Run: `cd /Users/yiboding/projects/circle_be && npx tsc --noEmit && npx jest src/friend src/notification`
Expected: 0 error，全 PASS。

- [ ] **Step 2: 前端全测 + typecheck**

Run: `cd /Users/yiboding/projects/circle-im && npx tsc --noEmit && node --test "test/*.js" 2>&1 | grep -E '^ℹ (pass|fail)'`
Expected: tsc 0，fail 0。

- [ ] **Step 3: 端到端手测（需后端跑 + 两账号）**

A 向 B 发申请带附言 → B 在申请详情看到附言、回复 → A 收到通知、进来看到 B 回复并再回 → B 接受 → 双方聊天首屏出现之前的往来。防刷：B 未回复前 A 连发第 6 条被拒并提示。

---

## Self-Review

- **Spec 覆盖**：模型(T1)、首条附言入线程(T2)、拉/发端点+防刷+通知(T3)、accept 注入历史(T4)、前端 API(T5)、详情 UI+i18n(T6)、通知落地(T7)、验证(T8) —— 覆盖 spec 全部章节。
- **占位符**：核心代码均给出；DTO/controller 装饰器名以「该 controller 现有 accept 路由」为准（实现时对齐既有 `@CurrentUser`/`JwtGuard`）。
- **类型一致**：`FriendRequestMessage {id,senderId,content,createdAt}` 前后端一致；`appendRequestMessage`/`sendFriendRequestMessage` 返回同形。
- **已知取舍**：注入历史用服务器时间（spec 已声明）；错误码 `FRIEND_REQUEST_MESSAGE_LIMIT` 前后端一致。
