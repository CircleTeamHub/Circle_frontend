# Batch 7-iv — Circle CRUD + verification screens (Surface 7 closing batch)

> Files: 8 (`src/features/discover/screens/{CircleDetail,EditCircle,CreateCircle,CircleNotificationSettings,AdminReview,InvitationVerification,SelectVerifier,VerificationRequest}Screen.tsx`)
> Approx. lines reviewed: 3001 (largest single batch in Surface 7)
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md) · closes Surface 7.

## Files in scope

| File | Lines | Role |
|---|---|---|
| `CircleDetailScreen.tsx` | 657 | View + circle-icon management; OWNER/ADMIN gates. |
| `EditCircleScreen.tsx` | 745 | Comprehensive edit form (essentially a clone of Create). |
| `CreateCircleScreen.tsx` | 622 | Comprehensive creation form, VIP-gated. |
| `CircleNotificationSettingsScreen.tsx` | 158 | 3 persisted toggles (global/sound/offline). |
| `AdminReviewScreen.tsx` | 181 | Admin override for pending circle invitations. |
| `InvitationVerificationScreen.tsx` | 272 | 10-slot verifier grid + add/remove. |
| `SelectVerifierScreen.tsx` | 157 | Pick a friend to verify invitation. |
| `VerificationRequestScreen.tsx` | 209 | Approve/reject incoming verify request. |

---

## Findings (severity-tagged)

### H · 0 | M · 6 | L · 10 | STYLE · 3

#### MEDIUM

