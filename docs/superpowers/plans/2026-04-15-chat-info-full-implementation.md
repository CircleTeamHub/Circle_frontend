# Chat Info Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully implement every actionable row in the friend chat info screen, using OpenIM for conversation-level settings and business APIs for friend-level settings.

**Architecture:** Keep `ChatInfoScreen` as a thin UI shell. Move all conversation-setting reads/writes behind `src/im/client.ts` and a small chat-info view-model helper so the screen renders real state instead of local placeholders. Friend relationship actions continue to use REST APIs under `src/services/api/friends.ts`; rows that need new backend support are implemented only after the server contract exists.

**Tech Stack:** Expo Router, React Native, Zustand, OpenIM RN SDK, existing REST API client, Node built-in test runner

---

## File Map

- Modify: `src/features/chat/screens/ChatInfoScreen.tsx`
  Render real row state, loading, confirmation flows, and routing.
- Create: `src/features/chat/chat-info.ts`
  Derive chat-info screen state from `ConversationItem`, convert SDK fields into UI values, and centralize row helpers.
- Modify: `src/im/client.ts`
  Add OpenIM wrappers for pin, mute, burn duration, clear/delete conversation, blacklist, remove blacklist, and delete friend.
- Modify: `src/stores/imStore.ts`
  Add focused helpers for updating or removing a single conversation/messages entry after destructive actions.
- Modify: `src/services/api/friends.ts`
  Add missing friend-domain APIs once backend endpoints exist for blacklist, report, and delete friend if business backend is the source of truth.
- Create: `src/features/chat/store/use-chat-preferences-store.ts`
  Persist per-conversation local chat background preference for the first non-synced version.
- Create: `src/features/chat/screens/ChatBackgroundScreen.tsx`
  Background selection screen for preset/global/custom options.
- Create: `src/features/chat/screens/RecommendFriendScreen.tsx`
  Friend-card forwarding flow that selects a destination conversation and sends a card message.
- Create: `src/features/chat/screens/ReportFriendScreen.tsx`
  Report submission form after backend API exists.
- Modify: `src/features/user/utils/routes.ts`
  Add route builders for new chat background, recommend, and report flows if separate screens are used.
- Modify: `app/(tabs)/messages/_layout.tsx`
  Register any new chat-info child routes.
- Create: `test/chat-info-screen.test.js`
  Expand static assertions for real rows, route wiring, and removed placeholder logic.
- Modify: `test/chat-detail-screen.test.js`
  Add assertions for background/read-side effects when chat detail starts consuming new stores.
- Modify: `test/user-profile-screen.test.js`
  Keep profile entrypoint assertions aligned if route params or flows change.
- Create: `test/im-client-chat-settings.test.js`
  Unit-test new OpenIM wrapper calls via TypeScript transpile + stubs.
- Create: `test/chat-info-view-model.test.js`
  Unit-test `ConversationItem` to UI-state conversion and destructive-action reducers.
- Create: `test/chat-preferences-store.test.js`
  Unit-test local background persistence and fallback logic.

## Phase Split

- Phase 1: Finish rows that can be implemented immediately with existing client/SDK capabilities.
- Phase 2: Add non-synced local background and friend recommendation flow.
- Phase 3: Add rows blocked on backend contract: blacklist if business-owned, report, delete friend.

## Product Decisions Locked By This Plan

- `置顶聊天` maps to OpenIM `isPinned`.
- `消息免打扰` maps to OpenIM `recvMsgOpt`.
- `好友消息自毁` maps to OpenIM `burnDuration`, with first release options `关闭 / 10秒 / 1分钟 / 5分钟`.
- `清空聊天记录` clears messages but keeps the conversation shell.
- `聊天背景` first ships as local-only per conversation, with `跟随全局` as the default.
- `把他推荐给朋友` sends a friend card message to another conversation instead of a fake share sheet.
- `加入黑名单` and `删除联系人` must use the source-of-truth backend path if the business backend owns friend status. Do not ship SDK-only writes that leave REST reads stale.

### Task 1: Lock the Real Behavior in Tests

**Files:**
- Modify: `test/chat-info-screen.test.js`
- Create: `test/im-client-chat-settings.test.js`
- Create: `test/chat-info-view-model.test.js`

- [ ] **Step 1: Write the failing UI coverage test**

