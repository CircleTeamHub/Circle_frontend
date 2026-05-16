# Review Batch 05b-iii — Messages Tab (8 files, 1169 lines)

> Files: `MessagesScreen.tsx` (470) · `FindScreen.tsx` (1) · `GroupManagementScreen.tsx` (217) · `NewGroupScreen.tsx` (370) · `use-message-groups-store.ts` (87) · `discover-alerts.ts` (18) · `messages/index.ts` (3) · `chat/index.ts` (3)
> Date: 2026-05-15
> Surface: Chat core (final batch — closes Surface 3 at 27/27)
> **Status: 0 HIGH · 8 MEDIUM · 7 LOW.**

## Batch summary

`MessagesScreen` (470 lines) is the highest-traffic screen in the app — every login lands here. It uses `useIMStore` selectors correctly, has reasonable memoization on the row renderer, and surfaces connection errors via the empty state.

The risks cluster in 4 places:

1. **`BASE_FILTERS` and `MENU_ACTIONS` are reconstructed every render** — both `useMemo` blocks downstream that depend on them get busted.
2. **`handleConversationPress` awaits 2 server calls before navigating** — on slow networks, tapping a conversation feels like a freeze.
3. **`handleClearUnread` uses `Promise.all`** — any single failure short-circuits the entire batch instead of marking the rest read.
4. **`GroupManagementScreen` reads from a store that's never populated** — `useMessageGroupsStore.conversations` is initial-empty, has no IM-sync. The whole custom-groups feature is dead code path.

Plus 2 specific data issues:

- **`discover-alerts.ts` is fake mock data** baked into production — every user sees 5 fake unread "circle 圈子" alerts with no way to dismiss them.
- **`scan` and `seatManagement` menu items have no handlers** — same dead-button class as Batch 03 #12 #13.

---

# File 1 — `src/features/messages/screens/MessagesScreen.tsx` (470 lines)

## Findings

### `L159-160, L228, L421` [MEDIUM · PERF · MEMO-BUST] — `BASE_FILTERS` and `MENU_ACTIONS` reconstructed every render
```ts
const BASE_FILTERS = BASE_FILTER_KEYS.map((f) => ({ id: f.id, label: t(f.key) }));
const MENU_ACTIONS = MENU_ACTION_KEYS.map((a) => ({ id: a.id, icon: a.icon, label: t(a.key) }));
```
These are new array references every render. Downstream:
- `filterItems = BASE_FILTERS` (L228) — same fresh ref
- `useMemo([... filterItems])` for `activeTab` (L231-234) — never benefits from memoization
- `ListHeader` useMemo (L377-421) — `filterItems` is in deps, so the header re-renders every parent render

**Fix:** wrap both inside `useMemo(() => ..., [t])`:
```ts
const BASE_FILTERS = useMemo(
  () => BASE_FILTER_KEYS.map((f) => ({ id: f.id, label: t(f.key) })),
  [t],
);
const MENU_ACTIONS = useMemo(
  () => MENU_ACTION_KEYS.map((a) => ({ id: a.id, icon: a.icon, label: t(a.key) })),
  [t],
);
```

---

### `L273-294` [MEDIUM · UX · LATENCY] — `handleConversationPress` awaits 2 server round-trips before navigation
```ts
const handleConversationPress = useCallback(async (conversation) => {
  try {
    await markConversationAsRead(conversation.id);
    await loadConversationList();
  } catch {
    // Keep navigation responsive even when marking read fails.
  }
  router.push({ pathname: '/(tabs)/messages/chat-detail', /* ... */ });
}, [router]);
```
The comment claims to "keep navigation responsive" — but the navigation happens **after** both awaits resolve. On a slow network, tapping a conversation row freezes the tap for the duration of two server calls.

