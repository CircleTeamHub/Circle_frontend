# Review Batch 06 — API Layer Rest (14 files, 1232 lines)

> Files: `friends.ts` (287) · `circles.ts` (207) · `upload.ts` (184) · `moments.ts` (91) · `profile.ts` (72) · `users.ts` (66) · `notes.ts` (63) · `plaza.ts` (60) · `icons.ts` (51) · `coin.ts` (44) · `collections.ts` (39) · `membership.ts` (32) · `mall.ts` (19) · `notifications.ts` (17)
> Date: 2026-05-15
> Surface: API layer rest — closes the data layer's read/write surface
> **Status: 0 HIGH · 7 MEDIUM · 14 LOW.**

## Batch summary

Across 14 files the layer is consistent: thin endpoint wrappers, generic types via `apiClient<T>`, and `normalizeMediaUrl` applied at every place where the backend returns image URLs (Batch 02 lesson universally adopted ✓). No `console.log` leaks, no inline silent catches at this layer (they sit one floor up in callers).

The risks cluster in **`upload.ts`** (the only file with multi-platform branching + multipart-vs-binary semantics) and a handful of cross-file LOWs:

1. **`upload.ts` localhost check is Android-only** — physical iOS devices have the same "presigned URL points at localhost" problem. Either widen the check or rename.
2. **`upload.ts` local-file uploads have no timeout** — `RNFS.uploadFiles` (Android) and `FileSystem.uploadAsync` (iOS/web) can hang forever on slow networks. Only the `Blob` path has a 60s `AbortController`.
3. **`upload.ts` error message "头像上传失败"** — used for chat images, post media, notes — not just avatars.
4. **`profile.ts` `updateUserProfile` merge order** — `{...refreshedUser, ...payload}` overwrites server-normalized fields with the raw client payload.
5. **`coin.ts` `sendCoinGift` no amount validation** — frontend `sendTransferCardMessage` validates, but this lower-level API doesn't (defense-in-depth gap).
6. **`moments.ts` + `plaza.ts`** unsafe cast pattern `(normalizeMediaUrl(url) as string) ?? url` — cast lies when the function returns null.