```js
test('chat info screen renders rows from real conversation state instead of placeholder toggles', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatInfoScreen.tsx'),
    'utf8',
  );

  assert.match(source, /useChatInfoState|loadChatInfoState/);
  assert.match(source, /toggleConversationPinned|setConversationMute/);
  assert.match(source, /setConversationBurnDuration|clearConversationMessages/);
  assert.doesNotMatch(source, /const \[pinChat, setPinChat\] = useState\(false\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`
Expected: FAIL because the screen still uses local placeholder state.

- [ ] **Step 3: Write the failing IM wrapper test**

```js
test('im client exposes conversation setting helpers', async () => {
  const sdkCalls = [];
  const { toggleConversationPinned, setConversationMute } = loadTsModule(
    'src/im/client.ts',
    {
      '@openim/rn-client-sdk': {
        __esModule: true,
        default: {
          pinConversation: async (params) => sdkCalls.push(['pinConversation', params]),
          setConversationRecvMessageOpt: async (params) => sdkCalls.push(['setConversationRecvMessageOpt', params]),
        },
      },
    },
  );

  await toggleConversationPinned('c1', true);
  await setConversationMute('c1', true);

  assert.deepEqual(sdkCalls, [
    ['pinConversation', { conversationID: 'c1', isPinned: true }],
    ['setConversationRecvMessageOpt', { conversationID: 'c1', opt: 2 }],
  ]);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/im-client-chat-settings.test.js`
Expected: FAIL because these helpers do not exist yet.

- [ ] **Step 5: Commit the red tests**

```bash
git add test/chat-info-screen.test.js test/im-client-chat-settings.test.js test/chat-info-view-model.test.js
git commit -m "test: define real chat info behavior"
```

### Task 2: Add OpenIM Conversation Setting Wrappers

**Files:**
- Modify: `src/im/client.ts`
- Modify: `src/stores/imStore.ts`
- Test: `test/im-client-chat-settings.test.js`

- [ ] **Step 1: Write the minimal wrapper signatures in `src/im/client.ts`**

```ts
export async function toggleConversationPinned(conversationID: string, isPinned: boolean) {
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) throw new Error(getUnsupportedPlatformMessage());
  await OpenIMSDK.pinConversation({ conversationID, isPinned });
}

export async function setConversationMute(conversationID: string, muted: boolean) {
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) throw new Error(getUnsupportedPlatformMessage());
  await OpenIMSDK.setConversationRecvMessageOpt({
    conversationID,
    opt: muted ? 2 : 0,
  });
}
```

- [ ] **Step 2: Add burn and clear helpers**

```ts
export async function setConversationBurnSeconds(conversationID: string, burnDuration: number) {
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) throw new Error(getUnsupportedPlatformMessage());
  await OpenIMSDK.setConversationBurnDuration({ conversationID, burnDuration });
}

export async function clearConversationMessages(conversationID: string) {
  const initialized = await ensureOpenIMInitialized();
  if (!initialized) throw new Error(getUnsupportedPlatformMessage());
  await OpenIMSDK.clearConversationAndDeleteAllMsg(conversationID);
  useIMStore.getState().setMessages(conversationID, []);
}
```

- [ ] **Step 3: Add store helpers for destructive updates**

```ts
removeConversation: (conversationID: string) =>
  set((state) => {
    const nextMessages = { ...state.messagesByConversation };
    delete nextMessages[conversationID];
    return {
      conversations: state.conversations.filter((item) => item.conversationID !== conversationID),
      messagesByConversation: nextMessages,
    };
  }),
```

- [ ] **Step 4: Run the focused tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/im-client-chat-settings.test.js`
Expected: PASS

- [ ] **Step 5: Commit the wrapper layer**

```bash
git add src/im/client.ts src/stores/imStore.ts test/im-client-chat-settings.test.js
git commit -m "feat: add openim chat settings helpers"
```

### Task 3: Move Chat Info State Out of the Screen

**Files:**
- Create: `src/features/chat/chat-info.ts`
- Modify: `src/features/chat/screens/ChatInfoScreen.tsx`
- Test: `test/chat-info-view-model.test.js`
- Test: `test/chat-info-screen.test.js`

- [ ] **Step 1: Write the failing view-model test**

```js
test('buildChatInfoState maps conversation fields to row values', () => {
  const { buildChatInfoState } = loadTsModule('src/features/chat/chat-info.ts');
  const state = buildChatInfoState({
    conversationID: 'c1',
    recvMsgOpt: 2,
    burnDuration: 60,
    isPinned: true,
  });

  assert.equal(state.pinned, true);
  assert.equal(state.muted, true);
  assert.equal(state.burnLabel, '1分钟');
});
```

- [ ] **Step 2: Run the view-model test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/chat-info-view-model.test.js`
Expected: FAIL because the helper file does not exist.

