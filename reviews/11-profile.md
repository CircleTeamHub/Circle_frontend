# Batch 11 — Profile / Settings (Surface 8 close-out)

> Files: 31 (`src/features/profile/{components, hooks, screens, *.ts}`)
> Approx. lines reviewed: 5578
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md). Split into 3 sub-batches.

## Sub-batch breakdown

| Sub-batch | Scope | Files | Lines |
|---|---|---|---|
| 11-i | Foundation: utils + hooks + config + index | 8 | 707 |
| 11-ii | Components + main + settings screens | 11 | 1737 |
| 11-iii | Commerce + auth + edit screens | 12 | 3134 |

---

## Findings rollup

### H · 0 | M · 6 | L · 12 | STYLE · 1

#### MEDIUM

##### 1. Stale-on-language-switch i18n constants (11-i)
- **`avatar-picker-feedback.ts:8`** — `AVATAR_PICKER_HELPER_TEXT = i18n.t(...)` evaluated at module load. User switches language → string stays frozen until app reload.
- **`profile-edit-config.ts:212`** — `PROFILE_EDIT_FIELDS = buildProfileEditFields()` — same stale-capture issue, but only used by tests in production (live screens use `getProfileEditFields()` which rebuilds).

**Patched**: replaced `AVATAR_PICKER_HELPER_TEXT` const with `getAvatarPickerHelperText()` function; updated call site in EditProfileFieldScreen + the dedicated test. `PROFILE_EDIT_FIELDS` left in place (test-only export, dev-cost-aware).

##### 2. Phantom toggles via `SettingsSwitch` (11-ii) (#61)
[settings-detail.tsx:88-99](src/features/profile/components/settings-detail.tsx) defines `SettingsSwitch` that takes `initialValue` but the state stays internal — no `onValueChange` callback, no Zustand wiring, no MMKV persist. **25 toggles across 4 screens are phantoms** that look like working settings:
- `AppearanceSettingsScreen.tsx` — 5 toggles (theme-mode, font-size, hide-chat-avatar, etc.)
- `NotificationSettingsScreen.tsx` — 10 toggles (4 sections × 2-3 each)
- `PrivacySettingsScreen.tsx` — 8 toggles
- `AccountSecuritySettingsScreen.tsx` — 2 toggles

Same anti-pattern as #51 (CircleNotificationSettings) and #57 (Notes force-sync). User believes they're configuring privacy / appearance / notifications but nothing changes downstream.

**Defer** to #61 — needs architectural fix at the `SettingsSwitch` component level + per-screen wiring to real stores.

##### 3. ProfileScreen silent refresh catch (11-ii)
[ProfileScreen.tsx:229-231](src/features/profile/screens/ProfileScreen.tsx) — `refreshCurrentUser` catch only had "best-effort" comment, no dev-warn. Failure modes: broken `/auth/me` token refresh, network drop mid-load, profile mismatch.

**Patched**: `__DEV__` warn added.

##### 4. `MallScreen` phantom product actions (11-iii) (#62)
[MallScreen.tsx:128-136](src/features/profile/screens/MallScreen.tsx) — `handleProductPress` switch only routes `'membership'` and `'wallet'`. The other 9 product action types (`'avatar-frame'`, `'buy-code'`, `'experience'`, `'fancy-number'`, `'group-expansion'`, `'profile-frame'`, `'recharge-card-create'`, `'recharge-card-use'`, ?) all have Pressable rows but **tapping does nothing silently**.

Same family as the dead-buttons in NotesScreen (already patched with stopgap Alert). **Defer** to #62 — needs product call on which actions to wire vs hide.