The runtime-validation gap (same family as #11/#14 from Batch 02 — `apiClient<T>` trusts types) persists across all 14 files. Adding runtime validators everywhere is too invasive for one batch; flag as deferred.

---

# File 1 — `src/services/api/upload.ts` (184 lines) — HIGHEST RISK IN BATCH

## Findings

### `L65-90` [MEDIUM · BUG · UX] — Localhost reachability check is Android-only
```ts
function assertUploadUrlReachableOnCurrentPlatform(payload: UploadPresignResponse) {
  if (Platform.OS !== 'android') {
    return payload;
  }
  // ... check localhost ...
}
```
The comment + error message imply this catches a dev-environment pain. But:
- **iOS simulator** can reach `localhost` (shares host with Mac). ✓ Skip is fine.
- **Physical iOS device** CANNOT reach `localhost`. The check should fire here too.

`Platform.OS === 'ios'` doesn't distinguish simulator from physical. Reasonable proxy: check both iOS and Android, since simulators are rare in real-world QA — and getting the error message is better than a silent network failure.

**Fix:** check both platforms. Simulator users get a "dev convenience" but error is harmless there since localhost works for them.

---

### `L107-137 vs L139-184` [MEDIUM · BUG · RELIABILITY] — `uploadFileToPresignedUrl` has timeout; `uploadLocalFileToPresignedUrl` doesn't
```ts
// Blob path (L107-137):
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);  // 60s
fetch(uploadUrl, { /* ... */, signal: controller.signal });

// Local-file path (L139-184):
// Android: RNFS.uploadFiles({ /* ... */ })          ← no timeout
// iOS:     FileSystem.uploadAsync(uploadUrl, /* */) ← no timeout
```
`RNFS.uploadFiles` returns `{ promise, jobId }`. To timeout, you'd need to `RNFS.stopUpload(jobId)` from a setTimeout. `FileSystem.uploadAsync` has no abort signal at all in the legacy API.

ChatDetailScreen calls `uploadLocalFileToPresignedUrl` for image messages — this is the **hot path**. A slow/dropped upload hangs the send forever (no user feedback, no retry).

**Fix:** wrap both platform paths with a `Promise.race` against a manual timeout. On Android, also call `RNFS.stopUpload(jobId)` if available.

---

### `L134-136, L164-166, L179-181` [MEDIUM · UX] — Error message "头像上传失败" is hardcoded for all upload kinds
```ts
if (!response.ok) {
  throw new Error(`头像上传失败 (${response.status})`);
}
```
This function uploads avatars, covers, post images, note attachments, and chat images. Showing "头像上传失败" to a user who just tried to send a chat photo is confusing.

**Fix:** generic message "上传失败 (${status})" — let callers decide context-specific wording if they want.

---

### `L48-63` [LOW · POSITIVE] — Closed-set content-type validation
```ts
if (mimeType && ALLOWED_CONTENT_TYPES.has(mimeType)) {
  return mimeType;
}
const extension = fileName?.split('.').pop()?.toLowerCase() ?? '';
return CONTENT_TYPE_BY_EXTENSION[extension as keyof typeof CONTENT_TYPE_BY_EXTENSION] ?? null;
```
Only allowlisted MIME types pass through. Caller-supplied `mimeType` not on the list gets dropped → falls to extension inference → also closed-set. Good defense against `text/html` or other exotic MIME from ImagePicker.

---

### `L41-46` [LOW · CLARITY] — `sanitizeUploadFilename` strips Chinese (and any non-ASCII) characters
```ts
return filename
  .trim()
  .replace(/\s+/g, '-')
  .replace(/[^\w.-]/g, '-');
```
`你好.jpg` → `--.jpg` (very lossy). Intentional to avoid S3 / signing-URL key issues with Unicode, but a comment explaining "we accept some legibility loss for safer S3 keys" would help.

---

### `L3` [DEFERRED] — `expo-file-system/legacy` import
Same #7 deferred. Will need migration before Expo SDK upgrade drops the export.

---

## Test gaps for upload.ts
- `test/upload-api.test.js` doesn't exist
- No tests for: localhost check, content-type resolution, sanitizeUploadFilename edge cases, the platform-branch local-file path

---

# File 2 — `src/services/api/friends.ts` (287 lines)

## Findings

### `L178-188` [LOW · STYLE] — `setFriendRemark` trims twice
```ts
return apiClient<void>(`/friend/${friendUserId}/remark`, {
  method: 'PATCH',
  body: {
    remark: remark?.trim() ? remark.trim() : null,
  },
});
```
`remark?.trim()` runs twice. Stash in a local:
```ts
const trimmed = remark?.trim() ?? '';
body: { remark: trimmed || null }
```

### `L203-221` [LOW · API-SHAPE] — `createFriendRequest` has function overloading for legacy compatibility
```ts
export function createFriendRequest(input: CreateFriendRequestInput): Promise<void>;
export function createFriendRequest(targetId: string, message?: string): Promise<void>;
```
Two call shapes for the same operation. If all current callers use the object form, drop the string overload. If both are used, leave alone — but adds confusion at every call site.

### `L228-233, plus elsewhere` [LOW · DRY] — `{ count: number }.count` extraction repeats
Three endpoints return `{ count: number }` and three callers do `.count`. Tiny helper would consolidate. Not blocking.

### Types throughout [LOW · RUNTIME-VALIDATION] — Same family as deferred #11/#14
All return types are TypeScript-only. Backend rename/drift silently passes through. Deferred globally.

---

# File 3 — `src/services/api/circles.ts` (207 lines)

### `L73, L132, L148, L158` [LOW · STYLE] — Redundant parentheses in `body: (input)` / `body: ({circleId, applicantId})`
Parens around values do nothing. Cosmetic.

### `L29-32, L31-35` [LOW · DRY] — `URLSearchParams` build pattern repeated
`fetchCircles`, `fetchPlazaFeed`, `fetchMomentsFeed` all manually `if (params?.x) query.set('x', String(params.x))`. Helper `appendIfDefined(qs, key, value)` would compress.

---

# File 4 — `src/services/api/moments.ts` (91 lines)

### `L13` [MEDIUM · TYPE-SAFETY] — Unsafe cast `(normalizeMediaUrl(url) as string) ?? url`
```ts
images: post.images.map((url) => (normalizeMediaUrl(url) as string) ?? url),
```
`normalizeMediaUrl` returns `string | null | undefined`. Casting to `string` then `?? url` falls back at runtime, but the cast lies to TypeScript — if `normalizeMediaUrl` returns `null`, `(null as string)` is `null` and `??` catches it. **Works at runtime by accident**.

Cleaner:
```ts
images: post.images.map((url) => normalizeMediaUrl(url) ?? url),
```
Same issue in `plaza.ts:12`. Same fix.

---

# File 5 — `src/services/api/profile.ts` (72 lines)

### `L49-54` [MEDIUM · BUG · DATA] — `updateUserProfile` merge order overwrites server-normalized fields
```ts
try {
  const refreshedUser = await fetchCurrentUser();
  return {
    ...refreshedUser,
    ...payload,            // ← payload OVERWRITES refreshedUser fields
  };
} catch { /* ... */ }
```
If client sends `phoneNumber: '13800138000'` and backend normalizes to `+8613800138000`, the response from `/auth/me` has the normalized form. But this code then overlays the **raw payload back on top**, undoing the normalization. UI shows the un-normalized value briefly until next refresh.

**Fix:** trust the server response — drop the payload spread:
```ts
const refreshedUser = await fetchCurrentUser();
return refreshedUser;
```
Or if there's a reason to merge (e.g., payload contains fields `/auth/me` doesn't), reverse order:
```ts
return { ...payload, ...refreshedUser };  // refreshedUser wins
```