- [ ] **Step 3: Implement the view-model helper**

```ts
export function buildChatInfoState(conversation?: Partial<ConversationItem> | null) {
  const burnDuration = conversation?.burnDuration ?? 0;
  return {
    pinned: Boolean(conversation?.isPinned),
    muted: (conversation?.recvMsgOpt ?? 0) !== 0,
    burnDuration,
    burnLabel: burnDuration === 0 ? '关闭' : BURN_LABELS[burnDuration] ?? `${burnDuration}秒`,
  };
}
```

- [ ] **Step 4: Update `ChatInfoScreen` to read real state**

```ts
const conversation = useMemo(
  () => conversations.find((item) => item.conversationID === conversationID) ?? null,
  [conversationID, conversations],
);
const infoState = useMemo(() => buildChatInfoState(conversation), [conversation]);
```

- [ ] **Step 5: Replace local toggles with real handlers**

```ts
const handleTogglePinned = async (nextValue: boolean) => {
  await toggleConversationPinned(conversationID, nextValue);
};
```

- [ ] **Step 6: Run the tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/chat-info-view-model.test.js /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/chat-info.ts src/features/chat/screens/ChatInfoScreen.tsx test/chat-info-view-model.test.js test/chat-info-screen.test.js
git commit -m "feat: bind chat info screen to real conversation state"
```

### Task 4: Finish Immediately-Available Conversation Actions

**Files:**
- Modify: `src/features/chat/screens/ChatInfoScreen.tsx`
- Modify: `src/im/client.ts`
- Modify: `test/chat-info-screen.test.js`

- [ ] **Step 1: Add a burn-duration action sheet handler**

```ts
const BURN_OPTIONS = [
  { label: '关闭', seconds: 0 },
  { label: '10秒', seconds: 10 },
  { label: '1分钟', seconds: 60 },
  { label: '5分钟', seconds: 300 },
];
```

- [ ] **Step 2: Add a clear-history confirmation flow**

```ts
Alert.alert('清空聊天记录', '这会清除当前会话的本地与服务端聊天记录。', [
  { text: '取消', style: 'cancel' },
  { text: '清空', style: 'destructive', onPress: () => void clearConversationMessages(conversationID) },
]);
```

- [ ] **Step 3: Add loading/disabled state per row**

```ts
const [pendingAction, setPendingAction] = useState<null | 'pin' | 'mute' | 'burn' | 'clear'>(null);
```

- [ ] **Step 4: Run the existing screen tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js /Users/yiboding/projects/circle-im/test/chat-detail-screen.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/screens/ChatInfoScreen.tsx src/im/client.ts test/chat-info-screen.test.js test/chat-detail-screen.test.js
git commit -m "feat: implement chat conversation actions"
```

### Task 5: Add Local Chat Background Support

**Files:**
- Create: `src/features/chat/store/use-chat-preferences-store.ts`
- Create: `src/features/chat/screens/ChatBackgroundScreen.tsx`
- Modify: `src/features/chat/screens/ChatInfoScreen.tsx`
- Modify: `src/features/chat/screens/ChatDetailScreen.tsx`
- Modify: `src/features/user/utils/routes.ts`
- Modify: `app/(tabs)/messages/_layout.tsx`
- Test: `test/chat-preferences-store.test.js`
- Test: `test/chat-detail-screen.test.js`

- [ ] **Step 1: Write the failing store test**

```js
test('chat preferences store falls back to global background when no conversation override exists', async () => {
  const { useChatPreferencesStore } = loadTsModule('src/features/chat/store/use-chat-preferences-store.ts');
  const result = useChatPreferencesStore.getState().getConversationBackground('c1');
  assert.deepEqual(result, { mode: 'global' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/chat-preferences-store.test.js`
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the persisted preferences store**

