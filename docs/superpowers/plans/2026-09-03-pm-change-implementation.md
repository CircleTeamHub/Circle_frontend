# PM Change Batch Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Implement and verify checklist items 1–4, 7–13, 16, 17, and 19–21 while preserving the user's existing working-tree changes.

**Architecture:** Reuse existing Expo Router screens, Zustand stores, chat-core APIs, QR sharing, notification feedback, and profile/privacy APIs. Prefer wiring already-built capabilities over introducing parallel implementations. Add narrowly scoped state only where no existing source of truth exists.

**Tech Stack:** Expo Router, React Native, TypeScript, Zustand, node:test, Jest behavior tests, i18next.

---

### Task 1: Preserve the complete PM checklist

**Files:**
- Create: `docs/pm-change-checklist.md`

1. Record all 25 normalized tasks with their original PM item numbers.
2. Mark only implemented and verified items complete.
3. Leave discussion items unchecked.

### Task 2: Registration and navigation information architecture

**Files:**
- Modify: `src/hooks/use-auth.ts`
- Modify: `src/features/contacts/screens/ContactsScreen.tsx`
- Modify: `src/features/discover/screens/DiscoverScreen.tsx`
- Create: `app/(tabs)/contacts/moments.tsx`
- Test: `test/auth-register-onboarding.test.js`
- Test: `test/contacts-circles-entry.test.js`
- Test: `test/discover-list-navigation.test.js`

1. Write failing assertions for registration bypass and the new entry placement.
2. Make new registrations enter the app directly while preserving legacy onboarding handling.
3. Move Moments and circle management entry points to Contacts and leave Plaza in Discover.
4. Run the focused tests.

### Task 3: Group categories and created-group visibility

**Files:**
- Modify: `src/features/contacts/screens/GroupsScreen.tsx`
- Reuse: `src/features/discover/store/managed-circles.ts`
- Test: `test/contacts-screen.test.js`

1. Add failing coverage for created, joined, managed, and new-group sources.
2. Fetch created, joined, and applied collections without N+1 requests.
3. Classify managed groups using `myRole` and render all four categories with honest empty states.
4. Verify created groups are never lost during deduplication.

### Task 4: Chat input and pinned-row visual consistency

**Files:**
- Modify: `src/features/chat/screens/ChatDetailScreen.tsx` only if the existing keyboard fix is incomplete.
- Modify: `src/features/messages/screens/MessagesScreen.tsx`
- Test: `test/chat-detail-screen.test.js`
- Test: `test/messages-screen.test.js`

1. Assert keyboard avoidance and a single consistent pinned-row surface color.
2. Preserve the existing keyboard-safe layout.
3. Remove theme-dependent pinned color mismatch.
4. Run focused tests.

### Task 5: Group deletion, announcement, management, and log

**Files:**
- Modify: `src/features/chat/screens/ChatInfoScreen.tsx`
- Modify: `src/features/messages/screens/MessagesScreen.tsx`
- Create/Modify: group-log route and screen only if no existing route exists.
- Test: `test/chat-core-remediation.test.js`
- Test: `test/chat-info-screen.test.js`

1. Add failing coverage for group two-sided deletion and group feature entry points.
2. Expose explicit “delete for me” and “delete for everyone” choices; rely on backend authorization.
3. Reuse the existing announcement and management implementation.
4. Add a group-log view sourced from real system messages, without fabricating backend data.
5. Run focused tests.

### Task 6: New-message feedback

**Files:**
- Verify: `src/features/notifications/hooks/use-notification-feedback.ts`
- Verify: `src/chat-core/app-badge.ts`
- Verify: `src/features/notifications/components/NotificationSnackbarHost.tsx`
- Test: `test/chat-core-remediation.test.js`
- Test: `test/notification-targeting.test.js`

1. Confirm the sound asset is played only when appropriate.
2. Confirm app icon and tab badges follow authoritative unread totals.
3. Add coverage only for gaps found during inspection.

### Task 7: Chat image preview

**Files:**
- Modify: `src/features/chat/components/bubbles/image-bubble.tsx`
- Test: `test/chat-bubble.test.js`

1. Write a failing preview interaction assertion.
2. Open the existing full-screen image viewer on tap.
3. Preserve long-press message actions and self-destruct behavior.

### Task 8: Six-hour post expiry default

**Files:**
- Modify: `src/features/social/screens/CreatePostScreen.tsx`
- Modify: `src/i18n/locales/*.json` only if a new label is required.
- Test: focused Plaza post tests.

1. Assert the initial expiry is six hours and options remain selectable.
2. Add six hours to the option list without removing manual choices.
3. Run focused tests and locale parity checks.

### Task 9: Account visibility, auto reply, and profile wording

**Files:**
- Modify: profile settings screen/store/API wiring as required.
- Modify: `src/features/profile/profile-edit-config.ts`
- Modify: `src/i18n/locales/*.json`
- Test: `test/profile-settings-screen.test.js`

1. Verify existing phone/WeChat/QQ visibility controls use the backend privacy source of truth.
2. Implement the direct-message auto-reply control only against a real setting/runtime path; do not ship a decorative toggle.
3. Preserve editable profile fields and change empty-state wording from “bind” to “fill in”.
4. Add regression coverage.

### Task 10: Add-friend QR/card sharing and tag creation

**Files:**
- Verify: `src/features/social/screens/AddFriendScreen.tsx`
- Verify: `src/features/qr/screens/QrCodeScreen.tsx`
- Modify: `src/features/contacts/screens/FriendTagsScreen.tsx`
- Test: `test/add-friend-screen.test.js`
- Test: contacts tag tests.

1. Verify QR scan and in-app personal-card sharing are reachable.
2. Write a failing assertion for list-level tag creation.
3. Add a cross-platform create-tag dialog using the existing friends API.
4. Refresh the list after successful creation and show actionable errors.

### Task 11: Appearance and chat display behavior

**Files:**
- Modify: `src/features/profile/screens/AppearanceSettingsScreen.tsx`
- Modify: `src/features/profile/store/use-app-settings-store.ts`
- Modify: `src/features/chat/store/use-chat-preferences-store.ts`
- Modify: `src/features/chat/screens/ChatDetailScreen.tsx`
- Modify: `src/features/messages/screens/MessagesScreen.tsx`
- Test: `test/profile-settings-screen.test.js`

1. Replace the obsolete “theme/language only” assertion with failing behavior contracts.
2. Add global background selection and make conversation “global” resolve to it.
3. Wire hide-avatar and consecutive-avatar merge to message rendering.
4. Add a persisted pinned fold count and apply it to the conversation list with an explicit expand control.
5. Run focused tests.

### Task 12: Full verification and checklist closeout

**Files:**
- Modify: `docs/pm-change-checklist.md`

1. Run focused tests after every change group.
2. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:behavior`, and `npm run ci`.
3. Check only the items supported by passing verification.
4. Document any backend-dependent remainder without marking it complete.
