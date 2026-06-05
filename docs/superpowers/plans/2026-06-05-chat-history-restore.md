# Chat History Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore server-side OpenIM chat history into the device OpenIM local message store after reinstall, device change, or local store loss.

**Architecture:** The backend exposes an authenticated, read-only chat history page API backed by OpenIM MongoDB. The app detects local history gaps when opening a conversation, pulls missing pages from the backend, inserts each missing message into OpenIM RN SDK local storage, then reloads the conversation from the SDK so existing UI/search paths keep working.

**Tech Stack:** NestJS, Jest, MongoDB OpenIM collections, Expo React Native, OpenIM RN SDK, Node `node:test`, TypeScript.

---

## File Structure

### Backend repo: `/Users/yiboding/projects/circle_be`

- Create `src/chat-history/dto/chat-history.dto.ts`
  - Query validation DTO and Swagger response DTOs.
- Create `src/chat-history/chat-history.service.ts`
  - Conversation ID parsing, permission checks, OpenIM Mongo document reads, message conversion, pagination.
- Create `src/chat-history/chat-history.controller.ts`
  - JWT-protected endpoint `GET /chat-history/conversations/:conversationID/messages`.
- Create `src/chat-history/chat-history.module.ts`
  - Exports controller/service and imports `PrismaModule`.
- Create `src/chat-history/chat-history.service.spec.ts`
  - Unit tests for permission, filtering, pagination, field conversion.
- Modify `src/app.module.ts`
  - Import and register `ChatHistoryModule`.

### App repo: `/Users/yiboding/projects/circle-im`

- Create `src/services/api/chat-history.ts`
  - Typed API wrapper and DTO-to-OpenIM-message conversion helper.
- Create `src/im/history-restore.ts`
  - Restore orchestration: detect gap, fetch pages, de-dupe via `findMessageList`, insert into OpenIM local storage.
- Modify `src/im/client.ts`
  - Export a small local-history read helper or delegate `loadConversationMessages()` refresh after restore; remove temporary diagnostic logging before final.
- Modify `src/features/chat/screens/ChatDetailScreen.tsx`
  - Trigger restore after initial `loadConversationMessages()` resolves; keep it non-blocking.
- Test `test/chat-history-api.test.js`
  - API wrapper endpoint and DTO conversion source assertions.
- Test `test/im-history-restore.test.js`
  - Restore orchestration with OpenIM and backend stubs.
- Test `test/chat-info-screen.test.js`
  - Existing source-level test updated to assert chat detail triggers restore.

---

### Task 1: Backend DTO And Module Skeleton

**Files:**
- Create: `/Users/yiboding/projects/circle_be/src/chat-history/dto/chat-history.dto.ts`
- Create: `/Users/yiboding/projects/circle_be/src/chat-history/chat-history.module.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/app.module.ts`
- Test: `/Users/yiboding/projects/circle_be/src/chat-history/chat-history.service.spec.ts`

- [ ] **Step 1: Write failing module/DTO tests**

Create `src/chat-history/chat-history.service.spec.ts` with a first structural test:

```ts
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ChatHistoryQueryDto } from './dto/chat-history.dto';

describe('ChatHistory DTOs', () => {
  it('caps message page size through query validation metadata', () => {
    const dto = plainToInstance(ChatHistoryQueryDto, {
      limit: '500',
      beforeSeq: '42',
    });

    const errors = validateSync(dto);

    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yiboding/projects/circle_be
pnpm jest src/chat-history/chat-history.service.spec.ts --runInBand
```

Expected: FAIL because `ChatHistoryQueryDto` does not exist.

- [ ] **Step 3: Implement DTO and module skeleton**