##### 5. `ChangePasswordScreen` re-entrancy (11-iii)
[ChangePasswordScreen.tsx:86-122](src/features/profile/screens/ChangePasswordScreen.tsx) — `handleSave` only had `setSubmitting(true)` as the guard. setState is async; double-tap before the next render can fire `changePassword` twice (especially on slow networks where the disabled state hasn't flushed to the button).

**Patched**: added `inFlightRef` Pattern D guard. Also dev-warn on the silent `logoutAll()` failure inside the catch.

##### 6. WalletScreen silent catches (11-iii)
[WalletScreen.tsx:99, 131](src/features/profile/screens/WalletScreen.tsx) — `fetchWallet` and `rechargePoints` errors set a user-visible error message but lose the underlying error. **Patched**: `__DEV__` warns added.

#### LOW

- **`profile-display.ts:8`** — hardcoded zh fallback `'完善资料后会在这里展示你的介绍。'` in pure helper. **Patched**: added optional `t` param; UserProfileScreen call sites now pass `t` to get localized fallback.
- **`ProfileScreen.tsx:342, 365`** — 2 hardcoded zh strings (`'我的图标'`, `'添加图标'`). **Patched** via `t(key, { defaultValue: zh })`.
- **`AppSettingsScreen.tsx:170`** — silent `getAppCacheSize` catch with graceful fallback. **Patched** with dev-warn.
- **`MallScreen.tsx`** — 13 hardcoded zh strings in `FALLBACK_SECTIONS` const (product names + section titles). MEDIUM rollup but FALLBACK_SECTIONS only runs when API returns empty — not user-facing in steady state. Defer (mechanical i18n work).
- **`MemberCenterScreen.tsx`** — 5 hardcoded zh strings + 2 hardcoded brand hex colors (`#D946EF`, `#FACC15`). Same family as #45. Defer.
- **`MemberRulesScreen.tsx`** — 5 hardcoded zh strings (rule body + title). Pure static content; could move to i18n keys but low ROI vs. updating the markdown directly. Defer.
- **`MyIconsScreen.tsx`** — 5 hardcoded zh strings (Alert titles, error labels). Defer (mechanical).
- **`CollectionsScreen.tsx`** — 6 hardcoded zh strings (delete dialog, status messages) + `as any` Ionicons cast. Defer.
- **`MallScreen.tsx:192` + `CollectionsScreen.tsx:262`** — `Ionicons name={item.icon as any}` glyph cast. LOW (same as restriction-badge → fixed in 7-ii; CollectionsScreen + MallScreen could be patched the same way but defer).

#### STYLE

- **`EditProfileFieldScreen.tsx`** (788 lines) — over project's 800-line guideline. Mixes profile field config dispatch + avatar picker modal + date picker modal + city picker modal + gender option list + general save flow. Should split into `EditProfileFieldScreen` (router/dispatch) + per-field editors. **Defer** → #63.

---

## Patches applied

8 patches across 7 files:

1. **`avatar-picker-feedback.ts`** — `AVATAR_PICKER_HELPER_TEXT` const replaced with `getAvatarPickerHelperText()` function (fixes stale-on-language-switch).
2. **`profile-display.ts`** — `getProfileSignature` takes optional `t` parameter; defaults preserved.
3. **`UserProfileScreen.tsx`** — 2 call sites pass `t` to `getProfileSignature`.
4. **`EditProfileFieldScreen.tsx`** — import + usage updated to `getAvatarPickerHelperText()`.
5. **`ProfileScreen.tsx`** — `__DEV__` warn on `refreshCurrentUser` silent catch; i18n'd 2 hardcoded zh strings.
6. **`AppSettingsScreen.tsx`** — `__DEV__` warn on `getAppCacheSize` silent catch.
7. **`ChangePasswordScreen.tsx`** — `inFlightRef` Pattern D re-entrancy guard on `handleSave`; dev-warn on `logoutAll()` silent catch.
8. **`WalletScreen.tsx`** — dev-warns on `fetchWallet` + `rechargePoints` silent catches.

Test file updated: `test/profile-avatar-picker-feedback.test.js` (import name change).

---

## Pending decisions

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| 61 | 🟡 MED | 11-ii | `settings-detail.tsx:88-99` + 4 settings screens | **Phantom Feature**: 25 toggles take `initialValue` but never bubble up — no callback, no Zustand wiring, no MMKV persist. User believes they're configuring privacy/appearance/notifications but nothing happens downstream. | **A.** Refactor `SettingsSwitch` to controlled component (`value`+`onValueChange` props); wire each toggle to a real store (parallel to use-circle-notification-store but with actual consumers). Large feature scope. **B.** Delete the toggles until the features are real. **C.** "敬请期待" Alert stopgap. |
| 62 | 🟢 LOW | 11-iii | `MallScreen.tsx:128-136` | `handleProductPress` only routes `'membership'` + `'wallet'`; other 9 product actions are silent no-ops | **A.** Wire each action to its destination route. **B.** Filter `FALLBACK_SECTIONS` to only `membership`/`wallet` until backend implements the rest. **C.** Add Alert stopgap. |
| 63 | 🟢 LOW | 11-iii | `EditProfileFieldScreen.tsx` (788 lines) | Single screen exceeds 800-line guideline; mixes router + avatar picker + date picker + city picker + gender list + save flow | Split into `EditProfileFieldScreen` (composition) + per-editor sub-components. Mechanical refactor. |

---

**Surface 8 closed at 31/31. 11 of 12 surfaces closed.**
