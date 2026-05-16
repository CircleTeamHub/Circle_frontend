# Batch 13 — Social + User (Surface 13 close-out)

> Files: 11 (`src/features/social/*` 4 + `src/features/user/*` 7)
> Approx. lines reviewed: 2511
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md).
>
> **This surface was completely missed in my initial 12-surface plan.** The MODULE_OVERVIEW mapped 13 src/ subdirectories but I organized batches by 12 user-facing surfaces; `features/social/` (add-friend / create-post flows) and `features/user/` (cross-feature user profile + edit friend remark/tags) had no surface owner, so they slipped. User asked "all code reviewed?" and I caught the gap on audit.

## Files in scope

| File | Lines | Role |
|---|---|---|
| `features/social/send-friend-request.ts` | 15 | i18n initial message helper |
| `features/social/index.ts` | 2 | Barrel — AddFriend + CreatePost (SendFriendRequest missing) |
| `features/social/screens/AddFriendScreen.tsx` | 224 | Search user by accountId + open profile |
| `features/social/screens/CreatePostScreen.tsx` | 482 | Plaza post composer (text + 9 images + tags + restrictions) |
| `features/social/screens/SendFriendRequestScreen.tsx` | 390 | Friend request composer (message + remark + tags + 3 placeholder rows) |
| `features/user/profile-view.ts` | 84 | Pure helpers — isCurrentUserProfile / formatGenderLabel / canOpenSendFriendRequest |
| `features/user/utils/routes.ts` | 252 | All cross-feature user/chat route builders (scope-aware) |
| `features/user/data/profiles.ts` | 161 → 22 | **Was hardcoded mock data (#65)** — now type-only after cleanup |
| `features/user/components/profile-action-row.tsx` | 64 | Pressable row primitive used in UserProfileScreen |
| `features/user/screens/UserProfileScreen.tsx` | 630 | Universal user profile (self + others, 4 scope variants) |
| `features/user/screens/EditFriendRemarkScreen.tsx` | 226 | Edit single remark field |
| `features/user/screens/EditFriendTagsScreen.tsx` | 374 | Toggle tags + create new tags |

---

## Findings

### H · 0 | M · 4 | L · 12 | STYLE · 1

#### MEDIUM

##### 1. `features/user/data/profiles.ts` — Phantom mock data (#65)
161 lines of hardcoded mock users (`陈思琪`, `张明远`, `李晓婷` etc. with fake phone numbers + Unsplash avatars). Wired as `UserProfileScreen` fallback via `getUserProfileById(id, fallbackName)`. In production: real backend userIDs are UUIDs/numeric and never match the mock keys (`chen-siqi`, `zhang-mingyuan`), so the mock branch was effectively dead but **still shipped in the bundle** and would activate if any code passed a mock id.

Same anti-pattern family as #54 (GroupsScreen) and #36 (discover-alerts), both deleted earlier.

**Patched**: deleted all mock data + `getUserProfileById` + `getUserProfileIdByName` (unused). Kept the `UserProfileData` type export. `UserProfileScreen` now builds a minimal synthesized fallback inline (uses `params.name` or i18n'd "未命名用户").

##### 2. `features/social/CreatePostScreen.tsx` — Multiple defects (#66)
**Plaza post composer**, primary user content-creation surface. Found:
- L31 `useTranslation` imported but **never called** (dead import). Entire file is hardcoded zh (~30 strings).
- L230 `handleSubmit` uses `setSubmitting` flag only — no `inFlightRef` Pattern D. Double-tap before render flush can fire 2 `createPlazaPost` calls.
- L255-258: silent per-image upload catch (parity with #47 CreateMoment).
- L308 (now removed): `rightIcon="information-circle-outline"` on NavHeader with no `onRightPress` — **dead icon**.
- L380 (now wired): `<MenuRow icon="document-text-outline" label="选择笔记" rightText="不添加" />` with no `onPress` — **dead row**.

**Patched**: added `useTranslation()` call; `inFlightRef` re-entrancy guard on handleSubmit; `__DEV__` warn on silent upload catch; i18n the error messages (`plaza.create.failedTitle/Message/allUploadsFailed/partialUploadsFailed`); dropped dead info icon from NavHeader; wired note picker to `Alert.alert` "即将上线" stopgap with TODO marker. The remaining ~25 hardcoded zh JSX strings deferred → mechanical i18n grind, parity with #58.

##### 3. `features/user/UserProfileScreen.tsx` — Dead "音视频通话" button + silent catches
- L602-610: "音视频通话" Pressable with **no `onPress`** = dead button. Same family as #28 chat-detail video call placeholder.
- L222, L255, L289: 3 silent catches without dev-warn — fetchUserProfile / fetchFriendStatus / fetchFriendSettings.

**Patched**: AV button wired to `Alert.alert("音视频通话功能即将上线")` stopgap; dev-warns added on all 3 catches.

##### 4. `features/user/EditFriendTagsScreen.tsx:259-284` — Partial-failure handling
`handleSave` does `Promise.all([...addedIds.map(assign), ...removedIds.map(remove)])`. If half succeed and half fail, user sees Alert but local state stays optimistic; on next refresh user sees inconsistent state. Should either roll back optimistic UI on partial failure or use a transactional backend endpoint.

**Defer → #67**. Backend coordination needed.

#### LOW

- **`features/social/AddFriendScreen.tsx`** — 6 hardcoded zh strings + silent search catch. **Patched** all of them (i18n'd via `t(key, { defaultValue: zh })`; dev-warn added). Test [test/add-friend-screen.test.js](test/add-friend-screen.test.js) updated for new account-label pattern.
- **`features/social/SendFriendRequestScreen.tsx:143-148`** — silent fetchFriendTags catch (has fallback UI, missing dev-warn).
- **`features/social/SendFriendRequestScreen.tsx:236-260`** — missing `inFlightRef` (single API call, lower risk).
- **`features/user/UserProfileScreen.tsx:347-376`** — `handleOpenChat` has `openingChat` flag, missing `inFlightRef`.
- **`features/user/UserProfileScreen.tsx:549-554`** — fragile `item === t('profileFields.female')` gender icon check (compares translated strings; breaks on locale switch). Should branch on raw gender value.
- **`features/user/UserProfileScreen.tsx:531`** — `profile.name.charAt(0)` same edge case as Avatar (already patched there).
- **`features/user/EditFriendRemarkScreen.tsx:100-104`** — silent catch. **Patched** with dev-warn.
- **`features/user/EditFriendRemarkScreen.tsx:155-172`** — missing `inFlightRef`.
- **`features/user/EditFriendTagsScreen.tsx:140-144`** — silent catch needs dev-warn.
- **`features/user/EditFriendTagsScreen.tsx:264`** — `initialSet` declared but never used (dead var).
- **`features/user/components/profile-action-row.tsx`** — missing `accessibilityRole`/`accessibilityLabel` on Pressable. Parity with UI-primitives a11y patches in Surface 11.
- **`features/social/CreatePostScreen.tsx` VIP/CREDIT options** — duplicate of `CIRCLE_VIP_OPTIONS_VALUES` in 7-iv but with different value sets (CreatePost has VIP 8, circle creation doesn't). Inconsistency.

#### STYLE

- **`features/user/utils/routes.ts`** — heavy switch-statement duplication across 5 scope-aware helpers (`getUserProfileHref` / `getSendFriendRequestHref` / `getEditFriendRemarkHref` / `getEditFriendTagsHref` / `getChatInfoHref`). Could collapse into a single `scopedRoute(scope, suffix, params)` helper. But explicit form is grep-friendly. **Defer**.

---

## Patches applied (9)

1. **`features/user/data/profiles.ts`** — gutted ~150 lines of mock user data + `getUserProfileById` + dead `getUserProfileIdByName`. Kept type-only export.
2. **`features/user/screens/UserProfileScreen.tsx`** — replaced `getUserProfileById` fallback with inline `useMemo` synthesized minimal profile; added dev-warns to 3 silent catches (fetchUserProfile / fetchFriendStatus / fetchFriendSettings); wired dead "音视频通话" button to Alert stopgap.
3. **`features/social/screens/CreatePostScreen.tsx`** — called `useTranslation` (was imported but unused); added `inFlightRef` Pattern D guard on `handleSubmit`; `__DEV__` warn on silent per-image upload catch; i18n'd 4 error messages (plaza.create.failedTitle/Message/allUploadsFailed/partialUploadsFailed); dropped dead `rightIcon` from NavHeader; wired dead "选择笔记" MenuRow to Alert "即将上线" stopgap; fixed missing `t` + `postTags` + `resetForm` in handleSubmit deps.
4. **`features/social/screens/AddFriendScreen.tsx`** — `useTranslation` call + i18n'd 6 hardcoded zh strings (title, placeholder, button, status messages, account label) + dev-warn on silent search catch.
5. **`features/user/screens/EditFriendRemarkScreen.tsx`** — `__DEV__` warn on silent fetchFriendSettings catch.
6. **`test/add-friend-screen.test.js`** — assertion updated to match the i18n'd account-label pattern (now `t('contacts.accountId', { id: result.accountId })`).

---

## S12 complete redo

After being challenged on Surface 12's spot-check, did a complete pass:

- **30 dynamic route files** (`[id].tsx`, `[field].tsx`) — all pure 1-line re-exports of 16 unique screens. Verified via `find | xargs cat | sort -u`.
- **All 16 target screen `useLocalSearchParams<{...}>()` declarations** verified against their route directory names. Every `[id]` route ↔ screen reads `id`, every `[field]` route ↔ screen reads `field`. **No mismatches.**
- **Anomaly scan**: ran `find app -type f -name "*.tsx" -not _layout -not index | filter lines > 1` — **empty result**. Every non-layout, non-index app file is exactly 1 line.

S12 conclusion: **116/116 verified.**

---

## Pending decisions

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| ~~65~~ | ✅ DONE | S13 | `features/user/data/profiles.ts` | Mock user data deleted. | (resolved 2026-05-15) |
| 66 | 🟢 LOW | S13 | `features/social/CreatePostScreen.tsx` | ~25 remaining hardcoded zh JSX strings (after error-message i18n was patched in this batch) | **A.** Mechanical migration parity with #58 — `t(key, { defaultValue: zh })`. **B.** Accept zh-only for this surface. |
| 67 | 🟢 LOW | S13 | `features/user/EditFriendTagsScreen.tsx:259-284` | Promise.all on assign/remove — partial failure leaves local state out of sync with backend | **A.** Backend transactional endpoint that takes the new tag-set + diffs server-side. **B.** Roll back optimistic UI on partial failure (re-fetch). **C.** Sequential calls with stop-on-first-failure semantics. |

---

**Surface 13 (Social + User) closed at 11/11. Surface 12 complete-redo confirmed at 116/116. Review now genuinely complete.**
