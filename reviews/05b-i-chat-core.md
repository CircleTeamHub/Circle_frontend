# Review Batch 05b-i — Chat Core Hot Path (5 files, 2187 lines)

> Files: `ChatDetailScreen.tsx` (940) · `chat-history.ts` (68) · `chat-preview.ts` (20) · `chat-info.ts` (33) · `chat-bubble.tsx` (1126)
> Date: 2026-05-15
> Surface: Chat core — the message send/receive hot path every user hits constantly
> **Status: 1 HIGH · 6 MEDIUM · 18 LOW.**

## Batch summary

`ChatDetailScreen.tsx` is the largest screen in the app and the most behavior-rich: it owns text/image/location/note-card/friend-card/transfer-card send paths, image-presign upload, online-status subscription, scroll-to-message search, share-picker / transfer-composer round-trips via `useFocusEffect`, and the input bar. It already does a few things well: per-field `useIMStore` selectors, `useMemo` for derived data, `useCallback` discipline on send handlers, proper effect cleanup for `activeConversation` and online-status subscription, and Pattern D's UI-level guard (`disabled={sending}`).

The risks cluster in 3 places:

1. **One HIGH:** `ChatDetailScreen.tsx` has **11 `console.log` calls** in production send paths. They log message text (the most sensitive piece of data the app handles), presigned upload URLs (temporary write tokens), and IDs. Visible in Metro, adb logcat, screen recordings during demos.
2. **No Pattern D second guard:** `handleSend` and the 5 attachment send handlers rely entirely on `disabled={sending}` for re-entrancy protection. Fast double-tap fires `onPress` twice before the disabled state renders. Same pattern Batch 03 added an `inFlightRef` for in `use-auth.ts`.
3. **`scrollToIndex` without `getItemLayout`:** the search-jump feature can throw "scrollToIndex out of range" on inverted FlatList for messages outside the rendered window. No `onScrollToIndexFailed` handler.

