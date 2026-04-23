## Goal

Make unread friend-activity state visible in both places below:

- the contacts tab icon red dot
- the `新的朋友` quick-action row red dot inside the contacts screen

Both indicators must be driven by the same unread source so they stay in sync when friend activities are created or marked read.

## Scope

This change covers only the frontend unread-indicator experience for existing friend-activity APIs.

In scope:

- share unread friend-activity count across the contacts tab and contacts screen
- show a red dot on the `新的朋友` row when unread count is greater than zero
- keep the existing contacts-tab red dot
- refresh unread count when the app navigates through contacts and friend-activity flows
- update local unread state immediately after marking activities read from the inbox flow

Out of scope:

- backend API changes
- websocket / push-notification delivery
- redesigning the `新的朋友` list or detail screens

## Recommended Approach

Add a small shared unread state module for friend activities instead of letting each screen fetch its own unread count independently.

The shared module should expose:

- `count`
- `refresh()`
- `markRead(activityIds)`

This keeps the contacts tab red dot and the `新的朋友` row red dot consistent, and it avoids timing mismatches caused by separate requests in separate screens.

## UI Behavior

### Contacts Tab

The existing red dot on the contacts tab remains.

It should render when `count > 0`.

### Contacts Screen

The `新的朋友` quick-action row should show a red dot on the right side when `count > 0`.

The rest of the row layout and navigation behavior stay unchanged.

### New Friends Inbox

When the user opens an unread activity group from `新的朋友`, the screen should:

- mark the relevant unread activities as read
- update shared unread state immediately so both red dots disappear or decrease without waiting for a later refresh

## Data Flow

1. shared unread module fetches `/friend/activities/unread-count`
2. tab layout reads shared `count`
3. contacts screen reads the same shared `count`
4. inbox interactions call shared `markRead(activityIds)` after successful or best-effort read marking
5. screens may still call `refresh()` on focus to resync with backend state

## Error Handling

If unread-count refresh fails:

- keep the last known count if available
- avoid forcing indicators to flicker incorrectly

If mark-read requests fail for some items:

- preserve current best-effort behavior for per-item read calls
- follow with a shared `refresh()` opportunity on next focus so state can recover from partial failure

## Files Likely To Change

- `app/(tabs)/_layout.tsx`
- `src/features/contacts/screens/ContactsScreen.tsx`
- `src/features/contacts/screens/NewFriendsScreen.tsx`
- a new shared helper under `src/features/contacts/` or `src/stores/`
- `test/contacts-screen.test.js`
- optionally a focused test for the shared unread helper

## Test Plan

Add or update tests to cover:

- contacts tab reads shared unread state for its red dot
- contacts screen renders a red-dot branch for the `新的朋友` row
- inbox read flow updates shared unread state after marking activities read

## Success Criteria

- a newly received friend activity can light up both the contacts tab red dot and the `新的朋友` row red dot
- opening unread friend activity items clears the indicators without requiring a manual refresh of the contacts page
- both indicators stay visually consistent because they read from the same frontend unread state
