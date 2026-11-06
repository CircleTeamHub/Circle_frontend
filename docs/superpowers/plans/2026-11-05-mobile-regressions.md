# Mobile regression fixes implementation plan

> **For agentic workers:** Use subagent-driven-development for independent task domains and review each result before final verification.

**Goal:** Fix the reported chat, contacts, moments, notes, collections and points-transfer regressions and credit the identified test account if an authorized backend route is available.

**Architecture:** Reuse existing image caching, profile caches, group caches, message mappers and media viewers. Preserve the working tree's pre-existing changes; do not commit unrelated work or create new dependencies.

**Tech Stack:** Expo / React Native, TypeScript, Zustand, expo-image, expo-video, Node tests and Jest behavior tests.

## Global constraints

- Preserve all pre-existing uncommitted changes.
- Keep fixes local and minimal; validate external data once at the boundary.
- Keep caches scoped to the signed-in account and preserve disappearing-media privacy.
- Do not mock credit balances or add a client-only recharge feature.
- Stop and verify temporary processes started for this task after use.

### Task 1: Notes and collections

Files: note collection source/sheets, message-collection mapping, collection-content, CollectionsScreen, SharePickerScreen and their existing tests.

- [x] Trace duplicate-note import, collection parsing, typed resend and collections back navigation.
- [x] Add focused failing behavior tests for duplicate feedback and sending a saved image as an image.
- [x] Fix the shared mapping and duplicate result handling; use compact preview rows in both collection views and a valid fallback route on exit.
- [x] Run the affected Node and Jest tests; report root causes, changed files and command results.

### Task 2: Contacts and moments

Files: NewFriendsScreen, user/profile-cache, EditFriendRemarkScreen, EditFriendTagsScreen, EditFriendPermissionScreen, UserMomentsScreen, moment-album-header, use-change-cover and existing tests.

- [x] Reproduce the new-friends stuck spinner and cache misses in profile child screens and moments.
- [x] Add failing tests for request completion after remount, cached editor values and cached moment identity/cover.
- [x] Reuse account-scoped profile cache, avoid clearing already-known cover/avatar, update cached covers after changes and keep nicknames within the header bounds.
- [x] Run focused tests and report evidence.

### Task 3: Group and conversation entry

Files: ChatInfoScreen and group cache, MessagesScreen/bootstrap, AssistantChatScreen/chat receipt display and messages header components, plus focused tests.

- [x] Trace group member loading, initial conversation hydration, AI read receipts and header icons.
- [x] Add failing tests for cached group entry, startup loading state and AI receipt suppression.
- [x] Warm/reuse group members using existing state, show cached conversations or loading until first hydration finishes, remove AI read/unread UI and unify header stroke weights.
- [x] Run focused tests and report evidence.

### Task 4: Media, timeline and transfer

Files: Avatar, chat image/video bubbles, chat timeline/message area, shared video/media components and TransferComposerScreen.

- [x] Trace image cache policy and transitions, video preview/fullscreen behavior, progress callbacks and inverted timeline offsets.
- [x] Add failing behavior tests for progress, video opening and jump-to-latest behavior where business logic changes.
- [x] Enable memory/disk image caching while retaining ephemeral policy, show centered media progress and central video play affordances, add jump-to-latest button and fix clipped transfer input metrics.
- [x] Run focused tests and inspect the final diff.

### Task 5: Recharge and final verification

- [x] Resolve the user's test account and the existing authorized recharge path; credit exactly 1000 once and verify the server result if access is available.
- [x] Review task changes for correctness and scope, then run typecheck, lint, Node tests and behavior tests.
- [x] Record any environment/device-only verification gaps and shut down temporary processes.

## Verification outcome

- TypeScript, Expo public config, ESLint and diff whitespace checks passed.
- Full Node suite: 3567 passed, 30 existing skips, 0 failed (Git Bash outside sandbox).
- Full behavior suite: 181 suites, 1552 tests passed, 0 failed.
- Task reviews and final cross-task production review found no concrete P1/P2 issues.
- Account 144442 credited exactly 1000; verified server wallet balance 1000 and matching RECHARGE ledger.
- All task test and recharge subprocesses exited. No app release was published.
- Native screenshots/playback and the reported collections exit symptom need verification with a new device build; current lifecycle tests pass.
