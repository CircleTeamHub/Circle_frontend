# 2026-04-09 Note Block Editor Design

## Summary

Replace the current form-style note editor with a Notion-like block editor built on `BlockNote` rendered through Expo DOM components. Keep the existing notes list, detail, upload, and MinIO infrastructure, but evolve the note data model so the server stores a primary `contentJson` block document and continues to derive list-friendly fields like `title`, `contentPreview`, and `media[]`.

The target user experience is:

- insert and edit headings, paragraphs, and bullet lists inline
- insert images and videos anywhere in the document
- preview rich content in note detail
- keep note list cards fast and simple

## Approach Options

### Option 1: `BlockNote + Expo DOM + expo-video` (recommended)

Use a DOM component for the editor and let BlockNote own the block document. Native screens handle uploads, routing, and save lifecycle. Use `expo-video` only for native detail playback and preview cards.

Pros:

- closest match to Notion-style block editing
- slash menu and block semantics already exist
- avoids building a custom block editor in pure React Native
- Expo DOM is designed for embedding web components in Expo apps

Cons:

- introduces a DOM/WebView editing surface
- requires bridging editor state between DOM and native

### Option 2: `10tap-editor` in pure React Native

Use a React Native rich text editor based on Tiptap/ProseMirror and model media as rich content nodes.

Pros:

- more native-feeling shell
- no DOM component boundary

Cons:

- less natural fit for a true Notion-like block editor
- more work to achieve slash menu, block-level insertions, and block reordering semantics

### Option 3: Keep current native form and simulate blocks manually

Build a custom array of note blocks in React Native and render/edit each block with bespoke components.

Pros:

- total product control

Cons:

- highest implementation cost
- easiest to get wrong
- duplicates behavior already solved by mature editor frameworks

## Recommended Architecture

### Editor surface

Add a DOM component dedicated to editing note block content:

- `src/features/notes/dom/NoteBlockEditor.dom.tsx`

This component owns the BlockNote editor instance and accepts:

- initial serialized document
- upload triggers for image and video insertions
- callbacks for document changes and save snapshots

Add a native wrapper component:

- `src/features/notes/components/NoteBlockEditor.tsx`

This wrapper embeds the DOM component, marshals serializable props, and exposes native actions for:

- pick image/video
- upload selected media through existing presign flow
- receive uploaded URLs back in DOM

### Native pages

Keep the existing screen split:

- list: `NotesScreen`
- detail: `NoteDetailScreen`
- edit: `EditNoteScreen`

But change `EditNoteScreen` from a form editor into a shell around the DOM editor. It should still own:

- navigation
- saving indicator
- load existing note
- load groups
- availability/pin/status metadata outside the document
- final submit

### Video handling

Use `expo-video` for:

- note detail video rendering
- optional inline preview card in native detail

Editing inside BlockNote remains document- and thumbnail-based, while full playback stays native.

## Data Model Changes

### Backend note model

Extend `Note` with:

- `contentJson Json?`

Keep existing fields:

- `title`
- `content`
- `status`
- `available`
- `pinned`
- `groupID`
- `coverMediaID`
- `imageCount`
- `videoCount`
- `mediaCount`

The meaning changes:

- `contentJson` becomes the source of truth for rich note content
- `title` becomes derived from the first heading or first meaningful text block
- `content` becomes a flattened plain-text export for compatibility and search
- `contentPreview` continues to come from derived plain text
- `NoteMedia[]` becomes the extracted media inventory from the block document

### Block schema

First iteration supports:

- heading block
- paragraph block
- bullet list block
- image block
- video block

Explicitly out of scope for first iteration:

- tables
- quotes
- embeds
- collaborative editing
- drag-and-drop block sorting

## Save Flow

### Creating/updating a note

1. User edits the document inside BlockNote.
2. DOM editor emits serialized JSON document.
3. When user inserts an image/video:
   - native side opens picker
   - uploads file to MinIO with existing presign flow
   - returns final URL/object key to DOM component
   - DOM component inserts the corresponding image/video block
4. On save, native page sends the full serialized document to backend.
5. Backend derives:
   - plain text content
   - title
   - media inventory
   - cover media
   - counts
6. Backend stores the normalized result and returns note detail.

### Migration of old notes

Old notes without `contentJson` must still open cleanly.

Edit load strategy:

- if `contentJson` exists, use it directly
- otherwise build a starter block document from:
  - note title
  - note content
  - note media array appended as image/video blocks

This avoids a bulk migration job and keeps old data editable.

## Detail Rendering

`NoteDetailScreen` should stop treating notes as “body text + separate media list” and instead render a block sequence:

- headings as large text
- paragraphs as normal body text
- bullet lists as native list rows
- images inline
- videos inline using `expo-video`

The detail renderer can be native and does not need to reuse the DOM editor.

## API Changes

### Extend existing note endpoints

Update request/response payloads for:

- `POST /note`
- `PATCH /note/:id`
- `GET /note/:id`

New payload additions:

- `contentJson`

Keep returning:

- `title`
- `content`
- `contentPreview`
- `media`
- counts
- `status`
- `available`
- `pinned`

This lets the list view continue working without understanding the entire block document.

## Error Handling

- If media upload fails, the note is not saved and the editor keeps current unsaved changes.
- If `contentJson` is malformed, backend rejects with `400`.
- If media extraction from `contentJson` fails, backend rejects instead of silently dropping media.
- If a previously uploaded media asset exists in old content but is removed from the latest document, backend replaces the note’s `NoteMedia[]` inventory to match the current document.

## Testing Strategy

### Frontend

- API tests for `contentJson` payload support
- DOM wrapper tests for message passing and serialization
- edit screen tests for loading old vs new notes
- detail rendering tests for image/video/text blocks

### Backend

- DTO validation for `contentJson`
- service tests for:
  - derive title from blocks
  - derive plain text from blocks
  - extract image/video blocks into `NoteMedia[]`
  - migrate old note content into editor payload

## Decision

Proceed with:

- `BlockNote + Expo DOM` for editing
- `expo-video` for native video playback
- existing presign + MinIO upload path for media

This gives the closest product fit with the least custom editor logic.
