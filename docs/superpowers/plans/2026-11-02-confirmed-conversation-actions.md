# Confirmed Conversation Actions Implementation Plan

> **For agentic workers:** Use the existing isolated worktrees; execute this scoped task inline with regression tests and review. Steps use checkbox syntax for tracking.

**Goal:** Remove the messages header bulk-read button and expose mark-read/delete on long press of each conversation, as confirmed by the user.

**Architecture:** Keep the current conversation row, swipe preferences, deletion confirmation and socket read-watermark implementation. Add a stable per-row callback that looks up the latest DTO when invoked. Keep existing pin/mute actions and desktop context menu.

**Tech Stack:** React Native / Expo Router, TypeScript, Jest / React Native Testing Library and node:test.

## Global Constraints

- Preserve all earlier uncommitted bug fixes. No commit, publication or database migration in this task.
- Read/delete targets only the selected conversation; preserve existing deletion confirmation and authorization semantics.
- Reuse the existing localized `messages.swipeMarkRead` text.
- Do not add whole-list dependencies to row callbacks.
- Verify and shut down temporary tool processes.

## Task 1 Conversation menu behavior

**Files:**
- Modify: `src/features/messages/screens/MessagesScreen.tsx`
- Create: `src/features/messages/screens/MessagesScreen.spec.tsx`
- Update obsolete assertion: `test/messages-screen.test.js`

**Interface:** Add `markRead: string` to the row labels and `onMarkRead(conversation: Conversation): void` to the row props; send reads through existing `markConversationRead(id, latestHeight)`.

- [x] Render the actual screen with two DTOs and assert no header double-check icon.
- [x] Long-press a native conversation row; invoke its read action and assert only that conversation's latest height is acknowledged without navigation.
- [x] Mutate the mocked store height after opening the menu; confirm invocation uses the fresh height.
- [x] Exercise delete from the same menu; confirm it opens the existing confirmation and does not mutate chat history before confirmation.
- [x] Verify the long-press path also works in desktop split layout.
- [x] Run the new Jest suite and observe failures caused by the missing native menu/read action and existing header button.
- [x] Add the row action and callback, enable long press across layouts, remove the header button and obsolete bulk-read callback/ref.
- [x] Update the node performance contract to check the new stable callback instead of the removed one.
- [x] Run focused Jest, node:test, typecheck, lint and diff checks; review the focused diff.

Verification: 5/5 new behavior tests and 24/24 existing node tests pass; full frontend typecheck and scoped ESLint pass. Independent scoped production review found no actionable P1/P2. Test and review command processes exited.

## Integration with other confirmed requests

- Group opt-in and synced custom stickers have separate agent-owned plans and files. Parent owns locale JSON and final status record.
- Bug 5 receives read-only route/media investigation; do not invent a separate seat profile page or claim a native fix without reproducing the symptom.
