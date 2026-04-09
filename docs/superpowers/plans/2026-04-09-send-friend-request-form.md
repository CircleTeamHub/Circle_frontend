# Send Friend Request Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Chinese-language `发送好友申请` flow that saves greeting, pending remark, and pending tag selections with the request, then automatically applies the saved metadata when the request is accepted.

**Architecture:** Extend the backend friend-request model with sender-owned pending metadata instead of mutating active friendship data while the request is still pending. Introduce a dedicated request-form screen in the Expo app, route profile CTA clicks into that form, and keep placeholder-only rows visually present but functionally inert. On acceptance, the backend migrates pending remark and pending tag rows into the existing accepted-friend remark and tag structures.

**Tech Stack:** NestJS, Prisma, Expo Router, React Native, existing `apiClient`, Node `node:test` in frontend, Jest in backend, TypeScript.

---

## File Structure

- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_friend_request_metadata/migration.sql`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/dto/friend.dto.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.controller.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.service.ts`
- Test: `/Users/yiboding/projects/circle_be/src/friend/friend.service.spec.ts`
- Modify: `/Users/yiboding/projects/circle_be/docs/frontend-api-guide.md`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/friends.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/features/user/screens/UserProfileScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/social/screens/AddFriendScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/social/screens/SendFriendRequestScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/contacts/user/[id]/request.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/social/send-friend-request.ts`
- Test: `/Users/yiboding/projects/circle-im/test/add-friend-screen.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/user-profile-screen.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/send-friend-request-screen.test.js`

### Task 1: Backend Schema And DTO For Pending Request Metadata

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_friend_request_metadata/migration.sql`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/dto/friend.dto.ts`
- Test: `/Users/yiboding/projects/circle_be/src/friend/friend.service.spec.ts`

- [ ] **Step 1: Write the failing backend tests**

```ts
it('stores pending remark and pending tag ids when sending a friend request', async () => {
  await service.sendRequest(senderId, targetId, {
    message: '你好，我是小李',
    remark: '产品同学',
    tagIds: [tagId],
  });

  expect(prisma.friend.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        pendingRemarkBySender: '产品同学',
      }),
    }),
  );
  expect(prisma.pendingFriendTagOnRequest.createMany).toHaveBeenCalled();
});

it('rejects a request when tag ids do not belong to the sender', async () => {
  await expect(
    service.sendRequest(senderId, targetId, {
      message: '你好',
      remark: '同事',
      tagIds: ['foreign-tag-id'],
    }),
  ).rejects.toThrow('Invalid friend tags');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/friend/friend.service.spec.ts --runInBand`  
Expected: FAIL because pending metadata fields and validation do not exist yet.

- [ ] **Step 3: Write minimal schema and DTO implementation**

```prisma
model Friend {
  pendingRemarkBySender String?
  pendingTags           PendingFriendTagOnRequest[]
}

model PendingFriendTagOnRequest {
  id        String   @id @default(uuid())
  ownerId   String
  requestId String
  tagId     String
  createdAt DateTime @default(now())
}
```

```ts
export class SendFriendRequestDto {
  targetId: string;
  message?: string;
  remark?: string;
  tagIds?: string[];
}
```

- [ ] **Step 4: Run backend tests to verify they pass**

Run: `pnpm test src/friend/friend.service.spec.ts --runInBand`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle_be add prisma/schema.prisma prisma/migrations src/friend/dto/friend.dto.ts src/friend/friend.service.spec.ts
git -C /Users/yiboding/projects/circle_be commit -m "feat: add pending friend request metadata schema"
```

### Task 2: Backend Request Send And Accept Logic

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/friend/friend.controller.ts`
- Modify: `/Users/yiboding/projects/circle_be/docs/frontend-api-guide.md`
- Test: `/Users/yiboding/projects/circle_be/src/friend/friend.service.spec.ts`

- [ ] **Step 1: Write the failing backend behavior tests**

```ts
it('applies pending sender remark to the accepted friendship when the request is accepted', async () => {
  await service.handleRequest(recipientId, requestId, 'ACCEPTED');
  expect(prisma.friend.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        state: 'ACCEPTED',
        remarkA: '产品同学',
      }),
    }),
  );
});