Create `dto/chat-history.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ChatHistoryQueryDto {
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 100;

  @ApiPropertyOptional({ description: 'Return messages with seq lower than this value' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeSeq?: number;
}

export class RestorableMessageDto {
  @ApiProperty() clientMsgID!: string;
  @ApiProperty() serverMsgID!: string;
  @ApiProperty() sendID!: string;
  @ApiProperty() recvID!: string;
  @ApiProperty() groupID!: string;
  @ApiProperty() senderNickname!: string;
  @ApiProperty() senderFaceUrl!: string;
  @ApiProperty() sessionType!: number;
  @ApiProperty() contentType!: number;
  @ApiProperty() status!: number;
  @ApiProperty() seq!: number;
  @ApiProperty() sendTime!: number;
  @ApiProperty() createTime!: number;
  @ApiProperty() content!: string;
  @ApiProperty() attachedInfo!: string;
  @ApiProperty() ex!: string;
  @ApiProperty() isRead!: boolean;
}

export class ChatHistoryMessagePageDto {
  @ApiProperty() conversationID!: string;
  @ApiProperty({ type: [RestorableMessageDto] }) messages!: RestorableMessageDto[];
  @ApiProperty() hasMore!: boolean;
  @ApiProperty({ nullable: true }) nextBeforeSeq!: number | null;
  @ApiProperty({ nullable: true }) serverMinSeq!: number | null;
  @ApiProperty({ nullable: true }) serverMaxSeq!: number | null;
}
```

Create `chat-history.module.ts` with controller/service placeholders if needed in later tasks.

Register `ChatHistoryModule` in `src/app.module.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/yiboding/projects/circle_be
pnpm jest src/chat-history/chat-history.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/chat-history src/app.module.ts
git commit -m "feat: add chat history module skeleton"
```

---

### Task 2: Backend History Service

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/chat-history/chat-history.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/chat-history/chat-history.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Extend `chat-history.service.spec.ts` with mocked Mongo-like collection behavior. The service should accept an injected Mongo adapter seam to avoid real DB in tests; the simplest implementation can use a private `getMongoDb()` method and tests can spy on it.

Add tests for:

```ts
it('returns single conversation messages only when the current user is a participant', async () => {
  // userId "0a9ad3d6-ef1d-47bd-9cbc-cda1cee57547" -> im id without hyphens
  // conversationID "si_0a9..._d6b..."
  // expect 2 returned messages, msg:null and del_list current user filtered
});

it('returns 404 for a third-party single conversation read', async () => {
  // current user im id not in conversationID
});

it('checks group membership before returning group messages', async () => {
  // group_member.findOne returns a record for current user
});

it('paginates by beforeSeq and returns nextBeforeSeq', async () => {
  // beforeSeq=10 returns seq < 10, ordered ascending in response
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/yiboding/projects/circle_be
pnpm jest src/chat-history/chat-history.service.spec.ts --runInBand
```

Expected: FAIL because `ChatHistoryService` behavior is missing.

- [ ] **Step 3: Implement service**

Create `chat-history.service.ts`:

