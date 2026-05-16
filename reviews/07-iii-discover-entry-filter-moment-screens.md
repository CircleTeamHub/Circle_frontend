# Batch 7-iii — Discover entry + filter + moment screens

> Files: 7 (`src/features/discover/screens/{Discover,Filter,SelectFilterCircles,SelectCircle,SelectCity,CreateMoment,MomentDetail}Screen.tsx`)
> Approx. lines reviewed: 1977
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md) · pairs with 7-i / 7-ii / 7-iv.

## Files in scope

| File | Lines | Role |
|---|---|---|
| `DiscoverScreen.tsx` | 188 | Tabbed entry (Plaza / Management / Moments) + FAB + filter / settings header icons. |
| `FilterScreen.tsx` | 319 | Draft↔applied filter editing with circle/city chip removal + save/clear footer. |
| `SelectFilterCirclesScreen.tsx` | 299 | Multi-select bulk picker over `useCirclesStore.allCircles` with search + select-all-filtered. |
| `SelectCircleScreen.tsx` | 166 | Single-pick circle for post composer (`usePostFormStore`). |
| `SelectCityScreen.tsx` | 354 | City picker — single/multi modes, nationwide VIP-gated, dispatches to 3 stores. |
| `CreateMomentScreen.tsx` | 283 | Moment composer: text + up to 9 photos + visibility (`FRIENDS_ONLY` / `PRIVATE`). |
| `MomentDetailScreen.tsx` | 368 | Moment detail + comments thread with reply targeting. |

---

## Findings (severity-tagged)

### H · 0 | M · 6 | L · 8 | STYLE · 3

#### MEDIUM

##### `MomentDetailScreen.tsx:188-190` — comment submit silently fails
```ts
} catch {
  // silently fail
}
```
User taps send, input dismisses, comment doesn't appear — no feedback. Worst UX failure mode of the file. Compare to `CreateMomentScreen.tsx:185-187` which surfaces via Alert.

**Fix**: show Alert + don't dismiss input on error (let user retry without re-typing).

##### `MomentDetailScreen.tsx:195-204` + `:171-174` — third duplicate of `formatRelativeTime` + silent like rollback
The time-ago block is reimplemented inline (now 3rd occurrence — moment-card and plaza-post-card consolidated in 7-ii). The like rollback catch also has no `__DEV__` warn — parity with `moments-feed.tsx:106-110` after 7-ii.

**Fix**: import `formatRelativeTime` from the 7-ii util; add `__DEV__` warn.

##### `MomentDetailScreen.tsx:261-266` — hardcoded `zh-CN` locale on comment timestamps
`new Date(item.createdAt).toLocaleString('zh-CN', { month, day, hour, minute })`. Same family as #17 / #25 — should use current i18n language.

**Fix**: read `i18n.language` and format accordingly; provide `defaultValue` Chinese formatted string. Or use a tiny date util keyed by i18n.

##### `CreateMomentScreen.tsx:164-166` — per-image upload error swallowed
```ts
} catch {
  failedUploads += 1;
}
```
Counter increments but real error (4xx vs network vs presign failure) is lost. User sees "9张照片中1张上传失败" with no recourse. Worth `__DEV__` warn so devs see why.

**Fix**: `__DEV__` warn with the URI + error.

##### `FilterScreen.tsx:161-163` — `ToastAndroid?.show` makes iOS save silent
```ts
if (ToastAndroid?.show) {
  ToastAndroid.show(t('discover.filter.saved'), ToastAndroid.SHORT);
}
```
On iOS `ToastAndroid.show` is undefined → save action navigates back with zero visual confirmation. `router.back()` already provides spatial feedback, but the explicit "已保存" toast is intentionally there for a reason — should be parity across platforms.

**Fix**: Make platform-explicit (`Platform.OS === 'android' ? ToastAndroid.show(...) : ...`) and accept silent iOS as the established pattern, OR add a brief Alert on iOS. Going with explicit Platform.OS gate + comment (iOS relies on navigation-back as feedback).