**Fix:** navigate immediately, fire-and-forget the read + refresh. ChatDetailScreen does its own data load anyway:
```ts
const handleConversationPress = useCallback((conversation) => {
  // Fire-and-forget: navigation must not block on mark-read / list refresh.
  void markConversationAsRead(conversation.id)
    .then(() => loadConversationList())
    .catch((err) => {
      if (__DEV__) console.warn('[messages] mark-read/refresh failed', err);
    });
  router.push({ pathname: '/(tabs)/messages/chat-detail', /* ... */ });
}, [router]);
```

---

### `L315-321` [MEDIUM · BUG · BATCH-SEMANTICS] — `handleClearUnread` short-circuits on first reject
```ts
const handleClearUnread = useCallback(() => {
  Promise.all(visibleConversations.map((c) => markConversationAsRead(c.id)))
    .then(() => loadConversationList())
    .catch(() => { /* silent */ });
}, [visibleConversations]);
```
If one conversation fails to mark-read, **all subsequent calls are still in flight but their resolutions are ignored** (Promise.all settles on first rejection). User sees the loop didn't complete and many conversations stay unread, with no error UI to know why.

**Fix:** use `Promise.allSettled` to apply best-effort + dev-warn the failures:
```ts
const handleClearUnread = useCallback(() => {
  void (async () => {
    const results = await Promise.allSettled(
      visibleConversations.map((c) => markConversationAsRead(c.id)),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (__DEV__ && failed.length > 0) {
      console.warn(`[messages] ${failed.length} mark-read calls failed`, failed);
    }
    try { await loadConversationList(); } catch (err) {
      if (__DEV__) console.warn('[messages] loadConversationList failed', err);
    }
  })();
}, [visibleConversations]);
```

---

### `L324-332` [MEDIUM · BUG · DEAD-BUTTON] — `scan` and `seatManagement` menu items have no handlers
```ts
const handleMenuAction = useCallback((id: MenuActionId) => {
  setMenuVisible(false);
  if (id === "newGroup") router.push("/(tabs)/messages/new-group");
  else if (id === "addFriend") router.push("/(tabs)/messages/add-friend");
  else if (id === "groupManagement") router.push("/(tabs)/messages/groups");
  // ← 'scan' and 'seatManagement' fall through silently
}, [router]);
```
Same dead-button class as Batch 03 #12 (forgot-password) and #28 (video-call). Wire to `Alert.alert('xxx', '该功能即将上线')` stopgap.

---

### `L262-270, L317-320, L278-280` [LOW · OBSERVABILITY] — 3 silent catches without dev-warn
Same family as Batch 01 cleaned up in `session.ts`. The connection-error path is OK (surfaced through imStore.error → empty-state UI), but `handleConversationPress` mark-read failure and `handleClearUnread` reload failure should at least dev-warn.

---

### `L170` [LOW · DEAD-CODE] — `getUnreadDiscoverAlertCount()` reads fake mock data
See `discover-alerts.ts` finding below. Affects the notification badge count.

---

## Test gaps for MessagesScreen.tsx
- No specific test file
- Regression tests for: memo stability, fire-and-forget navigation, allSettled batch

---

# File 2 — `src/features/messages/screens/FindScreen.tsx` (1 line)

```ts
export { default } from '@/features/search/screens/SearchScreen';
```
Pure re-export. ✓

---

# File 3 — `src/features/messages/screens/GroupManagementScreen.tsx` (217 lines)

