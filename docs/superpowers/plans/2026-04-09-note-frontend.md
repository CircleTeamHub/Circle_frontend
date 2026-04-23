# 2026-04-09 Note Frontend

## Goal

Connect the existing profile notes entry to the new backend note APIs and deliver:

- real note list with updated time
- note detail
- create/edit note
- multiple image/video upload for notes

## Files

- Create: `/Users/yiboding/projects/circle-im/src/services/api/notes.ts`
- Create: `/Users/yiboding/projects/circle-im/src/features/notes/utils/note-format.ts`
- Create: `/Users/yiboding/projects/circle-im/src/features/notes/screens/NoteDetailScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/src/features/notes/screens/EditNoteScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/profile/notes/[id].tsx`
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/profile/notes/edit.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/NotesScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/components/NoteCard.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/types.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/upload.ts`
- Test: `/Users/yiboding/projects/circle-im/test/notes-screen.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/notes-api.test.js`

## Execution

1. Add failing tests for notes list/API/detail/edit expectations.
2. Implement note API client and upload support for `folder: 'notes'`.
3. Replace mock notes list with real API data and real routing.
4. Implement detail screen and edit screen with multi-media picker + submit flow.
5. Run:
   - `node --test /Users/yiboding/projects/circle-im/test/notes-screen.test.js /Users/yiboding/projects/circle-im/test/notes-api.test.js`
   - `npx tsc --noEmit`

