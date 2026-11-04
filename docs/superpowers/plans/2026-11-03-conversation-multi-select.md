# Conversation Multi-select Implementation Plan

**Goal:** Restore the message-header double check as an entry to multi-select chats, then mark selected chats read or delete the user's selected chat histories.

**Architecture:** Extend the existing MessagesScreen and memoized conversation rows. Reuse markConversationRead, clearChatConversationHistory and updateChatConversationPreferences; no new dependency or backend endpoint. Preserve normal navigation, swipe menus and pinned layout outside selection mode.

**Tech Stack:** React Native, TypeScript, Zustand, existing chat-core APIs, Jest/RNTL and five existing locale JSON files.

## Implementation and verification

- [x] Replace the header-removal test with selection-mode behavior tests in `src/features/messages/screens/MessagesScreen.spec.tsx`: select/cancel/all, selected-only latest-height read, confirmed personal deletion, partial failure, duplicate submission and account changes. Run and confirm failure before implementation.
- [x] In `MessagesScreen.tsx`, track a nullable set of selected IDs, show row checkboxes, disable row navigation/swipe/context menus in selection mode, expand folded pinned rows, and clear selection when filters/accounts change. Add select-all/cancel controls and a footer above the floating navigation bar. Android Back exits selection.
- [x] Mark read using existing reliable read-watermark queue. Delete sequentially with `{ forEveryone: false }`, then hide the conversation. Confirm the count first, stop across account changes/unmount, disable controls in flight, retain failures selected and report a count without identifiers. Never exercise deletion against the user's real records during verification.
- [x] Add seven selection/confirmation/failure strings to en/es/ja/ko/zh. Preserve the existing single-chat deletion behavior.
- [x] Run relevant MessagesScreen behavior/static checks, TypeScript and changed-file ESLint. Inspect the resulting diff.
- [x] Build the existing standalone Android test variant, inspect the embedded source and install it on the authorized USB device. Clean up owned tool processes. Physical selection UI may be inspected without executing read/delete actions.

## Verification results

- MessagesScreen behavior: 14 tests passed. Message-list and locale checks: 44 passed. TypeScript and changed-file ESLint passed.
- Final standalone Android build passed and was installed successfully. Embedded source-map checks confirmed the selection entry, read action, personal-history deletion, confirmation and partial-failure handling.
- Android 16 physical device (904 × 2316): entry, checking a row and cancel passed; toolbar is above the floating navigation. Android Back also exited selection correctly. Selection controls use a fixed header outside the list so the native sticky wrapper cannot obscure them.
- Control-only screenshot: `test-results/message-selection-qa/selection-controls.png` (conversation rows omitted). Read and delete data operations were verified with test fixtures, not the signed-in user’s records.
