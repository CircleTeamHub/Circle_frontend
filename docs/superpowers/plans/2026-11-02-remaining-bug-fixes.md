# Remaining Reported Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix confirmed remaining frontend defects from the 23-item report and record precise questions for undefined product behavior.

**Architecture:** Keep existing Expo, chat-core, note composer and group flows. Change the shared layer responsible for each confirmed defect; preserve current QR and title changes and unrelated work.

**Tech Stack:** Expo SDK 55, React Native, React 19, TypeScript, BlockNote, Zustand, node:test and Jest.

## Global Constraints

- Bug 2 changes owned by other chats stay untouched; bug 3 was marked handled by the user.
- No new dependencies, permission bypasses, backend-contract guesses or broad refactors.
- Verify failures before each behavioral fix and run focused regression checks afterward.
- Keep native-device verification distinct from browser fixtures and mocked native tests.
- Leave commits and publication out of this implementation pass; preserve the managed working tree for review.
- Shut down temporary processes and verify their exit.

## Task 1 Restore blank-area editing for bug 4

**Files:**
- Modify: `src/features/notes/dom/NoteBlockEditor.dom.tsx`
- Diagnostic: local browser fixture for blank-area focus, scrolling and paste (not part of the application).

**Interface:** Keep all editor props and clipboard handling unchanged. Extend the existing flex layout through the scroll region, BlockNote container and actual editable element.

- [x] Reproduce the current 46px editable area within a 360px viewport and verify a lower blank tap does not focus it.
- [x] Run the same fixture with `assert.equal(metrics.blankTapFocusesEditor, true)` and observe failure.
- [x] Add the following layout rules to the corresponding existing elements:

```css
.note-editor .bn-container { flex: 1; display: flex; flex-direction: column; }
.note-editor .bn-editor { flex: 1; }
```

```tsx
// Existing editor scroll region
display: 'flex',
flexDirection: 'column',
```

- [x] Verify the actual updated DOM component layout with the blank-tap fixture and existing editor tests.

## Task 2 Chat media and message actions

**Files to inspect:** `src/features/chat/chat-detail/hooks/use-media-send.ts`, `src/features/chat/chat-detail/hooks/use-message-actions.ts`, `src/features/chat/chat-detail/hooks/use-message-renderer.tsx`, `src/features/chat/components/bubbles/image-bubble.tsx`, `src/features/chat/components/bubbles/video-bubble.tsx`.

- [x] Trace bugs 5, 7, 9, 10, 11, 12 and 23, distinguishing existing behavior from missing wiring.
- [x] Regress the confirmed video selection limit, media-save action and singleton gallery problems before modifying their shared handlers.
- [x] Reuse existing media saving, forwarding and collection operations; retain burn-after-reading restrictions.
- [x] Implement existing-contract multi-select deletion and forwarding; return unresolved sticker and pin semantics to the user.

## Task 3 Avatar synchronization and image cropping

**Files to inspect:** `src/features/contacts/screens/ContactsScreen.tsx`, `src/features/user/screens/UserProfileScreen.tsx`, `src/chat-core/`, `src/features/profile/image-picker.ts`, `src/features/discover/screens/CreateMomentScreen.tsx` and existing avatar/cover/background picker callers.

- [x] Regress bug 8 using an authoritative fetched avatar and an existing stale conversation peer.
- [x] Reconcile authoritative avatar data through the existing chat store.
- [x] Restore existing native image cropping for bug 21 with explicit aspect ratios and cancellation behavior.
- [x] Check the server contract and implement mixed pictures/videos after the user's explicit choice for bug 13.

## Task 4 Forwarding and group note information

**Files to inspect:** `src/features/chat/screens/ForwardPickerScreen.tsx`, `src/features/chat/screens/GroupLogScreen.tsx`, `src/features/chat/screens/GroupManageScreen.tsx`, `src/features/notes/screens/NoteDetailScreen.tsx` and corresponding behavior tests.

- [x] Regress bug 17 with a standalone group carrying its real `name` and `myRemark`.
- [x] Preserve the group name when building a forwarding target.
- [x] Check bugs 14, 15, 16, 18, 19 and 20 against current routes, permissions and server fields.
- [x] Preserve intentional product behavior until the user resolves ambiguous card visibility and abnormal-user definitions.
- [x] Add manager-only admission history to group logs and record actual admission joins transactionally in the isolated backend worktree.
- [x] Fix note source-state batching and older duplicated note-card synchronization.

## Task 5 Integration and status

- [x] Run TypeScript and ESLint for changed files.
- [x] Run all changed behavior and node:test suites; review the combined diff for collisions.
- [x] Record code fixes, already supported paths, native checks and unanswered questions against original bug IDs.
- [x] Confirm every temporary test and browser process has exited.

## Task 6 Follow-up regressions and fullstack moments

- [x] Regress and remove successful-note navigation waits on consumed draft PUT/DELETE requests; verify backend transactional draft consumption and session safety.
- [x] Keep blank-entry title behavior and reveal the required field when save validation fails.
- [x] Add ordered mixed moment attachments, native video upload/playback, backend ownership validation, canonical URL projection, and storage-audit references.
- [x] Add a nullable JSONB migration without applying it; preserve legacy image posts and the existing 100 MiB server video limit.
- [x] Independently review the mixed-media and remaining-fixes diffs; fix middle-item send failures, video timeout and refreshed gallery selection with regressions.

Verification: frontend typecheck and full lint passed; 134 Jest suites / 964 tests passed; full node run 3,469 passed and one unrelated Windows symlink-cleanup failure. Backend typecheck and changed-file lint passed (two existing test warnings); full Jest 5,129 passed, five unrelated Windows/Linux configuration or permission failures, 16 skipped. All four changed backend suites passed, totaling 163 tests. Native-device validation and product questions remain explicitly open in the user-facing bug record.