```ts
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoClient, Db } from 'mongodb';
import { OpenimService } from 'src/openim/openim.service';
import { ChatHistoryMessagePageDto, RestorableMessageDto } from './dto/chat-history.dto';

type OpenIMMessageWrapper = {
  msg?: Record<string, any> | null;
  del_list?: string[];
  is_read?: boolean;
};

@Injectable()
export class ChatHistoryService {
  private mongoClient: MongoClient | null = null;

  constructor(private readonly config: ConfigService) {}

  async getMessages(
    userId: string,
    conversationID: string,
    limit = 100,
    beforeSeq?: number,
  ): Promise<ChatHistoryMessagePageDto> {
    const currentImUserID = OpenimService.toImUserId(userId);
    const parsed = this.parseConversationID(conversationID);

    if (parsed.type === 'single') {
      if (!parsed.userIDs.includes(currentImUserID)) {
        throw new NotFoundException('会话不存在');
      }
    } else {
      await this.ensureGroupMembership(parsed.groupID, currentImUserID);
    }

    const db = await this.getMongoDb();
    const docs = await db
      .collection('msg')
      .find({ doc_id: { $regex: `^${this.escapeRegex(conversationID)}:` } })
      .toArray();

    const all = docs
      .flatMap((doc: any) => (Array.isArray(doc.msgs) ? doc.msgs : []))
      .filter((item: OpenIMMessageWrapper) => item?.msg)
      .filter((item: OpenIMMessageWrapper) => !(item.del_list ?? []).includes(currentImUserID))
      .map((item: OpenIMMessageWrapper) => this.toDto(item))
      .filter((message) => Number.isFinite(message.seq))
      .sort((a, b) => a.seq - b.seq);

    const serverMinSeq = all[0]?.seq ?? null;
    const serverMaxSeq = all[all.length - 1]?.seq ?? null;
    const eligible = beforeSeq ? all.filter((message) => message.seq < beforeSeq) : all;
    const pageDescending = [...eligible].sort((a, b) => b.seq - a.seq).slice(0, limit);
    const messages = pageDescending.sort((a, b) => a.seq - b.seq);
    const nextBeforeSeq = messages.length > 0 ? messages[0].seq : null;
    const hasMore = nextBeforeSeq != null && all.some((message) => message.seq < nextBeforeSeq);

    return { conversationID, messages, hasMore, nextBeforeSeq, serverMinSeq, serverMaxSeq };
  }

  private parseConversationID(conversationID: string) {
    if (conversationID.startsWith('si_')) {
      const userIDs = conversationID.slice(3).split('_');
      if (userIDs.length === 2 && userIDs.every(Boolean)) return { type: 'single' as const, userIDs };
    }
    if (conversationID.startsWith('sg_')) {
      const groupID = conversationID.slice(3);
      if (groupID) return { type: 'group' as const, groupID };
    }
    throw new NotFoundException('会话不存在');
  }

  private async ensureGroupMembership(groupID: string, userID: string) {
    const db = await this.getMongoDb();
    const member = await db.collection('group_member').findOne({
      group_id: groupID,
      user_id: userID,
    });
    if (!member) throw new NotFoundException('会话不存在');
  }

  private toDto(item: OpenIMMessageWrapper): RestorableMessageDto {
    const msg = item.msg!;
    return {
      clientMsgID: String(msg.client_msg_id ?? ''),
      serverMsgID: String(msg.server_msg_id ?? ''),
      sendID: String(msg.send_id ?? ''),
      recvID: String(msg.recv_id ?? ''),
      groupID: String(msg.group_id ?? ''),
      senderNickname: String(msg.sender_nickname ?? ''),
      senderFaceUrl: String(msg.sender_face_url ?? ''),
      sessionType: Number(msg.session_type ?? 0),
      contentType: Number(msg.content_type ?? 0),
      status: Number(msg.status ?? 0),
      seq: Number(msg.seq ?? 0),
      sendTime: Number(msg.send_time ?? 0),
      createTime: Number(msg.create_time ?? 0),
      content: String(msg.content ?? ''),
      attachedInfo: String(msg.attached_info ?? ''),
      ex: String(msg.ex ?? ''),
      isRead: Boolean(item.is_read ?? msg.is_read),
    };
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async getMongoDb(): Promise<Db> {
    // Implement from env first: OPENIM_MONGO_URI, fallback to OPENIM_MONGO_* values if present.
  }
}
```

Use existing OpenIM docker env names where available:

- `OPENIM_MONGO_URI` preferred for production.
- fallback composed from `MONGO_USERNAME`, `MONGO_PASSWORD`, `MONGO_ADDRESS`, `MONGO_DATABASE` or current OpenIM env equivalents.

If `mongodb` package is not installed, add it to `circle_be` dependencies.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/yiboding/projects/circle_be
pnpm jest src/chat-history/chat-history.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add package.json pnpm-lock.yaml src/chat-history
git commit -m "feat: read OpenIM chat history pages"
```

---

### Task 3: Backend Controller Endpoint

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/chat-history/chat-history.controller.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/chat-history/chat-history.module.ts`
- Test: `/Users/yiboding/projects/circle_be/src/chat-history/chat-history.controller.spec.ts`

- [ ] **Step 1: Write failing controller test**

Create a Nest testing module test that instantiates `ChatHistoryController` with a mocked service:

```ts
it('passes current user, conversation id, and query options to service', async () => {
  const service = { getMessages: jest.fn().mockResolvedValue({ messages: [] }) };
  const controller = new ChatHistoryController(service as any);

  await controller.getMessages(
    { user: { userId: 'user-1' } } as any,
    'si_a_b',
    { limit: 50, beforeSeq: 10 },
  );

  expect(service.getMessages).toHaveBeenCalledWith('user-1', 'si_a_b', 50, 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yiboding/projects/circle_be
pnpm jest src/chat-history/chat-history.controller.spec.ts --runInBand
```

Expected: FAIL because controller does not exist or method is missing.

