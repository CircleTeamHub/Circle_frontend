# Batch 7-ii — Discover UI components

> Files: 10 (`src/features/discover/components/*.tsx`)
> Approx. lines reviewed: ~1500
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md) · pairs with 7-i / 7-iii / 7-iv.

## Files in scope

| File | Lines | Role |
|---|---|---|
| `circle-filter-bar.tsx` | 95 | Horizontal FlatList of circle filter pills with i18n'd "all" entry. |
| `image-grid.tsx` | 70 | 1/2/3/4 / N-col image layout with width budget from `useWindowDimensions`. |
| `moment-card.tsx` | 171 | Moments-feed row: avatar + content + like/comment actions. |
| `moment-comment-input.tsx` | 123 | Modal-style comment composer with KeyboardAvoidingView + backdrop. |
| `moments-feed.tsx` | 190 | FlatList of moments + 30s new-count polling + pull-to-refresh. |
| `my-circles-panel.tsx` | 233 | Tabbed list (joined/created/managed/applied) inside DiscoverScreen. |
| `plaza-feed.tsx` | 177 | FlatList of plaza posts with filter bar + filter-error retry banner. |
| `plaza-post-card.tsx` | 184 | Plaza row: avatar + content + restriction tap dialog. |
| `post-card.tsx` | 127 | **Dead code** — only exported via unused barrel. |
| `restriction-badge.tsx` | 88 | VIP / 信用 / 靓号 badges with hardcoded brand colors. |

---

## Findings (severity-tagged)

### H · 0 | M · 3 | L · 6 | STYLE · 3

#### MEDIUM

##### `post-card.tsx:44-127` + `types/index.ts:47-56` — entire file is dead code (#44)
Never imported except via `src/features/discover/index.ts` barrel which is itself never imported. Verified:
- `grep -rn "from '@/features/discover'"` → no hits
- `grep "PostCard"` → only the barrel re-export and the file itself
- `Post` interface is only referenced inside `post-card.tsx`

**Fix**: delete `post-card.tsx`, drop the re-export from `index.ts`, delete the `Post` interface from `types/index.ts`.

##### `moment-comment-input.tsx:96` + `plaza-post-card.tsx:93-107` + `restriction-badge.tsx:48,55,62` — hardcoded Chinese strings outside i18n
Same family as #17/#25/#33. Pattern: use `t(key, { defaultValue: zh })` so locale JSON can be filled later without breaking zh users today. Specific strings:
- `moment-comment-input.tsx:96` — `'回复 ${nickname}'` placeholder, `'写评论...'` empty placeholder
- `plaza-post-card.tsx:97-103` — restriction reasons `'VIP{N}以上'` / `'信用值{N}以上'` / `'靓号用户'` and `'、'` separator (Chinese punctuation, not ASCII comma)
- `restriction-badge.tsx:48, 55, 62` — `'VIP{N}+'` / `'信用{N}+'` / `'靓号'` badge labels

**Fix**: route through `i18n.t(..., { defaultValue: zh })`. Patched in this batch.

##### `restriction-badge.tsx:49, 56, 63` — hardcoded brand colors not in theme
`#F59E0B` (amber for VIP), `#3B82F6` (blue for credit), `#A855F7` (purple for fancy number) bypass the `useTheme()` palette. Breaks dark-mode parity and centralized brand control.

**Fix**: add semantic tokens (`badgeVip`, `badgeCredit`, `badgeFancyNumber`) to the theme. **Deferred** to a theme batch — pulling out into theme means touching `src/theme/*` which is its own surface (#45).

#### LOW

- **`moments-feed.tsx:70-80`** — 30s `setInterval` for new-post count doesn't pause when app backgrounds. On Android in particular, expo backgrounds the JS bridge → setState on stale view if user returns within 30s. Add `AppState` gating. **STYLE → LOW**, patched.
- **`moments-feed.tsx:75-77`** — silent `try/catch` around `fetchNewMomentsCount`. Add `__DEV__` warn. Patched.
- **`moments-feed.tsx:106-110`** — silent rollback catch in `handleLike`. Worth a dev-warn (consistent with optimistic-update conventions). Patched.
- **`moment-card.tsx:91-100` + `plaza-post-card.tsx:114-123`** — exact-duplicate `timeLabel` block. Extract `formatRelativeTime(date, t)` helper. Patched.
- **`restriction-badge.tsx:81`** — `as any` cast on Ionicons glyph name (same family as #30). Defer with the chat-bubble cast.
- **`image-grid.tsx:13-15`** — `containerWidth = screenWidth - Spacing.lg * 2 - Spacing.md * 2` assumes specific parent padding. Tight coupling. Worth a comment but not a fix.

#### STYLE-NIT

- **`my-circles-panel.tsx:208-227`** — `.map()` over potentially 50+ rows inside the parent ScrollView. No virtualization. For most users (<10 joined circles) this is fine; cap-driven concern.
- **`plaza-feed.tsx:75-77`** — `fetchAllCircles()` on every PlazaFeed mount. No realtime invalidation when user joins/leaves circles. Defer (cross-cutting).
- **`circle-filter-bar.tsx`** — pure / no concerns.

---

## Patches applied

1. **Delete dead code**: `post-card.tsx`, barrel re-export in `index.ts`, `Post` interface in `types/index.ts`.
2. **Extract `formatRelativeTime`** to `src/features/discover/utils/relative-time.ts` + adopt in `moment-card.tsx` + `plaza-post-card.tsx`.
3. **i18n** the hardcoded strings in `moment-comment-input.tsx` / `plaza-post-card.tsx` / `restriction-badge.tsx` via `t(key, { defaultValue: zh })`. Locale JSON unchanged.
4. **`moments-feed.tsx`** — AppState-gate the 30s polling (clear interval on background, restart on active), `__DEV__` warn on the two silent catches.
5. **`restriction-badge.tsx`** — type the Ionicons glyph name properly (no `as any`).

---

## Pending decisions for this batch

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| 44 | ✅ DONE | 7-ii | `post-card.tsx` + `types/index.ts:47` + `index.ts:2` | (resolved in this batch — deleted) |
| 45 | 🟡 MED | 7-ii | `restriction-badge.tsx:49,56,63` | Hardcoded brand hex colors not in theme palette | **A.** Add `badgeVip` / `badgeCredit` / `badgeFancy` semantic tokens. **B.** Accept brand colors stay non-themable (status quo). |
| 46 | 🟢 LOW | 7-ii | `plaza-feed.tsx:75-77` | `fetchAllCircles` only fires on mount; stale after circle-join via realtime | Tie into a realtime event handler in `realtime/client.ts`, or add manual refresh on focus. |
