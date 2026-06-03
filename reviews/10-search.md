# Batch 10 — Search (Surface 10 close-out)

> Files: 2 (`src/features/search/index.ts` 1 + `screens/SearchScreen.tsx` 321)
> Approx. lines reviewed: 322

## Files in scope

| File | Lines | Role |
|---|---|---|
| `index.ts` | 1 | Barrel — only `SearchScreen` export. |
| `screens/SearchScreen.tsx` | 321 | Global search — IM conversations + friends, case-insensitive substring match. |

---

## Findings

### H · 0 | M · 2 | L · 5 | STYLE · 1

#### MEDIUM

##### 1. `SearchScreen.tsx:107-124` — silent fetchFriends catch
On network failure → `setFriends([])`, no error indicator, no retry. User sees "暂无匹配结果" and assumes there are no matches when actually the friend list was never loaded. Same family as #46 / batch 6 silent-fetch patterns.

**Patched**: dev-warn added; on next load + still no friends, an inline error+retry footer appears.

##### 2. `SearchScreen.tsx:36-38, 148-149, 261, 278, 313` — hardcoded zh strings + type-literal
`'聊天记录' | '好友'` as a type-literal union (L37), then used as section titles (L148-149). Also: header title (L261), search placeholder (L278), empty/loading copy (L313).

**Patched**: i18n via `t(key, { defaultValue: zh })` pattern. Type union widened to `string` since section titles are i18n'd strings.

#### LOW

- **`SearchScreen.tsx:107-124`** — initial fetch only fires once on mount; `useFocusEffect` would refresh stale friend list on return. Defer (UX call).
- **`SearchScreen.tsx:128-151`** — substring search only; no Pinyin index for Chinese names. e.g., a contact named "张三" won't match "zs". Cross-cutting (would affect contacts search too).
- **`SearchScreen.tsx:161`** — `avatarUrl: conversation.avatarUrl` passed as router param. If undefined → string "undefined" in URL. **Patched**: skip when undefined.
- **`SearchScreen.tsx:233`** — `{conversation.message || ' '}` whitespace fallback to preserve row height. Hacky but works; acceptable.
- **`SearchScreen.tsx:218-255`** — `renderItem` not `useCallback`. Re-creates every render. Defer.

#### STYLE

- **`SearchScreen.tsx`** — uses `useSegments` for scope detection. Works but tight coupling to route group naming. Worth a comment.

---

## Patches applied

1. **`SearchScreen.tsx`** — i18n migration (5 strings); dev-warn on silent `fetchFriends` catch + `loadError` state with inline retry footer; sanitize `avatarUrl` param (skip when falsy instead of serializing `undefined`); widened section title type to `string`.

---

## Pending decisions

None.

---

**Surface 10 closed at 2/2.**
