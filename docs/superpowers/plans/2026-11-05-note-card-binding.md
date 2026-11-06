# Note card binding implementation plan

**Goal:** Keep saved/default note cards, list buttons, editor sections and private reader actions aligned.

**Approach:** Reuse the existing note card resolver and section builder. Fill missing cards from collection metadata in the shared card section builder, restore missing editor card blocks, and show reader group cards/avatar actions only for authenticated owned notes or a verified saved copy. Keep server ownership checks and non-owner redaction intact.

**Constraints:** No new dependencies. Preserve unrelated workspace edits. Reader body shows the group card; personal and group avatar buttons open the same chat destinations as list buttons. Shared notes remain private until added. Keep existing download action.

- [x] Add failing tests for shared card defaults and explicit-card precedence, editor restoration/save, reader visibility, avatar navigation and collection transition.
- [x] Implement shared card section defaults in `src/features/notes/utils/note-card-peers.ts`; use them in the editor, restoring only missing nonempty card blocks.
- [x] Update `src/features/notes/screens/NoteDetailScreen.tsx` to resolve the current user's note/copy, display its group card, and add circular avatar actions in the existing floating column. Strip private inline cards from uncollected reader content, including saved nested text.
- [x] Verify focused Jest and Node regressions, typecheck, lint, diff and process completion.

Run behavior tests with `npm run test:behavior -- --runInBand --roots src --cacheDirectory node_modules/.cache/jest-chat-toolbar --runTestsByPath src/features/notes/screens/NoteDetailScreen.spec.tsx src/features/notes/screens/EditNoteScreen.spec.tsx src/features/notes/utils/note-card-peers.spec.tsx`.

Verification: 207 Jest behavior tests across the changed screens, document renderer and share picker; 90 Node regression checks; typecheck and lint passed. New behavior was verified failing before implementation. Native-device visual verification was not run. Test commands exited; no development server or helper runtime was started.
