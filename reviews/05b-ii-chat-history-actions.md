# Review Batch 05b-ii — Chat History Search + Action Screens (14 files, 3256 lines)

> Files: 5 history-search screens · 3 share/transfer stores · `ChatBackgroundScreen` · `RecommendFriendScreen` · `SharePickerScreen` · `TransferComposerScreen` · `ReportFriendScreen` · `ChatInfoScreen`
> Date: 2026-05-15
> Surface: Chat history search + share/transfer/report/chat-info action surfaces
> **Status: 0 HIGH · 9 MEDIUM · 16 LOW.**

## Batch summary

Across the 14 files, this batch is mostly well-structured: selectors are used throughout (Batch 02 lesson applied), most screens have `cancelled`-flag unmount safety, pagination is consistent (`pageRef` + `hasMore` pattern), and `ChatInfoScreen` (733 lines) has an impressively-designed optimistic-update + token-based concurrency tracking pattern that we should hold up as the reference for action screens elsewhere.

The risks cluster in 2 places:

1. **5 screens have `try { ... } finally { ... }` blocks with NO catch.** Errors escape as unhandled promise rejections; user sees "暂无内容" empty state with no way to distinguish failure from genuinely-no-results. Affects: `ChatHistoryDateScreen.handleSearch`/`handleLoadMore`, `ChatHistoryFilesScreen.handleLoadMore`, `ChatHistoryMediaScreen.handleLoadMore`, `ChatHistoryTextScreen.handleSearch`/`handleLoadMore`, `SharePickerScreen` data fetch.
2. **Pattern D second guard (in-flight ref) missing** on `TransferComposerScreen`, `ReportFriendScreen`, `RecommendFriendScreen` action handlers. They rely on React state (`submitting`/`sendingConversationID`) which is one frame late on fast double-tap. `ChatInfoScreen` does this correctly with `actionPendingRef`.

No HIGH findings.

---

# File 1 — `src/features/chat/store/use-share-picker-store.ts` (32 lines)

Pure pass-through store. `consume()` returns the pending item then nulls it (only if present). No issues.

---

# File 2 — `src/features/chat/store/use-transfer-composer-store.ts` (28 lines)

Same pattern as use-share-picker-store. No issues.

---

# File 3 — `src/features/chat/store/use-chat-preferences-store.ts` (132 lines)

### `L20-25, L46, L51, L65, L71, L78` [LOW · I18N] — Hardcoded zh preset labels + fallback strings
Same family as #25. Use `i18n.t` with `defaultValue` to make this i18n-ready.

### `L88` [LOW · DEAD-CODE] — `getChatBackgroundPreference` defined on the store but never called
The screens read via direct selector (`state.backgroundsByConversationID[id] ?? DEFAULT`). The method is dead unless externally consumed. Consider removing or documenting purpose.

### `L127-129` [POSITIVE] — `partialize` only persists `backgroundsByConversationID`
Good — doesn't accidentally persist ephemeral state. (Anti-pattern from Batch 01 already absent here.)

---

# File 4 — `src/features/chat/screens/ChatHistorySearchHubScreen.tsx` (111 lines)

