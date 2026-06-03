# Batch 7-i — Discover foundation (stores + utils + barrel)

> Files: 13 (`src/features/discover/store/*.ts` 10 + `src/features/discover/utils/*.ts` 2 + `src/features/discover/index.ts` 1)
> Approx. lines reviewed: ~800
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md) · pairs with batches 7-ii / 7-iii / 7-iv.

## Files in scope

| File | Lines | Role |
|---|---|---|
| `store/use-discover-store.ts` | 116 | Plaza feed state with `plazaQueryVersion` + `plazaLatestRequestId` stale-response guard. |
| `store/use-circles-store.ts` | 109 | Joined / created / managed / applied circles fetcher; uses `deriveManagedCircles`. |
| `store/use-moments-store.ts` | 96 | Moments feed CRUD (toggleLike / addComment / removeComment). |
| `store/discover-state.ts` | 79 | Pure reducer for plaza fetch success/failure with stale-response guard. |
| `store/managed-circles.ts` | 51 | Pure: derive managed circles from created + (joined ∩ OWNER\|ADMIN role). |
| `store/use-discover-filter-store.ts` | 68 | Plaza filter draft↔applied state, MMKV-persisted via `partialize` to applied only. |
| `store/use-circle-notification-store.ts` | 31 | Three persisted toggles (global / sound / offline). |
| `store/use-circle-activity-store.ts` | 43 | Standalone unread-count store. **Dead code** — see #41. |
| `store/use-create-circle-form-store.ts` | 17 | Cross-screen form: selected cities. |
| `store/use-post-form-store.ts` | 19 | Cross-screen form: selected circle + city. |
| `utils/circle-filter.ts` | 37 | Pure: filter circles by id-set ∩ city-overlap. |
| `utils/city-selection.ts` | 94 | Pure: city picker state machine (single vs multi, nationwide). |
| `index.ts` | 2 | Barrel — only exports DiscoverScreen + PostCard. |

Existing test coverage in this batch: `discover-state.test.mts`, `managed-circles.test.mts`, `city-selection.test.mts` — all green pre-patch.

---

## Findings (severity-tagged)

### H · 0 | M · 4 | L · 5 | STYLE · 2

#### MEDIUM

##### `use-moments-store.ts:30-31` — pull-to-refresh dies silently mid-paginate
```ts
if (state.loading) return;
if (!reset && state.hasMore) return;
```
`fetchMoments(false)` (onEndReached) sets `loading=true`. While in flight, `fetchMoments(true)` (pull-to-refresh on `moments-feed.tsx:86`) early-returns. User sees the refresh spinner reset with no data change. Compare `useDiscoverStore` which distinguishes `plazaLoading` vs `plazaRefreshing` and lets a reset preempt.

**Fix**: split `loading` into `loading` + `refreshing`, and let `reset=true` proceed even if a paginate is in-flight (paginate's response is then discarded via a stale-response guard).

##### `use-moments-store.ts:39` — duplicate IDs after paginate over a prepend
```ts
moments: reset ? result.items : [...state.moments, ...result.items],
```
Discover-store dedups via `mergePlazaPosts` (Map by id). Moments store concatenates blindly. If user creates a moment (which calls `prependMoment`) between page-1 and page-2 fetches, the new moment can appear on the server's page-2 too → duplicate keys in the FlatList → React key collision.

**Fix**: Map-dedup like `mergePlazaPosts`.

##### `use-moments-store.ts:36-46` — no try/catch; rejection bubbles silently into caller
The `fetch → set` block is in a try but has no catch. Errors propagate; `moments-feed.tsx` doesn't surface them either (just `await fetchMoments(true)` from the refresh handler). Either:
- (A) catch + set an error state (parity with `useDiscoverStore`'s `applyPlazaFetchFailure`)
- (B) at least dev-warn so it doesn't disappear into the rejection void

**Fix**: catch + `__DEV__` warn (mirrors discover-store).

##### `use-circle-activity-store.ts:15-43` — entire file is dead code (#41)
`useCircleActivityStore` is never imported (`grep -rn useCircleActivityStore src app` returns only the declaration). The discover-tab unread badge is fed via `realtime/client.ts:165` + `tabBadgeStore.setDiscoverUnread`. The duplicate optimistic-decrement + REST mark-read pathway lives only as dead code.

**Fix**: delete the file. If the bell-icon pattern is wanted later, copy the `friendActivityUnreadStore` pattern (which IS wired).

#### LOW

- **`use-discover-store.ts:47-54`** — nested ternary for loading/refreshing flags is hard to read. Pure cosmetic; race-guard correctness already validated. Defer.
- **`use-circles-store.ts:50-52`** — N+1 detail-fetch for managed-role derivation. For users with 50+ joined circles this is 50+ extra REST calls every list refresh. Real fix is server-side: `GET /circle/my?tab=joined` should include `myRole`. Defer behind backend change.
- **`use-circles-store.ts:38-77`** — no re-entrancy guard. Concurrent `fetchMyCircles()` calls (e.g., from React StrictMode double-effect) will both run, both write. Last write wins. Not observed problematic in current call-sites, but worth a `loadingInFlight` ref pattern if seen.
- **`discover-state.ts:13-21`** — `snapshotPosts` arg is dead. The merge inside `applyPlazaFetchSuccess` uses `state.plazaPosts`, never `args.snapshotPosts`. Caller passes it; test passes it. **Fix**: drop the arg from signature + call site + test.
- **`utils/circle-filter.ts:25-26`** — circles with empty `cities` array are excluded when filter has cities. "Nationwide" semantics unclear — probably intentional but worth a comment near the early-return.

#### STYLE-NIT

- **`utils/city-selection.ts:29, 78`** — magic Chinese string `'全国'` repeated. Extract `const NATIONWIDE = '全国'` (test already passes it as-is so swap is safe).
- **`use-circle-notification-store.ts`**, **`use-create-circle-form-store.ts`**, **`use-post-form-store.ts`** — no `partialize` / `version` on persisted stores. Acceptable for boolean and string primitives where shape change is unlikely, but worth a project convention note (followup, not this batch).

---

## Patches applied

1. **`use-moments-store.ts`** — split `loading` vs `refreshing`, allow `reset=true` to preempt a paginate, add Map-dedup, add try/catch with dev-warn.
2. **Delete `use-circle-activity-store.ts`** (and any stale references — none found).
3. **`discover-state.ts`** — drop dead `snapshotPosts` arg from `ApplyPlazaFetchSuccessArgs`, `applyPlazaFetchSuccess` body, the `useDiscoverStore` call site, and `discover-state.test.mts`.
4. **`utils/city-selection.ts`** — extract `NATIONWIDE` constant; behavior unchanged.

Deferred decisions are written into the consolidated pending-decisions table.

---

## Pending decisions for this batch

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| 41 | 🟢 LOW | `use-circles-store.ts:50-52` | N+1 detail fetch for managed-role derivation | **A.** Backend includes `myRole` in `/circle/my?tab=joined`. **B.** Accept; cap user joined-circle count. **C.** Lazy-fetch role only when entering management UI. |
| 42 | 🟢 LOW | `use-circles-store.ts:38-77` | No re-entrancy guard on `fetchMyCircles` / `fetchAllCircles` | Add `inFlightRef`-style guard (parity with hook-level Pattern D), or accept last-write-wins. |
| 43 | 🟢 LOW | `utils/circle-filter.ts:25-26` | Empty-cities circles excluded under any city filter; "nationwide" semantics unclear | A. Document as intentional. B. Treat empty cities as "matches any" (nationwide). Needs product call. |
