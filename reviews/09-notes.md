# Batch 09 — Notes (Surface 9 close-out)

> Files: 12 (`src/features/notes/{components/*, dom/*, screens/*, store/*, utils/*, types.ts}`)
> Approx. lines reviewed: 2701
> Companion to [REVIEW_PROGRESS.md](../REVIEW_PROGRESS.md).

## Files in scope

| File | Lines | Role |
|---|---|---|
| `types.ts` | 80 | NoteStatus / NoteMedia / NoteSummary / NoteDetail / inputs. |
| `utils/note-blocks.ts` | 57 | `extractPlainText` / `extractMediaFromBlocks` — parse BlockNote document. |
| `utils/note-format.ts` | 54 | `formatNoteDate` / `formatNoteFullDate` / `buildNoteMeta`. |
| `store/use-notes-settings-store.ts` | 49 | 6 persisted toggles + force-sync timestamp. |
| `components/NoteCard.tsx` | 124 | Row card with cover thumbnail + pin/edit actions. |
| `components/NoteBlockEditor.tsx` | 158 | Native-side wrapper around the DOM bridge editor. |
| `components/NoteBlockRenderer.tsx` | 160 | Renders a saved Block[] document in pure RN. |
| `dom/NoteBlockEditor.dom.tsx` | 240 | **`'use dom'` BlockNote-in-WebView editor.** Bridged via Expo DOM. |
| `screens/NoteDetailScreen.tsx` | 151 | Read-only view of a single note. |
| `screens/NotesSettingsScreen.tsx` | 276 | 6 display toggles + "force sync" repair flow. |
| `screens/EditNoteScreen.tsx` | 344 | Edit/Create form with the DOM editor + group chips. |
| `screens/NotesScreen.tsx` | 1008 | List + tabs + search + group manager modal + drag-reorder. |

---

## Findings (severity-tagged)

### H · 0 | M · 5 | L · 11 | STYLE · 2

#### MEDIUM

##### 1. `NotesSettingsScreen.tsx:78-118` — "Force sync" is a Phantom Feature (#57)
The UI promises:
> "将清空本地笔记与上传队列，再从服务器全量拉取"

Actual implementation just calls `fetchNotes()` + `fetchNoteGroups()` and reports their counts. **No local data is cleared**, no upload queue exists in the codebase. The destructive-red "清理本地并强制同步" button is misleading.

Same family as #51 (`CircleNotificationSettings` — UI promising behavior the code doesn't implement). **Defer**: needs either a real implementation or honest copy → #57.

##### 2. Pervasive hardcoded zh strings across the entire surface (#58)
Roughly **70 hardcoded Chinese strings** across 6 files: `NotesScreen` (~30), `NotesSettingsScreen` (~25), `EditNoteScreen` (~8), `NoteDetailScreen` (1), the DOM bridge (5), `note-format.ts` (units + day names). Notes is the **only feature in the codebase with zero i18n**.

