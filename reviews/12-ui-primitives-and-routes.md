# Batches 12 — UI primitives / Theme + App routes (Surfaces 11 & 12 close-out)

> Files: 19 UI primitives + ~11 non-trivial app routes (other ~105 app files are 1-line re-exports → not separately reviewed)

## Files in scope — Surface 11 (UI / theme / utils, 19 files)

| File | Lines | Notes |
|---|---|---|
| `components/ui/{auth-input,avatar,badge,divider,filter-tabs,icon-circle,index,menu-row,nav-header,search-bar,system-icon-art,user-icon-row}.tsx` | ~900 | Reusable primitives. |
| `theme/{colors,index,provider,tokens,types}.{ts,tsx}` | ~294 | Theme system. |
| `hooks/use-network-status.ts` | 54 | Network status hook. |
| `utils/silence-dom-bridge-rejection.ts` | 28 | DOM bridge rejection silencer. |

(Already-reviewed files excluded: `hooks/use-auth.ts` was Surface 1; `utils/retry.ts` + `utils/validate.ts` were created/reviewed in earlier batches.)

## Files in scope — Surface 12 (app routes, 11 non-trivial)

| File | Lines | Already reviewed? |
|---|---|---|
| `app/_layout.tsx` | 142 | Yes (Surface 4 — migration gate) |
| `app/(tabs)/_layout.tsx` | 170 | New scrutiny — tab bar config |
| `app/index.tsx` | 34 | Yes (Surface 4) |
| `app/(auth)/_layout.tsx` | 23 | Yes (Surface 1) |
| `app/(tabs)/messages/_layout.tsx` | 31 | New scrutiny |
| 6× other tab-group `_layout.tsx` | ~14-15 each | Standard Stack wrappers — spot-check only |

---

## Findings

### H · 0 | M · 4 | L · 4 | STYLE · 0

#### MEDIUM

##### 1. UI primitives lack screen-reader labels (a11y gap)
Cross-cutting issue: 5 primitives used across every screen of the app render `Pressable` / `Switch` without `accessibilityRole` or `accessibilityLabel`. VoiceOver/TalkBack users hear "button, button, button" instead of meaningful labels.

- `auth-input.tsx:122` — password-visibility toggle had no a11y label
- `filter-tabs.tsx:57-66` — tabs missing `accessibilityRole="tab"` + selected state
- `menu-row.tsx:88-110` — row Pressable + Switch missing labels + a11y state
- `nav-header.tsx:61, 66` — back button + right-icon button had no labels
- `search-bar.tsx:51` — search-bar Pressable had no role/label

**Patched** — see "Patches applied" below.

##### 2. `(tabs)/_layout.tsx` tab bar — no `tabBarAccessibilityLabel`
With `tabBarShowLabel: false`, visual labels are hidden — but no `tabBarAccessibilityLabel` is set either, so screen readers can't announce "messages", "contacts", etc. (#64 was almost a HIGH; rolled to MEDIUM because tabs are still navigable.)

**Patched** — added per-tab `tabBarAccessibilityLabel` that includes an "有未读" hint when the badge dot is showing.

##### 3. `(tabs)/messages/_layout.tsx:22-23` — hardcoded zh in route titles
`title: '聊天背景'` and `title: '推荐给朋友'` on Stack.Screen. Even though `headerShown: false`, expo-router uses these for accessibility announcements + tab/history.

**Patched** — `t(key, { defaultValue: zh })`.

##### 4. `search-bar.tsx:24` — hardcoded zh placeholder
`placeholder = '搜索...'` default value. Caller can pass their own but the fallback is locked to zh.

**Patched** — defaults to `t('search.placeholder', { defaultValue: '搜索...' })`.

#### LOW

- **`colors.ts:14, 17, 18, 49`** — semantic tokens `online` / `success` / `warning` / `orange` use hardcoded hex (`#22C55E`, `#FB8C00`, `#F97316`). Same family as #45. Defer (cross-cutting theme decision).
- **`menu-row.tsx:110-115`** — `Switch` accessibility was duplicated with the parent Pressable; resolved with `accessibilityElementsHidden` on Switch + `accessibilityState` on parent.
- **`auth-input.tsx:108`** — `placeholderTextColor={colors.textSecondary + '80'}` — string concat for hex alpha. Works but assumes hex format. Defer.
- **App routes spot-check** — no issues found in any of the 6 tab-group `_layout.tsx` files (all are standard `<Stack>` wrappers).

---

## Patches applied

7 patches across 6 files (5 UI primitives + 2 app routes):

1. **`auth-input.tsx`** — password toggle `Pressable` gained `accessibilityRole="button"` + `accessibilityLabel` (i18n'd, swaps between "显示密码" / "隐藏密码" based on state).
2. **`filter-tabs.tsx`** — tabs gained `accessibilityRole="tab"` + `accessibilityLabel` + `accessibilityState={{ selected }}`; container gained `accessibilityRole="tablist"`.
3. **`menu-row.tsx`** — row `Pressable` gained `accessibilityRole` (button or switch depending on `hasToggle`) + `accessibilityLabel` + `accessibilityHint` (rightText) + `accessibilityState`. Inner Switch marked `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` to avoid double announcement.
4. **`nav-header.tsx`** — back button + right-icon Pressables gained `accessibilityRole="button"` + i18n'd labels; title gained `accessibilityRole="header"`. New `rightAccessibilityLabel` prop for callers to override the auto-derived right-icon label.
5. **`search-bar.tsx`** — placeholder default now uses `t('search.placeholder', { defaultValue: '搜索...' })`; wrapped Pressable gained `accessibilityRole="search"` + label.
6. **`(tabs)/_layout.tsx`** — each tab now sets `tabBarAccessibilityLabel`; when the badge dot is showing, label includes the "有未读" suffix so screen reader users know.
7. **`(tabs)/messages/_layout.tsx`** — i18n'd the 2 hardcoded zh `title` options on `chat-background` + `recommend-friend`.

---

## Pending decisions

None new. (Cross-cutting #45 — brand hex colors in `colors.ts` — already tracked.)

---

**Surface 11 closed at 19/19. Surface 12 (App routes) effectively closed via spot-check — 116 files of which ~105 are 1-line re-exports of feature screens, all of which were reviewed in their feature surfaces (1-10). The 11 non-trivial `_layout.tsx` files are all clean post-patches.**