```ts
type ChatBackgroundPreference =
  | { mode: 'global' }
  | { mode: 'preset'; presetId: string }
  | { mode: 'image'; uri: string };
```

- [ ] **Step 4: Add a dedicated background picker screen and route**

```ts
router.push({
  pathname: '/(tabs)/messages/chat-background',
  params: { conversationID, name: friendName },
});
```

- [ ] **Step 5: Update `ChatDetailScreen` to render the selected background**

```ts
const backgroundPreference = useChatPreferencesStore((state) =>
  state.getConversationBackground(conversationID),
);
```

- [ ] **Step 6: Run the tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/chat-preferences-store.test.js /Users/yiboding/projects/circle-im/test/chat-detail-screen.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/chat/store/use-chat-preferences-store.ts src/features/chat/screens/ChatBackgroundScreen.tsx src/features/chat/screens/ChatInfoScreen.tsx src/features/chat/screens/ChatDetailScreen.tsx src/features/user/utils/routes.ts app/(tabs)/messages/_layout.tsx test/chat-preferences-store.test.js test/chat-detail-screen.test.js
git commit -m "feat: add local chat backgrounds"
```

### Task 6: Implement “Recommend to Friend” as a Card Forward Flow

**Files:**
- Create: `src/features/chat/screens/RecommendFriendScreen.tsx`
- Modify: `src/im/client.ts`
- Modify: `src/features/chat/screens/ChatInfoScreen.tsx`
- Modify: `src/features/user/utils/routes.ts`
- Modify: `app/(tabs)/messages/_layout.tsx`
- Test: `test/chat-info-screen.test.js`
- Test: `test/im-client-chat-settings.test.js`

- [ ] **Step 1: Add a failing IM send-card wrapper test**

```js
test('im client can send a friend card message', async () => {
  const calls = [];
  const { sendFriendCardMessage } = loadTsModule('src/im/client.ts', {
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        createCardMessage: async (payload) => {
          calls.push(['createCardMessage', payload]);
          return { clientMsgID: 'm1' };
        },
        sendMessage: async (payload) => {
          calls.push(['sendMessage', payload]);
          return payload.message;
        },
      },
    },
  });

  await sendFriendCardMessage({ targetConversationID: 'c2', userID: 'u1', nickname: '小李', faceURL: '' });
  assert.equal(calls[0][0], 'createCardMessage');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/im-client-chat-settings.test.js`
Expected: FAIL because `sendFriendCardMessage` does not exist.

- [ ] **Step 3: Implement `RecommendFriendScreen`**

```ts
// Show recent conversations from useIMStore().conversations
// Exclude the current conversation
// Confirm send on press
```

- [ ] **Step 4: Add route wiring from `ChatInfoScreen`**

```ts
router.push({
  pathname: '/(tabs)/messages/recommend-friend',
  params: { friendId, friendName, conversationID },
});
```

- [ ] **Step 5: Run the tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/im-client-chat-settings.test.js /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/screens/RecommendFriendScreen.tsx src/im/client.ts src/features/chat/screens/ChatInfoScreen.tsx src/features/user/utils/routes.ts app/(tabs)/messages/_layout.tsx test/im-client-chat-settings.test.js test/chat-info-screen.test.js
git commit -m "feat: recommend friends via card message"
```

### Task 7: Add Backend Contracts for Business-Owned Friend Actions

**Files:**
- Modify: `src/services/api/friends.ts`
- Modify: `src/features/chat/screens/ChatInfoScreen.tsx`
- Create: `src/features/chat/screens/ReportFriendScreen.tsx`
- Modify: `src/features/user/screens/UserProfileScreen.tsx` (only if status refresh hooks need reuse)
- Test: `test/chat-info-screen.test.js`
- Test: `test/friend-settings-screen.test.js` or new `test/friends-api-chat-info.test.js`

- [ ] **Step 1: Confirm backend contract before coding**

Required endpoints:

```http
POST   /friend/:id/blacklist
DELETE /friend/:id/blacklist
DELETE /friend/:id
POST   /friend/:id/report
```

Expected payload for report:

```json
{
  "category": "harassment",
  "description": "string",
  "evidence": ["optional-uploaded-file-url"]
}
```

- [ ] **Step 2: Write the failing API wrapper tests**