Migration is substantial — every screen needs a `useTranslation` hook plumb, every string needs `t(key, { defaultValue })`, the DOM bridge needs labels passed across the bridge as props (translations can't run in WebView). **Defer**: track as #58 with the scope estimate.

##### 3. `NoteBlockEditor.tsx:68-114` — image upload has no try/catch and no re-entrancy guard
`handleImageRequest` does permission → picker → presign → upload → setPendingInsert, but the entire async chain is naked. If any step fails (presign 5xx, network drop mid-upload), the function rejects into the bridge with no UI feedback. Worse: user can tap "图" twice quickly → 2 concurrent uploads to S3.

**Patched**: added `inFlightRef` re-entrancy guard + try/catch with `Alert.alert` + `__DEV__` warn.

##### 4. `NoteDetailScreen.tsx:31-44` — silent fetchNoteDetail catch misclassifies transient errors as 404
Same family as the `InvitationVerification` / `VerificationRequest` fixes in batch 7-iv. On network failure → `loading: false` + `note: null` → renders "笔记不存在" (note doesn't exist), confusing users when the note actually does exist and they just had a timeout.

**Patched**: added `loadError` state + retry button (mirrors the MomentDetailScreen pattern).

##### 5. `EditNoteScreen.tsx:151-153` — `handleSubmit` silently swallows failures
```ts
} catch {
  setIsSubmitting(false);
}
```
User taps "完成", network fails, button re-enables — no error feedback. **Patched**: `Alert.alert` + `__DEV__` warn.

#### LOW

- **`NotesScreen.tsx:562-564, 633-640`** — Three dead buttons in the header + bottom bar (trash icon, 分享, 二维码) — `<Pressable>` with no `onPress`. Either dead UI or unfinished features. **Patched**: `Alert.alert` "敬请期待" stopgaps with comment markers so they're not silently no-op.
- **`NotesScreen.tsx:218-220, 314-317, 358-361, 339-341`** — 4 silent catches with Alert-only feedback; dev-warns missing. **Patched** — dev-warn on each.
- **`NotesScreen.tsx:268-325`** — N+1 `fetchNoteDetail` per changed note in `handleSaveGroupMemberships`. User moving 50 notes between groups = 50 round-trips. Backend should accept a bulk `groupIds` patch on `updateNote` without needing a fetch-then-patch dance. Defer → #59.
- **`NoteBlockEditor.dom.tsx:62-68`** — `serializeBlocks` runs on every keystroke (`useEditorChange`). For documents with 100+ blocks, JSON.stringify on every keystroke can be perceptible. Throttle/debounce defers; not patching.
- **`NoteBlockEditor.dom.tsx:44-52`** — malformed `initialContent` JSON silently returns `undefined` → user loses content. Dev-warn missing. **Patched**.
- **`NoteBlockEditor.tsx:132-134`** — malformed JSON from bridge silently swallowed. Dev-warn missing. **Patched**.
- **`NotesScreen.tsx:493-495, 568, 643`**, **`NoteDetailScreen.tsx:48`** — `as never` casts on `router.push` pathname. The typed routes file doesn't include `/profile/notes/...` paths. Defer to a typed-routes fix.
- **`EditNoteScreen.tsx:27-31, 52-56`** — `LogBox.ignoreLogs` + 200ms `setTimeout(router.back, 200)` are DOM bridge teardown workarounds. Already well-commented; preserve.
- **`note-format.ts:30-31`** — `days = ['星期日', '星期一', ...]` hardcoded; same family as #58.
- **`use-notes-settings-store.ts`** — no `version`/`migrate` on persist; shape change would brick stored settings. Acceptable for booleans + a number.
- **`NotesScreen.tsx:493`** — `keyExtractor={(item) => item.id}` is fine, but `<FlatList>` lacks `getItemLayout` — for users with hundreds of notes, scroll perf degrades. Defer (perf, not correctness).

#### STYLE-NIT

- **`NotesScreen.tsx` 1008 lines** — exceeds the project's 800-line guideline. Should be split:
  - `NotesScreen` (composition)
  - `NotesHeader` (title / unlisted toggle / tabs / search / stats)
  - `GroupManagerModal` (group CRUD + drag-reorder)
  - `GroupMembershipPicker` (the "为X选择要加入的笔记" view)
  Defer to dedicated DRY pass → #60.
- **`note-format.ts:48`** — `' | '` separator with Chinese `'、'` group joiner — works but not localizable.

---

## Patches applied

1. **`NoteBlockEditor.tsx`** — added `inFlightRef` re-entrancy guard on `handleImageRequest` + full try/catch with user-visible Alert + dev-warn. Also dev-warn on malformed JSON from bridge (was silently swallowed).
2. **`NoteDetailScreen.tsx`** — `loadError` state + retry button (parity with MomentDetailScreen). Removed silent catch.
3. **`EditNoteScreen.tsx`** — Alert + dev-warn on `handleSubmit` failure (was silently re-enabling the button).
4. **`NoteBlockEditor.dom.tsx`** — `console.warn` on malformed `initialContent` JSON parse failure (`__DEV__` not available in DOM bridge context, so plain `console.warn` gated by `typeof __DEV__` check).
5. **`NotesScreen.tsx`** — wired the 3 dead buttons (trash / 分享 / 二维码) to `Alert.alert` "敬请期待" stopgaps with TODO markers; added dev-warns on the 4 silent catches in `handleSaveGroup` / `handleSaveGroupMemberships` / `handleDeleteGroup` / `handleReorderGroups`.

---

## Pending decisions for this batch

| # | Severity | File · Line | Issue | Options |
|---|---|---|---|---|
| 57 | 🟡 MED | 9 | `NotesSettingsScreen.tsx:78-118` | **Phantom Feature**: "清理本地并强制同步" button only fetches + reports counts, doesn't clear local data | **A.** Implement real local clear (MMKV wipe + upload queue clear). **B.** Rewrite copy to match reality ("强制刷新计数"). **C.** Delete the button. |
| 58 | 🟡 MED | 9 | All notes screens + DOM bridge | ~70 hardcoded zh strings; Notes is the only feature with zero i18n | **A.** Migrate to `t(key, { defaultValue: zh })` pattern, plumb labels into DOM bridge via props (translations don't run in WebView). **B.** Accept zh-only for this feature. |
| 59 | 🟢 LOW | 9 | `NotesScreen.tsx:268-325` | N+1 `fetchNoteDetail` per changed note in `handleSaveGroupMemberships` | **A.** Backend accepts a partial `updateNote({ groupIds })` — no fetch needed. **B.** Bulk `updateMany` endpoint. **C.** Cap selection size. |
| 60 | 🟢 LOW | 9 | `NotesScreen.tsx` (1008 lines) | Single screen file exceeds 800-line guideline; mixes list + tabs + manager modal + drag | Split into `NotesScreen` / `NotesHeader` / `GroupManagerModal` / `GroupMembershipPicker`. |