it('creates active friend tag assignments from pending request tags on accept', async () => {
  await service.handleRequest(recipientId, requestId, 'ACCEPTED');
  expect(prisma.friendTagOnFriend.createMany).toHaveBeenCalled();
});

it('does not apply pending metadata when a request is rejected', async () => {
  await service.handleRequest(recipientId, requestId, 'REJECTED');
  expect(prisma.friendTagOnFriend.createMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/friend/friend.service.spec.ts --runInBand`  
Expected: FAIL because accept logic does not migrate pending metadata yet.

- [ ] **Step 3: Write minimal service and controller implementation**

```ts
await this.prisma.friend.update({
  where: { id: requestId },
  data: {
    state: FriendState.ACCEPTED,
    remarkA: record.userID === senderId ? record.pendingRemarkBySender : record.remarkA,
  },
});

await this.prisma.friendTagOnFriend.createMany({
  data: pendingTags.map((tag) => ({
    ownerID: tag.ownerId,
    tagID: tag.tagId,
    friendID: requestId,
  })),
  skipDuplicates: true,
});
```

- [ ] **Step 4: Run backend tests to verify they pass**

Run: `pnpm test src/friend/friend.service.spec.ts --runInBand`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle_be add src/friend/friend.service.ts src/friend/friend.controller.ts src/friend/friend.service.spec.ts docs/frontend-api-guide.md
git -C /Users/yiboding/projects/circle_be commit -m "feat: apply pending request metadata on accept"
```

### Task 3: Frontend Request API And Form Helpers

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/friends.ts`
- Create: `/Users/yiboding/projects/circle-im/src/features/social/send-friend-request.ts`
- Test: `/Users/yiboding/projects/circle-im/test/send-friend-request-screen.test.js`

- [ ] **Step 1: Write the failing frontend helper tests**

```js
test('createFriendRequest sends message, remark, and tagIds in the request body', async () => {
  const { createFriendRequest } = loadFriendsApi();
  await createFriendRequest({
    targetId: 'target-id',
    message: '你好，我是小李',
    remark: '产品同学',
    tagIds: ['tag-1'],
  });

  assert.deepEqual(lastRequest.body, {
    targetId: 'target-id',
    message: '你好，我是小李',
    remark: '产品同学',
    tagIds: ['tag-1'],
  });
});

test('buildSendFriendRequestInitialMessage falls back to accountId when nickname is absent', () => {
  const { buildSendFriendRequestInitialMessage } = loadSendFriendRequestHelpers();
  assert.equal(
    buildSendFriendRequestInitialMessage({ nickname: '', accountId: 'meigui' }),
    '你好，我是 meigui',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/send-friend-request-screen.test.js test/profile-api.test.js`  
Expected: FAIL because the helper module and expanded API contract do not exist yet.

- [ ] **Step 3: Write minimal frontend helper implementation**

```ts
export function buildSendFriendRequestInitialMessage(user: {
  nickname?: string | null;
  accountId: string;
}) {
  return `你好，我是 ${user.nickname?.trim() || user.accountId}`;
}
```

```ts
export async function createFriendRequest(input: {
  targetId: string;
  message?: string;
  remark?: string;
  tagIds?: string[];
}) {
  return apiClient<void>('/friend/requests', {
    method: 'POST',
    body: input,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/send-friend-request-screen.test.js test/profile-api.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/services/api/friends.ts src/features/social/send-friend-request.ts test/send-friend-request-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: add send friend request form helpers"
```

### Task 4: Profile CTA And Send Request Screen UI

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/user/screens/UserProfileScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/social/screens/SendFriendRequestScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/contacts/user/[id]/request.tsx`
- Modify: `/Users/yiboding/projects/circle-im/test/user-profile-screen.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/send-friend-request-screen.test.js`

- [ ] **Step 1: Write the failing screen tests**

```js
test('user profile navigates to the send request form instead of sending directly', () => {
  const source = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(source, /router\.push/);
  assert.match(source, /request/);
});

test('send friend request screen renders Chinese form sections and placeholder rows', () => {
  const source = read('src/features/social/screens/SendFriendRequestScreen.tsx');
  assert.match(source, /发送好友申请/);
  assert.match(source, /验证消息/);
  assert.match(source, /备注名/);
  assert.match(source, /标签/);
  assert.match(source, /照片备注/);
  assert.match(source, /朋友权限/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/user-profile-screen.test.js test/send-friend-request-screen.test.js`  
Expected: FAIL because the dedicated form screen and route do not exist yet.

- [ ] **Step 3: Write minimal screen implementation**

```tsx
router.push({
  pathname: '/(tabs)/contacts/user/[id]/request',
  params: { id: profileId, name: profile.name },
});
```

```tsx
<Text>验证消息</Text>
<TextInput value={message} onChangeText={setMessage} />
<Text>备注名</Text>
<TextInput value={remark} onChangeText={setRemark} />
<Pressable onPress={showTagsSheet}>
  <Text>标签</Text>
</Pressable>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/user-profile-screen.test.js test/send-friend-request-screen.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/features/user/screens/UserProfileScreen.tsx src/features/social/screens/SendFriendRequestScreen.tsx app/(tabs)/contacts/user/[id]/request.tsx test/user-profile-screen.test.js test/send-friend-request-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: add send friend request screen"
```

### Task 5: Search Screen Copy, Submission State, And Manual Validation

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/social/screens/AddFriendScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/social/screens/SendFriendRequestScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/test/add-friend-screen.test.js`
- Modify: `/Users/yiboding/projects/circle-im/test/send-friend-request-screen.test.js`

- [ ] **Step 1: Write the failing UI behavior tests**

```js
test('add friend search screen copy explains that request fields are completed on the profile form page', () => {
  const source = read('src/features/social/screens/AddFriendScreen.tsx');
  assert.match(source, /进入对方详情页后填写申请信息/);
});

test('send button disables during submit to prevent duplicate requests', () => {
  const source = read('src/features/social/screens/SendFriendRequestScreen.tsx');
  assert.match(source, /disabled=.*isSubmitting/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/add-friend-screen.test.js test/send-friend-request-screen.test.js`  
Expected: FAIL because the old copy and submit-state handling are still present.

- [ ] **Step 3: Write minimal UX refinements**

```tsx
<Text>
  输入对方的 accountId 搜索好友，进入对方详情页后填写申请信息并发送。
</Text>
```

```tsx
<Pressable disabled={isSubmitting || !targetId} onPress={handleSubmit}>
  <Text>发送</Text>
</Pressable>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/add-friend-screen.test.js test/send-friend-request-screen.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/features/social/screens/AddFriendScreen.tsx src/features/social/screens/SendFriendRequestScreen.tsx test/add-friend-screen.test.js test/send-friend-request-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: refine send friend request flow copy and submit state"
```

### Task 6: End-To-End Verification

**Files:**
- Verify backend and frontend files above

- [ ] **Step 1: Run frontend tests**

Run: `node --test test/add-friend-screen.test.js test/user-profile-screen.test.js test/send-friend-request-screen.test.js test/friend-activities.test.js test/contact-friends.test.js test/contacts-screen.test.js test/profile-api.test.js test/api-utils.test.js test/auth-api.test.js`  
Expected: PASS

- [ ] **Step 2: Run frontend typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 3: Run backend tests**

Run: `pnpm test src/friend/friend.service.spec.ts src/user/__tests__/user.controller.spec.ts src/user/__tests__/user.service.spec.ts --runInBand`  
Expected: PASS

- [ ] **Step 4: Run backend typecheck**

Run: `pnpm exec tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Manual verification**

Verify:
- search by `accountId` still works
- profile page now enters the `发送好友申请` form instead of sending immediately
- request form can submit greeting, remark, and existing tags
- placeholder rows are visible but non-functional
- recipient sees the request in `新的朋友`
- after acceptance, the sender's remark and selected tags are active on the friendship