- [ ] **Step 3: Implement controller**

```ts
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestWithUser } from 'src/auth/types';
import { JwtGuard } from 'src/guards/jwt.guard';
import { ChatHistoryService } from './chat-history.service';
import { ChatHistoryMessagePageDto, ChatHistoryQueryDto } from './dto/chat-history.dto';

@ApiTags('Chat History')
@ApiBearerAuth()
@UseGuards(JwtGuard)
@Controller('chat-history')
export class ChatHistoryController {
  constructor(private readonly service: ChatHistoryService) {}

  @Get('conversations/:conversationID/messages')
  @ApiOperation({ summary: 'Read restorable OpenIM history for a conversation' })
  @ApiOkResponse({ type: ChatHistoryMessagePageDto })
  getMessages(
    @Req() req: RequestWithUser,
    @Param('conversationID') conversationID: string,
    @Query() query: ChatHistoryQueryDto,
  ) {
    return this.service.getMessages(
      req.user.userId,
      conversationID,
      query.limit ?? 100,
      query.beforeSeq,
    );
  }
}
```

- [ ] **Step 4: Run controller and service tests**

Run:

```bash
cd /Users/yiboding/projects/circle_be
pnpm jest src/chat-history --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle_be
git add src/chat-history src/app.module.ts
git commit -m "feat: expose chat history restore endpoint"
```

---

### Task 4: App API Wrapper And Message Conversion

**Files:**
- Create: `/Users/yiboding/projects/circle-im/src/services/api/chat-history.ts`
- Create: `/Users/yiboding/projects/circle-im/test/chat-history-api.test.js`

- [ ] **Step 1: Write failing API wrapper test**

Create `test/chat-history-api.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat history api fetches conversation message pages', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/services/api/chat-history.ts'), 'utf8');

  assert.match(source, /fetchRestorableConversationMessages/);
  assert.match(source, /\/chat-history\/conversations\/\$\{encodeURIComponent\(conversationID\)\}\/messages/);
  assert.match(source, /beforeSeq/);
  assert.match(source, /toOpenIMMessageItem/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yiboding/projects/circle-im
node --test test/chat-history-api.test.js
```

Expected: FAIL because file does not exist.

- [ ] **Step 3: Implement API wrapper**

Create `src/services/api/chat-history.ts`:

```ts
import type { MessageItem } from '@openim/rn-client-sdk';
import { apiClient } from '@/services/api/client';

export type RestorableMessageDto = {
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
};

export type ChatHistoryMessagePage = {
  conversationID: string;
  messages: RestorableMessageDto[];
  hasMore: boolean;
  nextBeforeSeq: number | null;
  serverMinSeq: number | null;
  serverMaxSeq: number | null;
};

export async function fetchRestorableConversationMessages(params: {
  conversationID: string;
  limit?: number;
  beforeSeq?: number | null;
}) {
  const { conversationID, limit = 100, beforeSeq } = params;
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeSeq != null) query.set('beforeSeq', String(beforeSeq));
  return apiClient<ChatHistoryMessagePage>(
    `/chat-history/conversations/${encodeURIComponent(conversationID)}/messages?${query.toString()}`,
  );
}

export function toOpenIMMessageItem(message: RestorableMessageDto): MessageItem {
  return {
    clientMsgID: message.clientMsgID,
    serverMsgID: message.serverMsgID,
    sendID: message.sendID,
    recvID: message.recvID,
    groupID: message.groupID,
    senderNickname: message.senderNickname,
    senderFaceUrl: message.senderFaceUrl,
    sessionType: message.sessionType,
    contentType: message.contentType,
    status: message.status,
    seq: message.seq,
    sendTime: message.sendTime,
    createTime: message.createTime,
    content: message.content,
    attachedInfo: message.attachedInfo,
    ex: message.ex,
    isRead: message.isRead,
  } as MessageItem;
}
```

- [ ] **Step 4: Run test and TypeScript**

Run:

```bash
cd /Users/yiboding/projects/circle-im
node --test test/chat-history-api.test.js
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle-im
git add src/services/api/chat-history.ts test/chat-history-api.test.js
git commit -m "feat: add chat history restore api client"
```

---

### Task 5: App Restore Orchestration

