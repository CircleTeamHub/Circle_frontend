# Note Block Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current note form editor with a Notion-like block editor using BlockNote in Expo DOM, while keeping existing note list/detail flows and MinIO uploads.

**Architecture:** The note model keeps existing summary fields for fast list/detail rendering but adds `contentJson` as the rich-content source of truth. A DOM component hosts BlockNote, native screens handle upload/save lifecycle, and backend derives plain text and media inventory from the serialized block document.

**Tech Stack:** Expo Router, Expo DOM components, BlockNote, expo-video, existing note APIs, MinIO presigned uploads, Prisma/NestJS.

---

### Task 1: Extend note persistence for block documents

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/20260409203000_note_content_json/migration.sql`
- Modify: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/note.service.ts`
- Test: `/Users/yiboding/projects/circle_be/src/note/note.service.spec.ts`

- [ ] **Step 1: Write the failing backend tests**

Add tests for:
- create note with `contentJson`
- derive `title`
- derive plain text `content`
- derive media inventory from block document

- [ ] **Step 2: Run backend test to verify it fails**

Run: `pnpm test src/note/note.service.spec.ts --runInBand`
Expected: FAIL with missing `contentJson` handling or derived fields mismatch.

- [ ] **Step 3: Add schema and DTO support**

Implement:
- `Note.contentJson Json?`
- DTO request/response field for `contentJson`

- [ ] **Step 4: Implement derivation logic in `NoteService`**

Add helpers that:
- read heading/paragraph/list blocks
- flatten plain text
- extract image/video blocks into `NoteMedia[]`
- compute cover/counts from extracted media

- [ ] **Step 5: Re-run backend tests**

Run: `pnpm test src/note/note.service.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 6: Typecheck backend**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

### Task 2: Add contentJson to frontend note client/types

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/notes.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/types.ts`
- Test: `/Users/yiboding/projects/circle-im/test/notes-api.test.js`

- [ ] **Step 1: Write the failing frontend API test**

Add expectations that note detail/create/update can send and receive `contentJson`.

- [ ] **Step 2: Run API test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/notes-api.test.js`
Expected: FAIL because `contentJson` is missing.

- [ ] **Step 3: Add `contentJson` to note types and payload builders**

Implement `contentJson` in:
- note detail types
- create/update request body builders

- [ ] **Step 4: Re-run API test**

Run: `node --test /Users/yiboding/projects/circle-im/test/notes-api.test.js`
Expected: PASS

- [ ] **Step 5: Typecheck frontend**

Run: `npx tsc --noEmit`
Expected: PASS

### Task 3: Add DOM editor shell

**Files:**
- Create: `/Users/yiboding/projects/circle-im/src/features/notes/dom/NoteBlockEditor.dom.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/notes/components/NoteBlockEditor.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/notes/utils/note-blocks.ts`
- Test: `/Users/yiboding/projects/circle-im/test/note-block-editor.test.js`

- [ ] **Step 1: Write the failing editor-shell test**

Test for:
- initial block document passed into DOM editor
- change callback sending serialized content back
- media insertion callback contract

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/note-block-editor.test.js`
Expected: FAIL because files/components do not exist.

- [ ] **Step 3: Implement DOM editor**

Implement:
- BlockNote editor instance
- supported blocks: heading, paragraph, bullet list, image, video
- slash menu entries for those blocks

- [ ] **Step 4: Implement native wrapper**

Use Expo DOM component bridge to:
- pass initial JSON
- receive serialized updates
- trigger native media insert actions

- [ ] **Step 5: Re-run editor-shell test**

Run: `node --test /Users/yiboding/projects/circle-im/test/note-block-editor.test.js`
Expected: PASS

### Task 4: Replace form editor with block editor

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/EditNoteScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/upload.ts`
- Test: `/Users/yiboding/projects/circle-im/test/notes-screen.test.js`

- [ ] **Step 1: Write the failing screen test**

Add expectations that:
- `EditNoteScreen` renders the block editor wrapper
- old notes without `contentJson` are converted to starter blocks
- media insert still uses `folder: 'notes'`

- [ ] **Step 2: Run screen test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/notes-screen.test.js`
Expected: FAIL because current screen still uses plain `TextInput` + media grid.

- [ ] **Step 3: Replace the form UI with block-editor shell**

Keep:
- header
- save button
- group selection
- status/available controls

Replace:
- plain body inputs
- separate media grid editor

- [ ] **Step 4: Hook insert-image/video actions to current upload pipeline**

Implement:
- picker open on native side
- upload through current presign flow
- send uploaded metadata back into DOM editor as block insertions

- [ ] **Step 5: Re-run screen test**

Run: `node --test /Users/yiboding/projects/circle-im/test/notes-screen.test.js`
Expected: PASS

- [ ] **Step 6: Typecheck frontend**

Run: `npx tsc --noEmit`
Expected: PASS

### Task 5: Render block content in note detail

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/NoteDetailScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/notes/components/NoteBlockRenderer.tsx`
- Test: `/Users/yiboding/projects/circle-im/test/note-detail-renderer.test.js`

- [ ] **Step 1: Write the failing renderer test**

Add expectations for:
- heading rendering
- paragraph rendering
- bullet list rendering
- image rendering
- video rendering

- [ ] **Step 2: Run renderer test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/note-detail-renderer.test.js`
Expected: FAIL because no block renderer exists.

- [ ] **Step 3: Implement native block renderer**

Use:
- React Native text/layout for text blocks
- `expo-image` for images
- `expo-video` for inline video playback

- [ ] **Step 4: Update detail screen to prefer `contentJson`**

Fallback:
- if no `contentJson`, render old title/content/media path

- [ ] **Step 5: Re-run renderer test**

Run: `node --test /Users/yiboding/projects/circle-im/test/note-detail-renderer.test.js`
Expected: PASS

### Task 6: Install and wire `expo-video`

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/package.json`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/NoteDetailScreen.tsx`
- Test: `/Users/yiboding/projects/circle-im/test/note-detail-renderer.test.js`

- [ ] **Step 1: Add dependency**

Run: `npx expo install expo-video`

- [ ] **Step 2: Verify installation**

Run: `npm ls expo-video`
Expected: dependency present in project tree.

- [ ] **Step 3: Use `expo-video` for note video blocks**

Use:
- `useVideoPlayer`
- `VideoView`

- [ ] **Step 4: Re-run relevant frontend tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/note-detail-renderer.test.js /Users/yiboding/projects/circle-im/test/notes-screen.test.js`
Expected: PASS

- [ ] **Step 5: Typecheck frontend**

Run: `npx tsc --noEmit`
Expected: PASS

### Task 7: Documentation and verification

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/docs/frontend-api-guide.md`
- Modify: `/Users/yiboding/projects/circle-im/docs/superpowers/specs/2026-04-09-note-block-editor-design.md`
- Modify: `/Users/yiboding/projects/circle-im/docs/superpowers/plans/2026-04-09-note-block-editor.md`

- [ ] **Step 1: Document note `contentJson` API contract**

Update frontend API guide with:
- request shape
- response shape
- fallback behavior for old notes

- [ ] **Step 2: Run final backend verification**

Run: `pnpm test src/note/note.service.spec.ts --runInBand && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run final frontend verification**

Run: `node --test /Users/yiboding/projects/circle-im/test/notes-api.test.js /Users/yiboding/projects/circle-im/test/notes-screen.test.js /Users/yiboding/projects/circle-im/test/note-block-editor.test.js /Users/yiboding/projects/circle-im/test/note-detail-renderer.test.js && npx tsc --noEmit`
Expected: PASS