### `L45` [MEDIUM · BUG · DEAD-FEATURE] — Reads `conversations` from a store that's never populated
```ts
const conversations = useMessageGroupsStore((state) => state.conversations);
// ...
const groupConversations = useMemo(
  () => conversations.filter((c) => c.conversationType === 'group'),
  [conversations],
);
```
`useMessageGroupsStore.conversations` has initial state `[]` and **nothing writes new conversations into it** (per the store's own doc comment at L4-9, the migration to `useIMStore` already happened — but only halfway). The store keeps `conversations`, `toggleConversationInCustomGroup`, and `clearUnreadByFilter` operating on this dead array.

**Effect:** `groupConversations` is always empty → the "分配群聊到当前群组" section never renders any rows → the whole "customGroups" feature is **non-functional in production**.

**Fix options (need product input):**
- A. **Wire to IM**: read `useIMStore.conversations`, map via `mapConversationItemToUI`, store `customGroupIds` separately (e.g. `Record<conversationID, string[]>`) in `useMessageGroupsStore`. Real fix.
- B. **Remove the feature**: delete GroupManagementScreen + customGroups state + the menu item that opens it. Honest.
- C. **Mark as TODO**: leave but add a dev banner so internal users know it's WIP.

**Deferred** — needs product call.

---

### `L124-187` [LOW · I18N] — Multiple hardcoded zh strings
Same #25 family.

---

### `L113-120` [LOW · CORRECTNESS] — `handleCreateGroup` doesn't validate name uniqueness
Two custom groups with the same name → both exist with different IDs but identical UI labels. Minor.

---

# File 4 — `src/features/messages/screens/NewGroupScreen.tsx` (370 lines)

### `L145-198` [MEDIUM · SAFETY · PATTERN D] — `handleSubmit` lacks `inFlightRef`
```ts
const handleSubmit = useCallback(async () => {
  if (submitting) return;  // state-only guard
  // ...
  setSubmitting(true);
  try { /* createGroupChat + getOrCreateGroupConversation */ }
  finally { setSubmitting(false); }
}, [...]);
```
Same Pattern D family — `submitting` state is one frame late on fast double-tap. Group creation is **expensive and idempotent only at the server's discretion** — a duplicate `createGroupChat` call could create two identical groups.

**Fix:** add `inFlightRef`.

---

### `L103-120` [LOW · UX] — `fetchFriends` failure silently shows empty list
```ts
fetchFriends()
  .then((list) => { if (!cancelled) setFriends(list); })
  .catch(() => { if (!cancelled) setFriends([]); })
  .finally(() => { if (!cancelled) setLoading(false); });
```
On network failure, user sees "暂无好友" (no friends). They have no way to retry or know it was a network issue. Match the retry UX in `SharePickerScreen` (post-#31 patch).

---

### `L145-160` [LOW · UX] — `selectedCount < 1` requires at least 1 friend, not 2
A group chat in most platforms requires at least 2 members (you + 1 friend). OpenIM may allow 1-member "group" but it's UX-weird. Verify with product whether this is intentional.

---

# File 5 — `src/features/messages/store/use-message-groups-store.ts` (87 lines)

### `L14-29, L48-85` [MEDIUM · ARCHITECTURE] — Store maintains `conversations` that nobody writes to
Sister-finding to GroupManagementScreen #1. The doc-comment is partially-true: "该 store 已不再负责存储会话列表" — but the `conversations` field and `toggleConversationInCustomGroup` / `clearUnreadByFilter` methods all still operate on it.

If the migration is complete, these methods are dead. If it's incomplete, the store needs IM-sync wiring.

**Deferred** — bundled with the GroupManagementScreen decision.

---

# File 6 — `src/features/messages/data/discover-alerts.ts` (18 lines)

### `L1-18` [MEDIUM · BUG · FAKE-DATA-IN-PRODUCTION] — Mock data baked into production
```ts
export const DISCOVER_ALERTS: DiscoverAlertItem[] = [
  { id: '1', title: '圈子广场有 3 条新动态', time: '刚刚', unread: true },
  { id: '2', title: '生活圈发布了新的热门内容', time: '12分钟前', unread: true },
  { id: '3', title: '美食圈新增了一条精选帖子', time: '1小时前', unread: true },
  { id: '4', title: '同城圈有人提到了你关注的话题', time: '昨天', unread: true },
  { id: '5', title: '圈子广场推荐了新的内容', time: '昨天', unread: true },
];

export function getUnreadDiscoverAlertCount() {
  return DISCOVER_ALERTS.filter((item) => item.unread).length;
}
```
Every user, on every device, sees the same 5 fake alerts with fixed "time" labels ("刚刚", "12 分钟前"...). The `unread: true` is static — there's no way to mark these read.

`MessagesScreen.tsx:170` calls this and L393 displays `Math.max(unreadNotificationCount, totalUnread)` — so the **notification badge in the top bar always shows at least 5**, even when there are zero real unreads.

**Fix path (needs backend):** wire to `notifications.unreadSummary` or similar realtime channel. The realtime layer already has `system.notification.unread.changed` (Batch 5a Pending #22) → ready to consume once backend pushes it.

**Quick fix:** flip `unread` to `false` on initial data or remove the `Math.max(..., totalUnread)` so the badge reflects real chat unread only.

---

# File 7 — `src/features/messages/index.ts` (3 lines)

Barrel exports MessagesScreen / FindScreen / GroupManagementScreen. ✓

**Missing:** `NewGroupScreen` is referenced from menu but not exported here. Inconsistent — but routes import directly from the screen file, so this doesn't actually break anything. Just inconsistent.

---

# File 8 — `src/features/chat/index.ts` (3 lines)

```ts
export { default as ChatDetailScreen } from './screens/ChatDetailScreen';
export { default as ChatInfoScreen } from './screens/ChatInfoScreen';
export { DatePill, ReceivedBubble, SentBubble, LocationCard } from './components/chat-bubble';
```

### `L3` [LOW · STALENESS] — Barrel missing 4 newer card bubble exports
`chat-bubble.tsx` defines `DatePill`, `ReceivedBubble`, `SentBubble`, `LocationCard`, `ImageBubble`, `NoteCardBubble`, `FriendCardBubble`, `TransferCardBubble` — barrel only exports the first 4. Routes import directly from `./components/chat-bubble` so nothing breaks, but the barrel is misleading.

Also missing: many chat screens (`ChatBackgroundScreen`, `ChatHistory*Screen`, `RecommendFriendScreen`, etc.) aren't exported. Whether that's intentional ("only public surface goes through barrel") or just stale is unclear.

**Fix:** either drop the barrel (everyone imports direct paths anyway) or add the missing exports.

---

# Patches proposed

Defensible without product input:

1. **`MessagesScreen.tsx`** — `useMemo` for `BASE_FILTERS` + `MENU_ACTIONS` (memo stability).
2. **`MessagesScreen.tsx`** — `handleConversationPress` fires mark-read + refresh in background; navigates immediately.
3. **`MessagesScreen.tsx`** — `handleClearUnread` uses `Promise.allSettled` + dev-warn failures.
4. **`MessagesScreen.tsx`** — wire `scan` and `seatManagement` menu items to Alert stopgap.
5. **`MessagesScreen.tsx`** — dev-warn the silent fetch + mark-read catches.
6. **`NewGroupScreen.tsx`** — add `inFlightRef` Pattern D second guard.
7. **`NewGroupScreen.tsx`** — dev-warn the silent `fetchFriends` catch.
8. **`chat/index.ts`** — add missing card bubble exports (or accept the stale barrel — flag).

## Deferred — needs product / architecture decision

| # | Where | Issue | Options |
|---|---|---|---|
| 35 | `GroupManagementScreen.tsx` + `use-message-groups-store.ts` | Custom-groups feature is dead — store's `conversations` is never populated, so the screen never has groups to assign | A. Wire to useIMStore. B. Remove the feature + menu item. C. WIP banner. |
| 36 | `discover-alerts.ts` | Fake mock data in production — every user sees 5 fake unread alerts at "刚刚", "12 分钟前"... | A. Wire to `notifications.unreadSummary` realtime event. B. Set initial unread=false. C. Stop merging with totalUnread badge. |
| 37 | `NewGroupScreen.tsx:147` | Minimum members = 1 (group of you + 1 friend) | Product call: 1 vs 2 minimum. |