Pure router-pushing hub. Selectors ✓, no async, no state. **No issues** beyond the hardcoded `"查找聊天记录"` etc (#25).

---

# File 5 — `src/features/chat/screens/ChatHistoryDateScreen.tsx` (246 lines)

### `L116-150, L153-178` [MEDIUM · OBSERVABILITY · UX] — `handleSearch` + `handleLoadMore` have `try { ... } finally { ... }` with **NO catch**
```ts
try {
  const page = await searchConversationMessagesByDate({ ... });
  if (mountedRef.current) {
    setResults(page);
    setHasMore(page.length === PAGE_SIZE);
  }
} finally {
  if (mountedRef.current) setLoading(false);
}
```
If the SDK call throws (which it does on various IM-not-ready / network conditions), the error propagates up to `void handleSearch()` → unhandled promise rejection in dev. `setLoading(false)` fires from finally → UI looks idle. `setSearched` stays true. User sees the "暂无该日期的聊天记录" empty state with no indication anything failed.

**Fix:** add a catch that surfaces error to state. Match `ChatHistoryFilesScreen`/`ChatHistoryMediaScreen` which already have retry UX.

### `L83-91` [POSITIVE] — `mountedRef` pattern correctly applied (similar to Batch 02's `use-auth.ts` fix)

---

# File 6 — `src/features/chat/screens/ChatHistoryFilesScreen.tsx` (220 lines)

### `L98-118` [MEDIUM · OBSERVABILITY] — `handleLoadMore` has no catch
The initial-load + retry paths have proper `.catch` chains (L82-91, L133-138). `handleLoadMore` doesn't. Same family as ChatHistoryDateScreen.

### `L192` [LOW · I18N] — `toLocaleString('zh-CN')` hardcoded for file-size formatting
Number formatting `1234567` → `"1,234,567"` is locale-aware but the locale name itself is hardcoded. Same #25 family.

### `L82-91, L120-139` [POSITIVE] — Both initial-load and retry have proper catch + state.error
Inline retry button with "重试" CTA — good UX pattern.

---

# File 7 — `src/features/chat/screens/ChatHistoryMediaScreen.tsx` (244 lines)

Same as Files. Same MEDIUM on `handleLoadMore` silent. Initial-load + retry are catched correctly.

### `L84, L119` [LOW · DEFENSIVE] — `messages.filter(isChatHistoryMediaMessage)` after SDK call
Defensive — SDK is asked for media-only via `messageTypeList` but client filter prevents stale-data leakage. Good.

---

# File 8 — `src/features/chat/screens/ChatHistoryTextScreen.tsx` (229 lines)

Same MEDIUM on `handleSearch`/`handleLoadMore` silent. No retry UI for failures.

### `L186` [POSITIVE] — `returnKeyType="search"` + `onSubmitEditing` for keyboard-friendly search

---

# File 9 — `src/features/chat/screens/ChatBackgroundScreen.tsx` (198 lines)

Clean. Selectors ✓, `applyPreference` is sync (just writes to store), no async failure mode.

### `L100-104` [LOW · UX] — `Alert.alert('参数缺失', '无法修改当前会话的聊天背景。')` is the user-facing error for missing conversationID
Reasonable — but user has no way to recover. Could show a static notice instead. Minor.

### `L191-192` [LOW · UX] — Image background is `'稍后开放'` (`Alert: '暂未开放'`)
Same stopgap pattern as Batch 03's forgot-password. Real feature pending.

---

# File 10 — `src/features/chat/screens/RecommendFriendScreen.tsx` (204 lines)

### `L72-80` [LOW · OBSERVABILITY] — `loadConversationList().catch(() => {})` silent
Same family Batch 01 cleaned up. Dev-warn would help.

### `L90-135` [MEDIUM · PATTERN D] — `sendingConversationID` is React state, not ref
Alert dismissal → user double-taps. `if (!friendId || sendingConversationID)` early-returns (good), but `sendingConversationID` is state — fast-tap can fire twice before re-render flushes. Less of a risk than direct buttons because Alert.alert sits in between, but still.

**Fix (lighter touch):** use `useRef(false)` for the in-flight guard; keep React state for UI feedback.

### `L96-132` [LOW · UX] — Alert.alert promise-style chaining
`then.catch.finally` chain inside the Alert button's `onPress`. Works but harder to read; an `async` function would be clearer.

---

# File 11 — `src/features/chat/screens/SharePickerScreen.tsx` (355 lines)

### `L62-77` [MEDIUM · OBSERVABILITY · UX] — Data fetch has no catch
```ts
(async () => {
  try {
    if (shareType === 'note') {
      const res = await fetchNotes();
      if (!cancelled) setNotes(res);
    } /* ... */
  } finally {
    if (!cancelled) setLoading(false);
  }
})();
```
Same pattern as the history screens. Fetch failure → empty list → user thinks they have no notes/friends/favorites. Add error state.

### `L31-38` [LOW · I18N] — `QUICK_REPLY_PHRASES` are hardcoded Chinese
6 canned quick-reply phrases live in code. They're product-decided strings, but i18n would let English users get equivalent phrases.

### `L84-118` [POSITIVE] — `useMemo`-based client-side filtering
Cheap when lists are small; would need debouncing if `notes`/`friends` lists ever grow large.

---

# File 12 — `src/features/chat/screens/TransferComposerScreen.tsx` (264 lines)

### `L66-99` [MEDIUM · PATTERN D] — `submitting` is React state, no `inFlightRef`
```ts
const handleSubmit = useCallback(async () => {
  if (submitting) return;  // ← state-based early return, one frame late on fast tap
  // ...
  setSubmitting(true);
  try { await sendCoinGift(...); /* ... */ }
  finally { setSubmitting(false); }
}, [...]);
```
Belt-and-suspenders: add a ref. Same fix as `use-auth.ts` from Batch 03.

### `L73-76` [MEDIUM · UX] — Submit when `balance === null` falls through
```ts
if (balance != null && value > balance) {
  Alert.alert('余额不足', `当前积分余额：${balance}`);
  return;
}
```
If `fetchWallet` failed → `balance === null` → this check is bypassed → user can attempt transfer above their actual balance. Server should reject, but client could gate by requiring balance to be loaded.

**Fix:** require `balance != null` before allowing submit, OR set an explicit "余额获取失败" state with retry.

### `L82-86` [POSITIVE] — `fromImUserId(recipientId)` correctly restores backend UUID
Comment explains the convention. Good.

### `L155` [POSITIVE] — `onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}` strips non-digits at input
Defensive — even with `keyboardType="number-pad"`, paste from clipboard can include letters.

---

# File 13 — `src/features/chat/screens/ReportFriendScreen.tsx` (262 lines)

### `L52-79` [MEDIUM · PATTERN D] — Same as TransferComposerScreen — state-only submit guard
Add `inFlightRef`.

### `L23-33` [POSITIVE] — Category list is structured constant with `id`/`label`/`description`
Clean. The only hardcoded zh is the labels.

### `L62-66` [POSITIVE] — Trim + non-empty + category check before submit

---

# File 14 — `src/features/chat/screens/ChatInfoScreen.tsx` (733 lines)

The largest file in the batch but also the best-designed. Multiple noteworthy patterns:

### `L84-91, L280-298` [POSITIVE · PATTERN] — Token-based action concurrency
```ts
const actionRequestTokenRef = useRef({ pin: 0, mute: 0, burn: 0, clear: 0 });
const startActionRequest = useCallback((action) => {
  const nextToken = actionRequestTokenRef.current[action] + 1;
  /* ... */
  return nextToken;
}, []);
const isLatestActionRequest = useCallback(
  (action, requestToken) => actionRequestTokenRef.current[action] === requestToken,
  [],
);
```
If a user toggles "Pin" twice fast, only the latest request's success/rollback path applies. This is the **right way** to handle action retries; the rest of the codebase could learn from this.

### `L315-358` [POSITIVE · PATTERN] — `runConversationAction` generic action runner
```ts
async (action, task, onStart?, rollback?) => {
  if (!resolvedConversationID || actionPendingRef.current[action]) return;
  const actionConversationID = resolvedConversationID;
  const actionRequestToken = startActionRequest(action);
  setConversationActionPending(action, true);
  onStart?.();
  try { await task(); }
  catch (error) {
    if (isActionConversationCurrent(...) && isLatestActionRequest(...)) {
      rollback?.();
      openActionError(error);
    }
  } finally { /* same guard */ }
}
```
Captures everything: pending lock, optimistic apply (via onStart), conversation-switch detection, token-based concurrency, rollback, error display. Used uniformly for pin/mute/burn/clear.

### `L191-218, L434-458` [LOW · CORRECTNESS] — Blacklist state uses different pattern from `runConversationAction`
Blacklist (and friend-delete) use their own `*Pending` flags and ad-hoc promise chains. Inconsistent with the otherwise-uniform action pattern. Refactor — not blocking.

### `L107` [LOW · BUG · POTENTIAL] — `fromImUserId(rawFriendId)` always called even when `rawFriendId` is empty
`fromImUserId('')` returns `''` per the implementation. Safe. ✓

### `L92, L132` [LOW · STATE-IN-RENDER] — `currentConversationIDRef.current = resolvedConversationID` runs every render
Updating a ref during render is acceptable in React 18+ but can surprise. Move to `useEffect` for strict purity:
```ts
useEffect(() => {
  currentConversationIDRef.current = resolvedConversationID;
}, [resolvedConversationID]);
```

### `L191-218` [LOW · UX] — `fetchFriendStatus` failure silently sets blacklist=false
If the blacklist API is down, the toggle defaults to "not blacklisted" — a user-blocked friend appears un-blocked in UI. Could show a "状态未知" badge or block the toggle from being interactive.

### `L605-607` [LOW · UX] — `runConversationAction('clear', ...)` has no `onStart` / no `rollback`
Clear is destructive — no need to optimistically update because the messages list cap was already wiped server-side. ✓ But: if the call fails AFTER the user confirmed in Alert, they get an Alert error and the local messages remain (because `useIMStore.setMessages(conversationID, [])` ran inside the SDK call's success path). Looking at `clearConversationMessages` in im/client.ts L698: `useIMStore.getState().setMessages(conversationID, []);` runs unconditionally after `OpenIMSDK.clearConversationAndDeleteAllMsg`. If the SDK call throws, this line doesn't execute. ✓

### `L72-189` [POSITIVE] — `useTranslation()` already used; most strings go through `t('chat.*')`
This file is **i18n-ready** — the i18n family deferred elsewhere (#25) isn't a concern here. Different from history screens which still hardcode.

---

# Patches proposed

Defensible without product input:

1. **5 history screens** — add proper `catch` blocks with error state + dev-warn on `handleSearch` / `handleLoadMore`. Match the retry UX in `ChatHistoryFilesScreen`/`MediaScreen` (which already handle errors correctly on initial-load).
2. **`SharePickerScreen.tsx`** — add catch + error state for data fetch.
3. **`RecommendFriendScreen.tsx`** — dev-warn the silent `loadConversationList` catch.
4. **`TransferComposerScreen.tsx`** — add `inFlightRef` (Pattern D second guard). Gate submit when `balance === null`.
5. **`ReportFriendScreen.tsx`** — add `inFlightRef`.
6. **`RecommendFriendScreen.tsx`** — add `inFlightRef`.

Defer:
- i18n strings everywhere (#25 family)
- ChatInfoScreen blacklist/delete pattern unification (refactor, not urgent)
- ChatInfoScreen ref-in-render (cosmetic)
- ChatBackgroundScreen image-background stopgap (#28 family — feature, not patch)

## Deferred — needs product / refactor

| # | Where | Issue | Options |
|---|---|---|---|
| 31 | `ChatHistory{Files,Media}Screen.tsx` | Retry pattern (good) vs Date/Text (silent) inconsistent | Standardize: extract a `useSearchPagination` hook. |
| 32 | `TransferComposerScreen.tsx:73-76` | Submit when balance fetch failed bypasses local check | A. Block submit. B. Add explicit "余额获取失败" state with retry. |
| 33 | `RecommendFriendScreen.tsx` + `SharePickerScreen.tsx` | Hardcoded `QUICK_REPLY_PHRASES` + filter logic | i18n + maybe move to backend so phrases can update without app release. |
| 34 | `ChatInfoScreen.tsx:191-218, 434-458` | Blacklist/delete don't use `runConversationAction` pattern | Refactor for consistency. |
