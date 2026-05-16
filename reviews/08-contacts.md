# Batch 08 — Contacts (Surface 6 close-out)

> Files: 9 (`src/features/contacts/{contact-friends.ts, friend-activities.ts, index.ts}` + 6 screens)
> Approx. lines reviewed: 1713
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md).

## Files in scope

| File | Lines | Role |
|---|---|---|
| `contact-friends.ts` | 75 | Pure helpers: display name, sort key, section title, recent-friends sort, tag sort. |
| `friend-activities.ts` | 87 | Pure helpers: i18n'd activity copy, inbox row grouping, "can handle" predicate. |
| `index.ts` | 6 | Barrel — 6 screens. |
| `ContactsScreen.tsx` | 328 | Main contacts tab: quick actions + alphabet SectionList. |
| `FriendActivityDetailScreen.tsx` | 317 | Detail page for a single friend request activity with accept/reject. |
| `FriendTagDetailScreen.tsx` | 237 | Tag's friend list with A-Z sections. |
| `FriendTagsScreen.tsx` | 197 | All tags + per-tag friend count. |
| `GroupsScreen.tsx` | 212 | **Fake mock data screen — 5 hardcoded sample groups, no backend.** |
| `NewFriendsScreen.tsx` | 254 | Friend request inbox with optimistic mark-read. |

---

## Findings (severity-tagged)

### H · 1 | M · 4 | L · 8 | STYLE · 2

#### HIGH

##### `GroupsScreen.tsx` — Entirely fake mock data (#54)
The route `/(tabs)/contacts/groups` (reached from ContactsScreen's "群组" quick action) shows **5 hardcoded sample groups** read from a static `GROUP_SECTIONS` const (L34-90). Each row is a `<Pressable>` with no `onPress` — completely non-functional. i18n keys (`samples.createdProduct.name`, `samples.joinedFrontend.name`, etc.) just translate the demo strings.

Same family as the previously-deleted #36 (`discover-alerts.ts`). This is a chat app — the user has REAL groups in OpenIM (via `useIMStore.conversations` where `sessionType` is GROUP), but this screen pretends otherwise. **Actively misleads users.**

**Options:**
- **A.** Wire to real data: filter `useIMStore.conversations` by group session type, navigate row press to ChatDetail.
- **B.** Delete the screen + route until the feature is real (consistent with #36 precedent).
- **C.** Add prominent "demo data" banner (least good — still misleads on first glance).

Defer to product decision → #54.

#### MEDIUM

##### `FriendTagsScreen.tsx:73-78` — N+1 friend-count fetch (#55)
```ts
const counts = await Promise.all(
  nextTags.map(async (tag) => ({
    ...tag,
    friendCount: (await fetchFriendsByTag(tag.id)).length,
  })),
);
```
For each tag, fetches the entire friend list to display a count. 20 tags = 20 round-trips. Backend should include `friendCount` on the `FriendTag` payload.

Defer — backend dependency.

##### `ContactsScreen.tsx:208-219` — "Seats" quick-action is a dead button (#56)
```ts
const handleQuickActionPress = useCallback(
  (id: string) => {
    if (id === 'new-friends') { ... }
    else if (id === 'groups') { ... }
    else if (id === 'tags') { ... }
    // no else for 'seats' → silent no-op
  },
  [router],
);
```
Tapping the "Seats" row in the quick actions list does nothing. Either dead button (remove from `QUICK_ACTION_KEYS`) or unfinished feature (needs route).

Defer — needs product call.

##### `ContactsScreen.tsx:36-39` — Hardcoded brand colors for quick-action icons
`#F97316` (orange) / `#3B82F6` (blue) / `#22C55E` (green) / `#A855F7` (purple). Same family as #45 — defer with theme migration.

##### `NewFriendsScreen.tsx:172-176` + `FriendActivityDetailScreen.tsx:99-102` — silent mark-read failures
```ts
markFriendActivityRead(activityId).catch(() => {})
```
Optimistic mark-read swallows errors. Local state shows "read" but backend may still report unread. Same family as #23.

**Patched**: dev-warns added so devs see failures during development.

#### LOW

- **`ContactsScreen.tsx:105`** — `QUICK_ACTIONS` rebuilt every render. **Patched**: `useMemo([..., t])`.
- **`ContactsScreen.tsx:116-128`** — `loadFriends` `useCallback` deps `[]` (missing `t`). **Patched**.
- **`ContactsScreen.tsx:315-325`** — Alphabet sidebar is read-only Text components; no scroll-to-section. UX gap.
- **`ContactsScreen.tsx:317`** — `top: insets.top + 200` magic number assuming header height.
- **`FriendTagsScreen.tsx:165`** — `tag.color ?? '#A855F7'` hardcoded fallback (same #45 family).
- **`FriendActivityDetailScreen.tsx:272-274` + `NewFriendsScreen.tsx:203-205`** — duplicated inline `i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'` for `toLocaleString` locale. **Patched**: extracted `getLocalizedDateTimeLocale` helper.
- **`FriendActivityDetailScreen.tsx:99-116`** — Promise chain (`.then().then().catch().finally()`) instead of async/await — harder to read.
- **`contact-friends.ts:8-18`** — `getAlphaInitial` only matches A-Z; Chinese names always go to `'#'` bucket. Acceptable Western-style index but worth a comment near `LETTERS`.

#### STYLE-NIT

- 3 screens (Contacts, NewFriends, FriendTags) have nearly identical `stateBlock` (loading / error+retry / empty) pattern. Worth a shared `<ListStateBlock />` — defer (only 3 sites, slight structural differences).
- **`FriendActivityDetailScreen.tsx` + `NewFriendsScreen.tsx`** — identical retry button styles. Same scope as above.

---

## Patches applied

1. **New helper `src/features/contacts/locale.ts`** — `getLocalizedDateTimeLocale(i18nLang)` returns `'zh-CN'` for `zh*` and `'en-US'` otherwise. Used by `FriendActivityDetailScreen` and `NewFriendsScreen` (was inline-duplicated).
2. **`ContactsScreen.tsx`** — `useMemo` wrap on `QUICK_ACTIONS`; `t` added to `loadFriends` deps.
3. **`NewFriendsScreen.tsx`** + **`FriendActivityDetailScreen.tsx`** — `__DEV__` warns on the silent `markFriendActivityRead` catches; use the new locale helper.

---

## Pending decisions for this batch

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| 54 | 🔴 HIGH | 8 | `GroupsScreen.tsx` (entire file) | Screen renders hardcoded fake "groups" — same anti-pattern as deleted #36 | **A.** Wire to `useIMStore.conversations` filtered by group session type. **B.** Delete screen + route (consistent with #36 precedent). **C.** Add demo banner. |
| 55 | 🟢 LOW | 8 | `FriendTagsScreen.tsx:73-78` | N+1 friend-count fetch — 1 round-trip per tag | **A.** Backend includes `friendCount` on `FriendTag`. **B.** Single batched endpoint. **C.** Accept (most users have <10 tags). |
| 56 | 🟢 LOW | 8 | `ContactsScreen.tsx:208-219` | "Seats" quick-action tap = silent no-op | **A.** Remove "seats" from `QUICK_ACTION_KEYS`. **B.** Wire a real route. Needs product call. |
