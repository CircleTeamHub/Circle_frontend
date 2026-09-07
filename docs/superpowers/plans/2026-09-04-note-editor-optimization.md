# Note Editor Optimization Implementation Plan

> **For Codex:** Use `subagent-driven-development` to execute each task sequentially. Apply `test-driven-development` within every implementation task and `verification-before-completion` before claiming completion.

**Goal:** Complete PM item 21 by making note media selection efficient, restricting the showcase section to videos, simplifying location semantics, and fixing the editor's media preview, responsiveness, and layout problems without changing the backend note contract.

**Architecture:** Keep the existing structured note payload (`text`, `media`, `showcase`, `location`) and centralize editor-only normalization/upload logic in small pure utilities. The UI should update once per selected batch, use bounded upload concurrency, and retain local preview URIs until save. Existing showcase images are migrated into the ordinary media section in memory and on the next save so no user data is discarded.

**Tech Stack:** Expo / React Native, Expo Router, TypeScript, Expo Image Picker, Expo Image, Zustand, Node test runner.

---

### Task 1: Add batch media selection, upload, and immediate previews

**Files:**
- Create: `src/features/notes/utils/note-media-upload.ts`
- Modify: `src/features/notes/types.ts`
- Modify: `src/features/notes/screens/EditNoteScreen.tsx`
- Modify: `src/features/notes/components/NoteBlockEditor.tsx`
- Create: `test/note-media-upload.test.js`
- Modify: `test/notes-screen.test.js`
- Modify: `test/note-block-editor.test.js`

**Steps:**

1. Write failing tests that require image and video pickers to enable multiple selection with a bounded selection limit; require upload helpers to process multiple assets with bounded concurrency, preserve input order, and report partial failures without discarding successes; require previews to prefer a local asset URI.
2. Run only the new and affected tests and confirm they fail for the expected missing behavior.
3. Add an editor media draft type with an optional UI-only `previewUri`; implement a small batch-upload helper with a conservative concurrency limit and stable ordered results.
4. Update `EditNoteScreen` to validate all selected videos, upload accepted assets in a bounded batch, append all successes in one state update, report rejected/failed counts once, and render local preview URIs immediately. Strip `previewUri` while constructing the API payload.
5. Update `NoteBlockEditor`'s standalone media picker to enable bounded multi-selection and process selected assets predictably so other callers do not retain the old one-at-a-time behavior.
6. Re-run the affected tests and confirm they pass.

### Task 2: Make showcase video-only without losing existing images

**Files:**
- Modify: `src/features/notes/utils/note-sections.ts`
- Modify: `src/features/notes/screens/EditNoteScreen.tsx`
- Modify: `test/note-media-utils.test.js`
- Modify: `test/notes-screen.test.js`

**Steps:**

1. Write failing tests proving that explicit and legacy showcase images move to the ordinary media section, showcase contains only videos, duplicates are removed, and sort order is normalized.
2. Run the focused tests and confirm the existing behavior fails those expectations.
3. Add one pure normalization function shared by section parsing and edit-screen initialization. Preserve all usable metadata while migrating images and do not duplicate media already present in the ordinary section.
4. Remove the showcase image action and enforce video-only showcase data again at save time, protecting against stale/legacy state.
5. Re-run the focused tests and confirm they pass.

### Task 3: Simplify location and restructure the editing surface

**Files:**
- Modify: `src/features/notes/screens/EditNoteScreen.tsx`
- Modify: `test/notes-screen.test.js`

**Steps:**

1. Write failing source-behavior tests requiring the section to be named “位置”, retaining map-based “选择位置” as the sole location action, removing “使用当前位置”, editable duplicate name/address fields, and raw coordinate pills, and adding a clear-location action.
2. Run the focused screen test and confirm failure.
3. Replace the two free-form location inputs with a compact read-only selected-location card. Show the resolved place name and address with explicit labels, keep map selection as the only acquisition path, and add removal. Persist the same title/address/latitude/longitude contract.
4. Refine section descriptions, spacing, media status text, disabled/loading states, and stable render callbacks so title/location edits do not cause avoidable media upload churn. Do not replace the BlockNote editor or change persisted rich-text format.
5. Re-run the focused screen tests and confirm they pass.

### Task 4: Update the PM checklist and verify the whole change

**Files:**
- Modify: `docs/pm-change-checklist.md`
- Modify: `.superpowers/sdd/progress.md`

**Steps:**

1. Mark PM item 21's four note sub-requirements complete only after their focused tests pass; keep unrelated PM items unchanged.
2. Run `node --test test/note-media-upload.test.js test/note-media-utils.test.js test/note-block-editor.test.js test/notes-screen.test.js test/note-detail-renderer.test.js test/note-location-picker.test.js`.
3. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run test:behavior`, recording any pre-existing unrelated failures separately.
4. Run `git diff --check` and inspect the final diff for accidental changes, data loss, privacy leaks, and unstable asynchronous state updates.
5. Request a fresh final code review, address all Critical/Important findings, and repeat verification before preparing the branch for integration.