##### 1. `CircleNotificationSettingsScreen` — **Phantom Feature** (#51)
`useCircleNotificationStore` is persisted to MMKV but **never read by anything except this settings screen** (verified: `grep -rln useCircleNotificationStore` returns only the screen, the store, and `app/_layout.tsx`'s rehydrate call). User toggles `离线推送` / `声音` / `全局开关` — toggles persist — but the actual notification handlers in `realtime/client.ts` and OpenIM SDK never consult this store. Privacy/UX bug: users believe they've disabled push but they haven't.

**Defer**: needs product + push-notification handler wiring decision. Cross-cutting (touches realtime client, notification permission flow). Tracked as #51.

##### 2. `CircleDetailScreen.tsx:302, 464, 472, 517` — Hardcoded Chinese strings
- L302: `'无法识别图片格式'` Alert message
- L464: `圈子图标` section title
- L472: `当前图标` chip label
- L517: `'上传中...'` / `'上传圈子图标'` button labels

Same family as #17 / #25 / #33. Patched in this batch via `t(key, { defaultValue: zh })`.

##### 3. `AdminReviewScreen.tsx:64-72` + `SelectVerifierScreen.tsx:61-70` — silent fetch failures
Both use `try { fetch } finally { setLoading(false) }` with no catch. On network failure → empty list, no error UI, no retry path. Compare `SelectFilterCirclesScreen` / `MyCirclesPanel` which expose retry buttons.

**Fix**: add `error` state + retry button on each. Patched.

##### 4. `VerificationRequestScreen.tsx:85-95` + `InvitationVerificationScreen.tsx:104-114` — same pattern, partial
VerificationRequest just `setInvitation(null)` on failure → renders "请求不存在". InvitationVerification at least pops `Alert.alert`, but then renders the "邀请不存在" empty state — transient errors are misclassified as "doesn't exist". Worth a retry button.

**Patched**: added `loadError` state + retry button (parity with `MomentDetailScreen` pattern).

##### 5. `CreateCircleScreen.tsx:336-339` + `EditCircleScreen.tsx:362-366` — silent avatar upload failure
```ts
} catch {
  // Avatar upload failed — proceed without avatar
}
```
Creating: circle is created with no avatar, user has no clue why. Editing: keeps previous avatar (better) but still silent. Add `__DEV__` warn so devs see why.

**Patched**: dev-warn added in both. Inline UX comment explains the intentional non-blocking semantics.

##### 6. `CreateCircleScreen.tsx:222-235` + `EditCircleScreen.tsx:212-225` — i18n key arrays rebuilt every render
`PRESET_CATEGORIES`, `VIP_OPTIONS`, `CREDIT_OPTIONS` recompute via `.map((k) => ({ label: t(...) }))` on every render. Three arrays × two files = six unnecessary recomputations per render. Pure perf.

**Patched**: wrapped in `useMemo([...], [t])`.

#### LOW

- **`CircleDetailScreen.tsx:236-238`** — `catch {}` no error capture, only generic message. Inconsistent with `selectCircleIcon` catch at L265-271 which extracts `error.message`.
- **`EditCircleScreen.tsx:17`** — imports `router` directly from `expo-router` (vs. `useRouter()` hook used elsewhere). Works but inconsistent.
- **`Create/EditCircle`** — `handlePickAvatar` no explicit permission request (same as #48).
- **`CreateCircleScreen.tsx:303-308, 310-315`** + **`EditCircleScreen.tsx:320-332`** — `cycleVip` / `cycleCredit` use `prev as any` cast on `indexOf`. Real fix is typed const arrays; works as-is.
- **`VerificationRequestScreen.tsx:202-203`** + **`InvitationVerificationScreen.tsx:212, 263-264`** — Hardcoded success green `#22C55E`. Same family as #45.
- **`InvitationVerificationScreen.tsx:232`** — `name={statusIcon.name as any}` Ionicons cast. Same as restriction-badge (fixed in 7-ii). **Patched**: typed properly.
- **`InvitationVerificationScreen.tsx:165-170`** — `handleAddVerifier` not `useCallback`.
- **`AdminReviewScreen.tsx:121`** + **`VerificationRequestScreen.tsx:130-131`** — `useCallback` deps missing `t`. Patched.
- **`CircleDetailScreen.tsx:218-224`** — `mountedRef` pattern duplicated in 2 effects. Acceptable.
- **`AdminReviewScreen.tsx:74`** — `useEffect(() => loadData())` no cleanup; setState-on-unmount possible. Borderline.

#### STYLE-NIT

- **`CreateCircleScreen` ↔ `EditCircleScreen`** — ~50% of code is verbatim duplication (style sheets, category/tag/city handlers, VIP/credit cycling). Worth extracting `<CircleFormBody>` shared component but huge refactor; defer to a dedicated DRY pass.
- **`CircleDetailScreen.tsx:464-521`** — "圈子图标" section inline JSX; could extract to `<CircleIconPicker>`.
- **`CircleDetailScreen.tsx:559-616`** — "入圈规则摘要" repeats `<View summaryRow><Text label /><Text value /></View><Divider />` 5 times. Map over a config array.

---

## Patches applied

1. **`AdminReviewScreen.tsx`** — added `error` state, retry button on error, dev-warn on caught fetch failure, `t` added to relevant deps.
2. **`SelectVerifierScreen.tsx`** — same pattern: error state + retry + dev-warn.
3. **`VerificationRequestScreen.tsx`** — `loadError` state + retry button on transient error (distinguishes from genuine 404), `t` added to handleRespond deps.
4. **`InvitationVerificationScreen.tsx`** — `loadError` + retry button, typed `IoniconName` glyph (no `as any`), `useCallback` on `handleAddVerifier`.
5. **`CircleDetailScreen.tsx`** — i18n'd 5 hardcoded Chinese strings via `t(key, { defaultValue: zh })`.
6. **`CreateCircleScreen.tsx`** + **`EditCircleScreen.tsx`** — dev-warn on silent avatar upload catch; `useMemo` wrapping `PRESET_CATEGORIES` / `VIP_OPTIONS` / `CREDIT_OPTIONS`.

---

## Pending decisions for this batch

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| 51 | 🟡 MED | 7-iv | `CircleNotificationSettingsScreen.tsx` + `use-circle-notification-store.ts` | **Phantom Feature**: settings persist but nothing consumes them; user thinks toggles work | **A.** Wire the store values into `realtime/client.ts` to gate `circle.*` notification dispatches + integrate with OS push permission flow. **B.** Delete the screen + store until backend feature is real. **C.** Document as "UI only, no enforcement" inside the screen. |
| 52 | 🟢 LOW | 7-iv | `CreateCircleScreen.tsx` + `EditCircleScreen.tsx` | ~50% verbatim duplication of form body, style sheets, and handlers | Extract `<CircleFormBody>` shared component. Significant refactor; left for a dedicated DRY pass. |
| 53 | 🟢 LOW | 7-iv | `CircleDetailScreen.tsx:559-616` | "入圈规则摘要" repeats summary-row JSX 5 times | Map over `[{ label, value }]` config array. |