**Files:**
- Create: `/Users/yiboding/projects/circle-im/src/im/history-restore.ts`
- Create: `/Users/yiboding/projects/circle-im/test/im-history-restore.test.js`
- Modify: `/Users/yiboding/projects/circle-im/src/im/client.ts`

- [ ] **Step 1: Write failing restore tests**

Create `test/im-history-restore.test.js` using the existing VM TypeScript loader pattern from `test/im-client-chat-settings.test.js`.

Test cases:

```js
test('restoreConversationMessages inserts missing single messages into OpenIM local storage', async () => {
  // SDK getAdvancedHistoryMessageList returns only seq 15.
  // backend returns seq 1 and 2.
  // findMessageList returns [] for missing.
  // assert insertSingleMessageToLocalStorage called twice.
});

test('restoreConversationMessages skips messages already present locally', async () => {
  // findMessageList returns an existing item for one clientMsgID.
  // assert only missing item inserted.
});

test('restoreConversationMessages inserts group messages through group local storage api', async () => {
  // sessionType Group.
  // assert insertGroupMessageToLocalStorage called.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yiboding/projects/circle-im
node --test test/im-history-restore.test.js
```

Expected: FAIL because `src/im/history-restore.ts` does not exist.

- [ ] **Step 3: Expose local message helpers from `client.ts`**

In `src/im/client.ts`, export a helper for local SDK history reads without changing behavior:

```ts
export async function readLocalConversationMessages(conversationID: string, count = 50) {
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) return [];
  const result = await OpenIMSDK.getAdvancedHistoryMessageList({
    conversationID,
    count,
    startClientMsgID: '',
    viewType: ViewType.History,
  });
  return result.messageList;
}
```

Update `loadConversationMessages()` to call this helper, set store, and remove temporary `[openim] loadConversationMessages result` diagnostics before final.

- [ ] **Step 4: Implement `history-restore.ts`**

```ts
import OpenIMSDK, { SessionType, type MessageItem } from '@openim/rn-client-sdk';
import {
  fetchRestorableConversationMessages,
  toOpenIMMessageItem,
} from '@/services/api/chat-history';
import { useIMStore } from '@/stores/imStore';
import { loadConversationMessages, readLocalConversationMessages } from '@/im/client';

const DEFAULT_RESTORE_LIMIT = 100;
const DEFAULT_MAX_MESSAGES = 500;

export async function restoreConversationMessages(params: {
  conversationID: string;
  sourceID: string;
  sessionType: SessionType;
  maxMessages?: number;
}) {
  const { conversationID, sourceID, sessionType, maxMessages = DEFAULT_MAX_MESSAGES } = params;
  const localMessages = await readLocalConversationMessages(conversationID, DEFAULT_RESTORE_LIMIT);
  const localIDs = new Set(localMessages.map((message) => message.clientMsgID));
  let beforeSeq: number | null | undefined = undefined;
  let fetched = 0;
  let inserted = 0;

  while (fetched < maxMessages) {
    const page = await fetchRestorableConversationMessages({
      conversationID,
      limit: Math.min(DEFAULT_RESTORE_LIMIT, maxMessages - fetched),
      beforeSeq,
    });
    fetched += page.messages.length;
    if (page.messages.length === 0) break;

    for (const dto of page.messages) {
      if (localIDs.has(dto.clientMsgID)) continue;
      const existing = await OpenIMSDK.findMessageList([
        { conversationID, clientMsgIDList: [dto.clientMsgID] },
      ]);
      if (existing.length > 0) {
        localIDs.add(dto.clientMsgID);
        continue;
      }
      const message = toOpenIMMessageItem(dto);
      await insertLocalMessage({ message, sourceID, sessionType });
      localIDs.add(dto.clientMsgID);
      inserted += 1;
    }

    if (!page.hasMore || page.nextBeforeSeq == null) break;
    beforeSeq = page.nextBeforeSeq;
  }

  if (inserted > 0) {
    await loadConversationMessages(conversationID);
  }
  return { fetched, inserted };
}

async function insertLocalMessage(params: {
  message: MessageItem;
  sourceID: string;
  sessionType: SessionType;
}) {
  const { message, sourceID, sessionType } = params;
  const currentUserID = useIMStore.getState().currentUserID;
  if (sessionType === SessionType.Group) {
    await OpenIMSDK.insertGroupMessageToLocalStorage({
      message,
      groupID: message.groupID || sourceID,
      sendID: message.sendID,
    });
    return;
  }

  const fallbackRecvID = message.sendID === currentUserID ? sourceID : currentUserID;
  await OpenIMSDK.insertSingleMessageToLocalStorage({
    message,
    recvID: message.recvID || fallbackRecvID || sourceID,
    sendID: message.sendID,
  });
}
```