##### `SelectCityScreen.tsx:282-283` — hardcoded VIP brand color (already tracked)
Same `#F59E0B` / `#F59E0B20` as restriction-badge → #45. **Not patching** — wait for theme migration.

#### LOW

- **`CreateMomentScreen.tsx:146-191`** — `useCallback` deps missing `t` (used in error-message construction at L172-173, 186-187). Stable in practice (t is identity-stable from `useTranslation()`) but ESLint hint.
- **`SelectCityScreen.tsx:174-192`** + **`:194-203`** — Same `t`-dep miss in `toggleCity` / `toggleNationwide`.
- **`DiscoverScreen.tsx:83`** — `FILTER_TABS` rebuilt on every render. `useMemo([...], [t])`.
- **`CreateMomentScreen.tsx:128-134`** — `ImagePicker.launchImageLibraryAsync` without explicit permission request. Expo handles iOS implicitly but Android can deny. Defer to permissions audit.
- **`CreateMomentScreen.tsx:153-167`** — Sequential `for-of` over images for upload. 9 photos × ~2s presign+upload = ~18s. `Promise.all` (with concurrency limit) would parallelize. Perf, not correctness.
- **`MomentDetailScreen.tsx:82-84`** — `useMomentsStore((s) => s.moments.find(...))` selector creates a new value (the post) per render IF `moments` array changes. Acceptable, but `useShallow` or memoize would reduce thrash.
- **`SelectCircleScreen.tsx:51-57`** — full-store destructure. Best-practice is per-field selector (see `FilterScreen.tsx:102-113` for pattern). Re-renders on any unrelated field change.
- **`SelectFilterCirclesScreen.tsx:122-123`** — `circle.description.toLowerCase()` — description is technically optional but type allows `string`. If backend sends `null`, this throws. Defer; type contract relies on backend always returning `''`.

#### STYLE-NIT

- **`MomentDetailScreen.tsx:246-281` + `:283-341`** — `renderComment` and `ListHeader` JSX rebuilt every render. Move to `useCallback` / memoize.
- **`FilterScreen.tsx`** — `paddingLeft: 60` is `sectionIcon (44) + gap (16)`. Magic number; brittle if section icon resizes. Comment-worthy.

---

## Patches applied

1. **`MomentDetailScreen.tsx`** — replace inline time-ago with `formatRelativeTime` (7-ii util), `__DEV__` warn on like-rollback catch, surface `addMomentComment` error via Alert + keep input open (don't dismiss on failure), i18n the `zh-CN` `toLocaleString` (read `i18n.language`).
2. **`CreateMomentScreen.tsx`** — `__DEV__` warn on per-image upload failure (logs URI + error); fix `useCallback` deps (add `t`).
3. **`FilterScreen.tsx`** — make `ToastAndroid` call platform-explicit via `Platform.OS === 'android'` + comment.
4. **`DiscoverScreen.tsx`** — `useMemo` for `FILTER_TABS`.
5. **`SelectCityScreen.tsx`** — fix `useCallback` deps for `toggleCity` / `toggleNationwide` (add `t`).

---

## Pending decisions for this batch

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| 47 | 🟢 LOW | 7-iii | `CreateMomentScreen.tsx:153-167` | Sequential upload of up to 9 images (worst case ~18s) | **A.** `Promise.all` with concurrency 3. **B.** Accept — sequential is gentler on network + presign endpoint. **C.** Show per-image progress UI. |
| 48 | 🟢 LOW | 7-iii | `CreateMomentScreen.tsx:128-134` | `ImagePicker.launchImageLibraryAsync` without explicit permission request | **A.** Call `requestMediaLibraryPermissionsAsync()` and surface denied state. **B.** Rely on expo-image-picker implicit permission flow. Needs Android device test. |
| 49 | 🟢 LOW | 7-iii | `SelectCircleScreen.tsx:51-57` | Full-store destructure causes re-render on unrelated field changes | Refactor to per-field selectors (FilterScreen pattern). |