The three small utilities (`chat-history.ts`, `chat-preview.ts`, `chat-info.ts`) are clean and defensive but share the same hardcoded-Chinese / `zh-CN` issue we partially addressed in Batch 04 (`mappers.ts` #17). `chat-bubble.tsx` is mostly mechanical UI but has two hardcoded default `senderName = '陈'` fallbacks that show the literal Chinese character "陈" when sender name is missing.

---

# File 1 — `src/features/chat/screens/ChatDetailScreen.tsx` (940 lines)

## Findings

### `L435, L440, L449, L457, L540, L546, L547, L549, L560, L563` [HIGH · SECURITY] — 11 `console.log` calls leak message text + presigned URLs in production
```ts
// Text send (5):
console.log('[chat] text:request', JSON.stringify(text), { sourceID, isPreviewMode });
console.log('[chat] text:skipped (empty or preview)');
console.log('[chat] text:sent', sentMessage.clientMsgID, 'content=', sentMessage.textElem?.content ?? '<no textElem>');
console.log('[chat] text:fail', error instanceof Error ? error.message : error);

// Image upload (6):
console.log('[chat] image:presign request');
console.log('[chat] image:presign ok →', presign.fileUrl);
console.log('[chat] image:put start →', presign.uploadUrl);   // ← presigned URL with auth signature
console.log('[chat] image:put done');
console.log('[chat] image:sent', sentMessage.clientMsgID);
console.log('[chat] image:fail', ...);
```
This is the same class of leak Batch 01 fixed in `client.ts:readPayload` (login response in dev logs) — except worse because:
- **Message text is the most sensitive data in a chat app.** No user expects their messages to appear in console.
- **Presigned URLs grant time-limited write access** to S3/equivalent storage. Anyone who captures the log can upload arbitrary content to that path until expiry.
- These run **unconditionally** — no `__DEV__` gate. Production builds with Metro disabled still pipe to native logs (adb logcat on Android).
- Demo screen recordings, Sentry breadcrumbs, BugSnag traces — anything that aggregates console output gets a copy.

**Fix:** delete all 11 calls. The user-facing `setSendError(...)` already surfaces failures to the user; there's no debugging value in seeing send progress in console after dev-time iteration is done.

If specific failure observability is desired, route it through a `logger` module that:
- Is no-op in production
- Redacts message content / URL signatures in dev
- Lives in `src/utils/logger.ts` so future work can swap in Sentry or similar

For this batch, the minimal fix is **deletion**.

---

### `L322-326` [MEDIUM · BUG] — `scrollToIndex` on inverted FlatList without `getItemLayout` or `onScrollToIndexFailed`
```ts
if (idx !== -1) {
  scrolledToSearchRef.current = true;
  flatListRef.current?.scrollToIndex({
    index: idx,
    animated: true,
    viewPosition: 0.3,
  });
  return;
}
```
RN's FlatList `scrollToIndex` warns and may throw if the target index is outside the rendered window and `getItemLayout` isn't defined. Inverted lists are especially prone to this. The search-jump from `ChatHistorySearch` is exactly the case where this fires — user searches for a message 200+ items back.

**Fix:** add `onScrollToIndexFailed` to the FlatList with a fallback that scrolls towards the target, waits for layout, then retries:
```ts
<FlatList
  ref={flatListRef}
  // ...
  onScrollToIndexFailed={(info) => {
    const wait = new Promise((r) => setTimeout(r, 250));
    void wait.then(() => {
      flatListRef.current?.scrollToIndex({
        index: Math.min(info.highestMeasuredFrameIndex, info.index),
        animated: false,
      });
    });
  }}
/>
```

---

### `L776-799, L517-575, L467-515, L640-669, L671-701, L718-739` [MEDIUM · SAFETY · PATTERN-D] — No hook-level in-flight ref on send handlers
The input-bar send (`handleSend`) and all attachment send handlers rely on `disabled={sending}` + the early-return `if (sending) return;` (for `handleSend`) to prevent re-entrancy. **The other 5 attachment handlers don't even have the early-return** — they have nothing but the attachment menu close behavior to prevent re-tap.

Pattern D from the skill requires **both** UI-level disabled AND hook/ref-level guard. Fast double-tap on a slow network races React's render cycle.

**Fix:** add an `inFlightRef` like Batch 03's `use-auth.ts` fix and gate every send handler:
```ts
const inFlightRef = useRef(false);
const guardedSend = async (run: () => Promise<void>) => {
  if (inFlightRef.current) return;
  inFlightRef.current = true;
  try { await run(); } finally { inFlightRef.current = false; }
};
// then:
const handlePickMedia = useCallback(() => guardedSend(async () => { /* ... */ }), [deps]);
```

For the text-input `handleSend`, the existing `sending` state is React-state. The ref version belt-and-suspenders against the double-tap-before-render-flush case.

---

### `L883-885` [MEDIUM · BUG] — Mic button has no `onPress`
```tsx
<Pressable style={[s.circleBtn, d.circleBtn]}>
  <Ionicons name="mic" size={18} color={colors.textSecondary} />
</Pressable>
```
Same pattern as Batch 03's forgot-password / WeChat social login deadlinks. Visually clickable, does nothing.

**Fix:** wire to a stopgap `Alert.alert('语音消息', '该功能即将上线')` or remove the button. Voice messages need real implementation (audio recording + IM voice-message type) — that's a feature, not a review patch.

---

### `L280-285, L294-299` [LOW · OBSERVABILITY] — Three silent catches in side-effect chains
```ts
markConversationAsRead(conversationID).catch(() => {});
loadConversationMessages(conversationID).catch(() => {});
void subscribeUserOnlineStatus([peerImId]).catch(() => {});
void unsubscribeUserOnlineStatus([peerImId]).catch(() => {});
```
Same family Batch 01 cleaned in `session.ts`. Dev warns would surface "why is unread count stuck" / "why doesn't online status work" during development.

---

### `L744-746` [LOW · CORRECTNESS] — `useFocusEffect` consumes both pending share AND pending transfer in one pass
```ts
useFocusEffect(useCallback(() => {
  const transfer = consumePendingTransfer();
  if (transfer) { void handleSendTransferCard(transfer); }
  const item = consumePendingShare();
  if (!item) return;
  switch (item.kind) { /* ... */ }
}, [...]));
```
If both stores have pending items (rare but possible — user double-routed), both fire. Probably fine since each store has its own consume() semantics, but worth a comment.

---

### `L246-251` [LOW · CLARITY] — `statusColor` ternary chain is hard to read
```ts
const statusColor =
  conversationType !== SessionType.Single || authUser?.accountId === sourceID
    ? colors.online
    : peerOnline
      ? colors.online
      : colors.textSecondary;
```
Six conditions in three lines. Extract to a small helper for readability + testability:
```ts
function resolveStatusColor(isGroupOrSelf: boolean, peerOnline: boolean, colors: ThemeColors) {
  if (isGroupOrSelf || peerOnline) return colors.online;
  return colors.textSecondary;
}
```

---

### `L194-199` [LOW · STATE-SHAPE] — 5 `useState` hooks for related state (draft / sending / sendError / attachmentOpen)
A reducer would unify but adds complexity. Cosmetic.

---

### `L529, L532` [LOW · BUG · IMAGE] — `asset.uri.split('/').pop()` can return undefined on edge URIs
```ts
const filename = asset.uri.split('/').pop() ?? 'image.jpg';
```
The `?? 'image.jpg'` handles undefined. ✓ But for URIs ending in `/` (rare), `pop()` returns ``empty string``, not undefined → fallback doesn't fire → filename is empty. Use `||` to also handle empty strings.

---

### `L729` [LOW · UX] — Hardcoded message "积分已扣减" leaks transactional details
```ts
setSendError('转账卡片发送失败，但积分已扣减');
```
Implies the backend has already deducted points before message send. If true (transaction is non-atomic), this is a fair UX message. If false (backend is transactional), this is misleading. Verify with backend team.

---

### `L213` [LOW · CLARITY] — `isPreviewMode = !conversationID` is implicit
A separate `?preview=1` route param + explicit flag would be clearer than "no conversationID = preview".

## Test gaps for ChatDetailScreen.tsx
- `test/chat-detail-screen.test.js` exists (passing).
- No regression test for: console.log absence, send retry guard, scrollToIndex fallback, dead-mic-button no-op.

---

# File 2 — `src/features/chat/chat-history.ts` (68 lines)

## Findings

### `L26-37, L39-50` [LOW · I18N] — Hardcoded `zh-CN` locale + Chinese strings
```ts
return new Date(sendTime).toLocaleString('zh-CN', { /* ... */ });
// ...
case MessageType.PictureMessage: return '图片';
```
Same family as Batch 04 `mappers.ts` #17. Use `i18n.t` with `defaultValue` to make this i18n-ready without locale-JSON changes.

---

### `L46` [LOW · UX] — `message.fileElem?.fileName || '[文件]'` ignores empty string and uses fallback
Same intent as `??` but `||` catches `''` too. Probably correct — empty filename should fall back to `'[文件]'`.

## Test gaps
- No tests for `formatChatHistoryTime` / `getChatHistoryMessageTitle`

---

# File 3 — `src/features/chat/chat-preview.ts` (20 lines)

## Findings

### `L1-4` [LOW · MAINTAINABILITY] — Fragile string-match against error messages from `im/client.ts`
```ts
const CHAT_PREVIEW_FALLBACK_MESSAGES = [
  'OpenIM 仅支持 iOS/Android development build',
  'IM 连接尚未完成，请稍后重试',
];
```
If anyone changes the message in `im/client.ts` (line 86: `getUnsupportedPlatformMessage()`, line 100: `'IM 连接尚未完成，请稍后重试'`), this silently breaks → preview screen treats real errors as fatal.

**Fix:** export error codes from `im/client.ts` (e.g. `IM_ERROR_CODES.UNSUPPORTED_PLATFORM`) and match on code, not message. Deferred — touches multiple files.

---

# File 4 — `src/features/chat/chat-info.ts` (33 lines)

## Findings

### `L13-23` [LOW · I18N] — `formatBurnLabel` returns hardcoded Chinese
```ts
if (!burnDuration) return '关闭';
if (burnDuration >= 60 && burnDuration % 60 === 0) return `${burnDuration / 60}分钟`;
return `${burnDuration}秒`;
```
Same i18n family as above. Use i18n.t with defaultValue.

---

# File 5 — `src/features/chat/components/chat-bubble.tsx` (1126 lines)

## Findings

### `L118, L320` [MEDIUM · BUG] — Hardcoded default `senderName = '陈'` in ReceivedBubble + LocationCard
```ts
export const ReceivedBubble: React.FC<ReceivedBubbleProps> = ({
  message,
  senderName = '陈',         // ← hardcoded sender name fallback
  // ...
});

export const LocationCard: React.FC<LocationCardProps> = ({
  // ...
  senderName = '陈',
  // ...
});
```
If a backend payload arrives without `senderNickname` (or `senderName` is otherwise missing), every chat shows the literal Chinese character "陈" (Chen) as the sender. The hardcoded default appears to be from a design mockup that wasn't cleaned up.

**Fix:** drop the default. Use empty string or render the avatar's letter fallback:
```ts
senderName = '',
```
The `Avatar` component already handles empty/missing names with a generic icon.

---

### `L82-85, L1080` [LOW · UX · FORMAT] — TransferCardBubble amount not formatted with thousand separator
```ts
<Text style={sTransfer.amount}>{data.amount}</Text>
```
A transfer of `1000000` renders as `1000000`. Use `data.amount.toLocaleString()` to get `1,000,000`.

---

### `L634-639, L645` [LOW · BUG · SEMANTIC] — NoteCardBubble's `location` flag wired to `groupNames.length`
```ts
const flags = {
  // ...
  location: note.groupNames.length > 0,  // ← named "location" but means "has groups"
};
const chips = [/* ... */ { id: 'location', label: '位置' }];
```
The chip is labeled `'位置'` (Location) but the flag checks `groupNames.length`. Either:
- The chip label should say "群组" (Groups), or
- The note card needs a real `hasLocation` field

Semantic mismatch. Defer — needs note data model decision.

---

### `L904-908` [LOW · TYPE-SAFETY] — Unsafe cast on `fallbackIconName`
```ts
<Ionicons
  name={
    (icon.fallbackIconName as keyof typeof Ionicons.glyphMap) ??
    'ribbon-outline'
  }
  // ...
/>
```
If `fallbackIconName` is `"foo-bar"` (not a real Ionicon), the cast lies. Ionicons renders nothing or warns. Validate against the glyph map at the boundary OR catch in dev.

---

### `L373-374, L883-885` [LOW · UX] — Long text in LocationCard / FriendCardBubble has no `numberOfLines` cap
LocationCard title + address: no cap. Long location names overflow the 248-wide card. FriendCardBubble nickname has `numberOfLines={1}` ✓ but persona has `numberOfLines={2}` — the persona may still overflow vertically depending on font.

---

### `L1078-1080, L1090` [LOW · I18N] — Hardcoded Chinese in TransferCardBubble: `'积分'`, `'积分转账'`
Same i18n family.

---

### `L882-884` [LOW · UX] — Hardcoded fallback `'这个人很懒，什么都没留下'`
Long established Chinese internet meme phrase. Charming but baked into the component. Same i18n family.

## Test gaps for chat-bubble.tsx
- `test/chat-bubble.test.js` exists (passing).
- No regression test for senderName fallback after the fix.

---

# Patches proposed

Defensible without product input — applying now:

1. **`ChatDetailScreen.tsx`** — **DELETE all 11 `console.log` calls** (HIGH security fix).
2. **`ChatDetailScreen.tsx`** — add `inFlightRef` re-entrancy guard for all 6 send paths (Pattern D second guard).
3. **`ChatDetailScreen.tsx`** — `onScrollToIndexFailed` fallback for the FlatList.
4. **`ChatDetailScreen.tsx`** — wire dead mic button to `Alert.alert` stopgap (same pattern as Batch 03 #12).
5. **`ChatDetailScreen.tsx`** — dev-warn the 4 silent catches (mark-read, load-messages, online-status subscribe/unsubscribe).
6. **`ChatDetailScreen.tsx`** — `asset.uri.split('/').pop() || 'image.jpg'` (use `||` not `??` to also catch empty string).
7. **`chat-bubble.tsx`** — drop `senderName = '陈'` default in ReceivedBubble + LocationCard.
8. **`chat-bubble.tsx`** — `data.amount.toLocaleString()` in TransferCardBubble.

## Deferred — needs product / design / cross-file refactor

| # | Where | Issue | Options |
|---|---|---|---|
| 25 | `chat-history.ts`, `chat-info.ts`, `chat-bubble.tsx` | Hardcoded `zh-CN` locale + Chinese strings | Same family as #17. Apply `i18n.t(key, { defaultValue: zh })` pattern. |
| 26 | `chat-preview.ts:1-4` | Error string-match coupling to `im/client.ts` messages | Export `IM_ERROR_CODES` constants from `im/client.ts`, match on code. |
| 27 | `chat-bubble.tsx:639, 645` | NoteCardBubble's "location" chip wired to `groupNames.length` (semantic mismatch) | Either rename chip to "群组" or add proper `hasLocation` field to NoteCardData. |
| 28 | `ChatDetailScreen.tsx:610, 883` | Dead mic button + dead video-call button | Voice messages + video calls are real features, not review patches. |
| 29 | `ChatDetailScreen.tsx:729` | "积分已扣减" error message implies non-atomic transfer | Verify with backend: is transfer message-send atomic with point deduction? |
| 30 | `chat-bubble.tsx:904-908` | Unsafe `fallbackIconName as keyof typeof Ionicons.glyphMap` cast | Validate against glyph-map keys at the data boundary or accept widening type. |