```js
test('friends api exposes blacklist and report actions', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/friends.ts'),
    'utf8',
  );

  assert.match(source, /export async function addFriendToBlacklist/);
  assert.match(source, /export async function removeFriendFromBlacklist/);
  assert.match(source, /export async function deleteFriendRelationship/);
  assert.match(source, /export async function reportFriend/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/friends-api-chat-info.test.js`
Expected: FAIL because the wrappers do not exist.

- [ ] **Step 4: Implement the API wrappers**

```ts
export async function addFriendToBlacklist(friendUserId: string) {
  return apiClient<void>(`/friend/${friendUserId}/blacklist`, { method: 'POST' });
}
```

- [ ] **Step 5: Replace placeholder chat-info actions**

```ts
const handleToggleBlacklist = async (nextValue: boolean) => {
  if (nextValue) await addFriendToBlacklist(friendId);
  else await removeFriendFromBlacklist(friendId);
};
```

- [ ] **Step 6: Add the report submission screen**

```ts
// category selector + description + submit button
```

- [ ] **Step 7: Add delete-friend confirmation and post-success navigation**

```ts
Alert.alert('删除联系人', '删除后将解除好友关系。', [
  { text: '取消', style: 'cancel' },
  {
    text: '删除',
    style: 'destructive',
    onPress: () => void confirmDeleteFriend(),
  },
]);
```

- [ ] **Step 8: Run the tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/friends-api-chat-info.test.js /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/services/api/friends.ts src/features/chat/screens/ChatInfoScreen.tsx src/features/chat/screens/ReportFriendScreen.tsx test/friends-api-chat-info.test.js test/chat-info-screen.test.js
git commit -m "feat: add business friend actions to chat info"
```

### Task 8: Full Regression Pass and Cleanup

**Files:**
- Modify: `docs/superpowers/plans/2026-04-15-chat-info-full-implementation.md`
- Test: `test/chat-info-screen.test.js`
- Test: `test/chat-detail-screen.test.js`
- Test: `test/user-profile-screen.test.js`
- Test: `test/im-client-chat-settings.test.js`
- Test: `test/chat-info-view-model.test.js`
- Test: `test/chat-preferences-store.test.js`
- Test: `test/friends-api-chat-info.test.js`

- [ ] **Step 1: Run the full focused suite**

Run:

```bash
node --test \
  /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js \
  /Users/yiboding/projects/circle-im/test/chat-detail-screen.test.js \
  /Users/yiboding/projects/circle-im/test/user-profile-screen.test.js \
  /Users/yiboding/projects/circle-im/test/im-client-chat-settings.test.js \
  /Users/yiboding/projects/circle-im/test/chat-info-view-model.test.js \
  /Users/yiboding/projects/circle-im/test/chat-preferences-store.test.js \
  /Users/yiboding/projects/circle-im/test/friends-api-chat-info.test.js
```

Expected: all PASS

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Update the plan with any deviations discovered during implementation**

```md
- Note any backend contract changes or product decision changes here.
```

- [ ] **Step 4: Final commit**

```bash
git add src test docs/superpowers/plans/2026-04-15-chat-info-full-implementation.md
git commit -m "feat: complete chat info actions"
```

## Backend Dependency Checklist

- If backend confirms friend actions are owned by OpenIM and mirrored perfectly into business reads, Tasks 7 wrappers may call SDK-backed service methods instead of REST.
- If backend does not yet support report or friend deletion endpoints, do not ship fake buttons. Keep those rows disabled or marked “暂未开放” until the contract lands.
- If product wants cloud-synced chat backgrounds, replace Task 5 local store with a backend-backed `conversation ex` or a dedicated settings endpoint before implementation starts.

## Implementation Deviations

- Verified against the local backend on April 16, 2026: the business backend already exposes `DELETE /friend/:friendUserId`, `POST /friend/block`, and `DELETE /friend/block/:targetId`, so `删除联系人` and `加入黑名单` were implemented against REST instead of staying as placeholders.
- The local backend does not expose a friend-report endpoint yet, so `投诉举报` remains `暂未开放` and no `ReportFriendScreen` was shipped in this implementation pass.

## Execution Notes

- Use TDD literally for each task: write test, verify failure, implement minimal code, verify pass.
- Prefer one commit per task.
- Do not bundle backend-blocked rows into the same PR as OpenIM-only conversation settings unless the API contract is already merged.