If SDK type for `findMessageList` differs, adapt implementation to the installed SDK signature.

- [ ] **Step 5: Run restore tests**

Run:

```bash
cd /Users/yiboding/projects/circle-im
node --test test/im-history-restore.test.js
node --test test/im-client-chat-settings.test.js
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/yiboding/projects/circle-im
git add src/im/client.ts src/im/history-restore.ts test/im-history-restore.test.js
git commit -m "feat: restore OpenIM history into local storage"
```

---

### Task 6: Chat Detail Trigger

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/chat/screens/ChatDetailScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`

- [ ] **Step 1: Write failing source-level test**

Add to `test/chat-info-screen.test.js`:

```js
test('chat detail attempts non-blocking history restore after initial message load', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  assert.match(source, /restoreConversationMessages/);
  assert.match(source, /loadConversationMessages\(conversationID\)[\s\S]*restoreConversationMessages/);
  assert.match(source, /conversationID/);
  assert.match(source, /sourceID/);
  assert.match(source, /sessionType:\s*conversationType/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/yiboding/projects/circle-im
node --test test/chat-info-screen.test.js
```

Expected: FAIL because `restoreConversationMessages` is not wired.

- [ ] **Step 3: Wire non-blocking restore**

In `ChatDetailScreen.tsx`, import:

```ts
import { restoreConversationMessages } from '@/im/history-restore';
```

Replace the current fire-and-forget load:

```ts
loadConversationMessages(conversationID).catch(...)
```

with:

```ts
loadConversationMessages(conversationID)
  .then(() =>
    restoreConversationMessages({
      conversationID,
      sourceID:
        conversationType === SessionType.Single ? toImUserId(sourceID) : sourceID,
      sessionType: conversationType,
      maxMessages: 500,
    }),
  )
  .catch((err) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[chat] load/restore conversation messages failed', err);
    }
  });
```

Do not block send actions or navigation on restore.

- [ ] **Step 4: Run tests and TypeScript**

Run:

```bash
cd /Users/yiboding/projects/circle-im
node --test test/chat-info-screen.test.js
node --test test/im-history-restore.test.js
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/yiboding/projects/circle-im
git add src/features/chat/screens/ChatDetailScreen.tsx test/chat-info-screen.test.js
git commit -m "feat: trigger chat history restore on open"
```

---

### Task 7: Integration Verification

**Files:**
- No new files unless fixes are needed.

- [ ] **Step 1: Run backend focused tests**

```bash
cd /Users/yiboding/projects/circle_be
pnpm jest src/chat-history --runInBand
pnpm build
```

Expected: PASS / build success.

- [ ] **Step 2: Run app focused tests**

```bash
cd /Users/yiboding/projects/circle-im
node --test test/chat-history-api.test.js
node --test test/im-history-restore.test.js
node --test test/im-client-chat-settings.test.js
node --test test/chat-info-screen.test.js
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Manual local restore verification**

1. Confirm OpenIM Docker is running.
2. Start backend on `http://192.168.1.65:3000` or simulator-compatible host.
3. Start app:

```bash
cd /Users/yiboding/projects/circle-im
npx expo start --dev-client --clear --port 8081
```

4. Login as the account that owns the single conversation.
5. Enter `si_0a9ad3d6ef1d47bd9cbccda1cee57547_d6bbe83841ea4a0dae8689d5509c1881`.
6. Expected: older seq 1-14 messages are restored into local OpenIM storage and rendered after restore completes.
7. Re-enter the same conversation.
8. Expected: no duplicate messages.

- [ ] **Step 4: Final status**

Run:

```bash
git -C /Users/yiboding/projects/circle_be status --short
git -C /Users/yiboding/projects/circle-im status --short
```

Expected: only unrelated pre-existing changes remain.
