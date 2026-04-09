# Contacts And Friends Design

## Goal

Replace the mocked contacts experience with a real friend-based contacts flow backed by the existing backend APIs.

The new experience should:

- Show real friends on the contacts tab.
- Show "新的朋友" as recently added successful friends, not pending requests.
- Show "标签" as friend tags that group friends by tag.
- Let users search another user by `accountId`, open that user's profile, and send a friend request.
- Show a clear "未找到好友" state when no matching user is found.

Out of scope for this iteration:

- 坐席
- 群聊 changes in the contacts area
- Tag creation / deletion UI
- Accept / reject friend request inbox UI

## Recommended Approach

Use separate screens for the major contact flows instead of overloading the main contacts tab.

This keeps the main contacts tab focused on browsing and discovery, while "新的朋友", "标签", and "添加好友" handle distinct tasks with their own loading and empty states.

## Screen Structure

### Contacts Tab

The contacts tab keeps the current top quick actions:

- 新的朋友
- 坐席
- 群聊
- 标签

Behavior:

- `新的朋友` navigates to a new recent friends screen.
- `标签` navigates to a new tags screen.
- `群聊` keeps the current groups screen.
- `坐席` remains a non-functional placeholder for now.

Below the quick actions, the main list shows all accepted friends grouped by first letter and sorted alphabetically.

The top-right add button navigates to the add-friend screen.

### New Friends Screen

This screen displays recently added successful friends.

Data source:

- Reuse `GET /friend`
- Sort by `friendsSince` descending

Presentation:

- Flat list of recent friends
- Show avatar, display name, account ID, and added time
- Tapping an item opens that friend's profile page

### Tags Screen

This screen displays all friend tags from `GET /friend/tags`.

Each tag row shows:

- Tag name
- Optional color marker
- Friend count under that tag

Tapping a tag opens a tag detail screen that loads `GET /friend/tags/:tagId/friends`.

### Tag Detail Screen

This screen shows the friends under one specific tag.

Presentation:

- Same row style as the contacts tab
- Alphabetical ordering for consistency

### Add Friend Screen

This screen becomes a focused account search flow instead of a static menu.

Interaction:

1. User enters an `accountId`
2. Frontend calls the user search endpoint with exact input
3. If a match is found, show a single result card
4. Tapping the result opens the user profile page
5. If no match is found, show "未找到好友"

This screen should not directly send a friend request. The send action stays on the user profile page so the profile remains the single place for relationship actions.

## Data Model Changes

Add frontend friend-domain types that mirror the backend responses:

- `FriendProfile`
- `FriendTag`
- `FriendStatus`
- `FriendRequest` only if needed for future extension

Add a contacts-specific mapping layer that derives:

- Sorted full friend list
- Recent friends list
- Letter-grouped contact sections
- Tag friend counts

Do not mix this logic into the screens directly. Keep screen components focused on rendering.

## API Integration

### Contacts List

- `GET /friend`

Used by:

- Contacts tab
- New friends screen

### Friend Tags

- `GET /friend/tags`
- `GET /friend/tags/:tagId/friends`

Used by:

- Tags screen
- Tag detail screen

### User Search

Use the user list endpoint filtered by `accountId`.

Expected request:

- `GET /user?page=1&limit=10&accountId=<input>`

Frontend behavior:

- Trim whitespace
- Avoid request on empty input
- Prefer exact `accountId` match from the returned list

### Relationship Actions

The existing user profile screen should continue using friend status and add-friend actions.

Expected backend calls:

- `GET /friend/status/:targetId`
- `POST /friend/requests`

## Sorting And Grouping Rules

### Main Contacts List

- Source: all accepted friends from `GET /friend`
- Display name priority: `nickname`
- Sort by display name
- Group by first letter
- Non-Latin / unsupported initials fall into `#`

### New Friends

- Source: all accepted friends from `GET /friend`
- Sort by `friendsSince` descending

### Tag Detail

- Source: `GET /friend/tags/:tagId/friends`
- Sort by display name

## Error Handling

### Contacts / Tags Fetch Failures

Show a page-level retry state with:

- Error text
- Retry action

### Add Friend Search

Handle three states separately:

- Empty input: guidance text
- No match: "未找到好友"
- Request failed: "搜索失败，请稍后重试"

### Friend Request Send

Keep current backend-driven messaging on the profile page.

For common statuses:

- `409`: already friends
- `400`: invalid request or duplicate pending request
- `403`: blocked relationship
- `404`: target not found

## Testing Strategy

Add focused tests for:

- Friend list grouping and recent friend sorting logic
- Contacts screen using real friend-driven sections instead of mocks
- Add-friend screen exact account search and empty/not-found states
- Tags screen using backend tag data
- Tag detail screen loading tagged friends

Prefer small mapper tests plus a few screen-structure tests that assert route wiring and major UI branches.

## File Impact

Expected frontend files to add or update:

- `src/features/contacts/screens/ContactsScreen.tsx`
- `src/features/social/screens/AddFriendScreen.tsx`
- `src/features/user/screens/UserProfileScreen.tsx`
- `src/features/contacts/*` new API/mapping/types helpers
- `app/(tabs)/contacts/*` new routes for recent friends and tags
- `src/services/api/*` friend/user search helpers if not already present
- `test/*` contact and friend flow coverage

## Risks

- User search may currently return partial matches, so the frontend must choose an exact `accountId` match when available.
- The backend friend list does not include tag memberships directly, so tag counts require separate requests.
- Existing profile navigation is reused across tabs, so route params and profile scope behavior must stay consistent.

## Implementation Outline

1. Add typed API helpers and mappers for friends, tags, and user search.
2. Replace mocked contacts screen data with backend-backed friend data.
3. Add recent friends and tag list/detail screens.
4. Replace add-friend placeholder screen with real account search.
5. Reuse user profile page for send-friend-request flow.
6. Add mapper and screen tests.