### `L70` [LOW · I18N] — Hardcoded "资料已提交，但刷新用户信息失败"
Same #25 family.

---

# File 6 — `src/services/api/users.ts` (66 lines)

### `L37-52 pickExactAccountMatch` [LOW · POSITIVE]
Pure function with normalized keyword comparison. Defensive `!normalizedKeyword || !users?.length` guards. Good helper.

### `L19` [LOW · TYPE-LAXITY] — `gender: 'male' | 'female' | 'other' | 'unset' | string`
The union with `string` makes the literal types accept any string. If product expects strict enum, drop the `| string` fallback. If schema is genuinely loose, document that backend may return new values.

---

# File 7 — `src/services/api/notes.ts` (63 lines)

### `L31-36` [LOW · API-SHAPE] — `togglePinNote` declares Promise<void> but server returns `{ id, pinned }`
```ts
export async function togglePinNote(id: string, pinned: boolean): Promise<void> {
  await apiClient<{ id: string; pinned: boolean }>(`/note/${id}/pin`, { /* ... */ });
}
```
Response payload typed inside the generic, then discarded. If callers want optimistic-confirm, returning `{ id, pinned }` would be useful. Otherwise the inner generic could be `void`.

---

# File 8 — `src/services/api/plaza.ts` (60 lines)

### `L12` [MEDIUM] — Same unsafe-cast issue as `moments.ts:13`

---

# File 9 — `src/services/api/icons.ts` (51 lines)

Clean. Consistent use of `normalizeMediaUrl` on both option lists + display icons. ✓

---

# File 10 — `src/services/api/coin.ts` (44 lines)

### `L35-44` [MEDIUM · DEFENSE-IN-DEPTH] — `sendCoinGift` doesn't validate amount at API boundary
```ts
export async function sendCoinGift(payload: {
  recipientId: string;
  amount: number;
  message?: string;
}) {
  return apiClient<void>('/coin/gift', { method: 'POST', body: payload });
}
```
The caller (`sendTransferCardMessage` in `im/client.ts` after Batch 04 #15 patch) validates `Number.isInteger(amount) && amount > 0 && amount <= LIMITS.TRANSFER_MAX_AMOUNT`. But this lower-level API trusts the caller — a future caller (script, test, refactor) could bypass.

**Fix:** mirror the same validation here. Backend should reject too, but client-side defense costs nothing.

---

# File 11 — `src/services/api/collections.ts` (39 lines)

### `L12` [LOW · TYPE] — `payload: unknown`
Collections store arbitrary user-saved content. `unknown` is right at the type system — backend can store any shape. Worth a JSDoc explaining the contract.

---

# File 12 — `src/services/api/membership.ts` (32 lines)

Clean. Imports `Wallet` from `./coin` to share the shape — good. ✓

---

# File 13 — `src/services/api/mall.ts` (19 lines)

### `L11-14` [LOW · TYPE-LAXITY] — `MallProduct.action: string`
`action` is presumably a route or deep-link key. Should be a string-literal union of allowed actions. Defer — needs product enum.

---

# File 14 — `src/services/api/notifications.ts` (17 lines)

Tiny. Just two endpoints. ✓

---

# Patches proposed

Defensible without product input:

1. **`upload.ts`** — Widen localhost check to iOS as well; add timeout wrapper for local-file uploads (both Android + iOS paths); generic "上传失败" error message.
2. **`profile.ts`** — Fix merge order in `updateUserProfile` (trust server normalization).
3. **`coin.ts`** — Validate amount at the API boundary (`Number.isInteger + > 0 + <= MAX`).
4. **`moments.ts` + `plaza.ts`** — Remove `as string` unsafe cast.
5. **`friends.ts`** — `setFriendRemark` stash trim once.
6. **`circles.ts`** — Remove redundant parens (cosmetic only — can skip).

## Deferred — broader / needs product / cross-file

| # | Where | Issue | Options |
|---|---|---|---|
| 38 | All 14 API files | No runtime validation of `apiClient<T>` responses (same family as #11 / #14) | Zod / yup-style schema at every endpoint; or per-domain runtime guards like the `isAuthTokens` we added in Batch 02. Touches every API file — large effort. |
| 39 | `notes.ts:31-36`, `circles.ts` repeated `URLSearchParams` | DRY helpers across the layer | Extract `appendQuery` + `extractCount` helpers. Cosmetic refactor. |
| 40 | `mall.ts:11`, `users.ts:19` | Loose type unions with `string` fallback | Either tighten enums (product enum first) or accept as documented loose contracts. |
