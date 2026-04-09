# Friend Activities Design

## Goal

Replace the current "新的朋友" concept with a complete friend-activity inbox that supports:

- incoming friend requests
- outgoing friend requests
- acceptance and rejection events on both sides
- withdrawal events
- per-item unread state
- a contacts-tab red dot driven by unread friend activities

This design supersedes the earlier "recent successful friends" interpretation for the `新的朋友` entry.

## Product Definition

`新的朋友` is no longer a "recently added friends" list.

It becomes a dedicated friend-activity inbox that records the full lifecycle of friend requests and related decisions.

The inbox must include all of these activity types:

1. received friend request
2. sent friend request
3. other user accepted my request
4. other user rejected my request
5. I accepted another user's request
6. I rejected another user's request
7. other user withdrew a request

## Core Interaction Rules

### Unread Model

Unread state is tracked per activity item, not per page.

An activity becomes read only when the user explicitly taps that activity card or enters that activity detail page.

Scrolling the list or opening the inbox page does not mark items as read.

### Red Dot

The contacts tab shows a red dot whenever there is at least one unread friend activity.

The red dot is not based on whether the inbox has items. It is based only on unread state.

Handled activities remain in the inbox. Accepting or rejecting a request does not remove the related activity items.

### Request Handling

Pending incoming requests are handled from a dedicated detail page, not inline in the list.

Tapping an activity should:

1. mark that specific activity as read
2. open the corresponding detail page

The detail page then shows the relevant action state:

- pending incoming request: accept / reject
- pending outgoing request: view status, optionally cancel later if supported
- already accepted / rejected / withdrawn event: read-only event detail

## Recommended Architecture

Use a separate friend-activity notification model instead of trying to encode all notification history directly in the current friendship/request record.

Keep these concerns separate:

- friendship/request record: current relationship state
- friend activity record: immutable historical event and unread state

This is the cleanest model for an inbox that must preserve handled items and independently track read/unread state.

## Data Model

### Existing Record

The existing friend/request record continues to represent the relationship and current request state.

It remains responsible for:

- sender
- recipient
- current request state
- current friendship status

### New Record: Friend Activity

Add a dedicated `friend_activity` model.

Suggested fields:

- `id`
- `requestId`
- `actorId`
- `viewerId`
- `counterpartyId`
- `type`
- `messageSnapshot`
- `readAt`
- `createdAt`

Field meaning:

- `requestId`: the underlying friend request / friendship record this activity belongs to
- `actorId`: who caused the event
- `viewerId`: the user who owns this inbox entry
- `counterpartyId`: the other person shown in the UI
- `type`: event type enum
- `messageSnapshot`: optional copy of request message if useful for detail rendering
- `readAt`: null until the owner explicitly opens or taps the item

### Activity Type Enum

Use explicit event types instead of trying to infer meaning from state transitions in the UI.

Suggested enum values:

- `REQUEST_RECEIVED`
- `REQUEST_SENT`
- `REQUEST_ACCEPTED_BY_OTHER`
- `REQUEST_REJECTED_BY_OTHER`
- `REQUEST_ACCEPTED_BY_ME`
- `REQUEST_REJECTED_BY_ME`
- `REQUEST_WITHDRAWN_BY_OTHER`

## Activity Creation Rules

Each meaningful request lifecycle event should create one or two friend-activity rows depending on who needs to see it.

### Send Request

When A sends a request to B:

- create `REQUEST_SENT` for A
- create `REQUEST_RECEIVED` for B

### Accept Request

When B accepts A's request:

- create `REQUEST_ACCEPTED_BY_ME` for B
- create `REQUEST_ACCEPTED_BY_OTHER` for A

### Reject Request

When B rejects A's request:

- create `REQUEST_REJECTED_BY_ME` for B
- create `REQUEST_REJECTED_BY_OTHER` for A

### Withdraw Request

When A withdraws a pending request previously sent to B:

- create `REQUEST_WITHDRAWN_BY_OTHER` for B
- optionally create a local event for A only if product later wants a visible self-history item

For this iteration, only the recipient-side withdrawn notification is required because that is the user-facing event explicitly requested.

## Backend API Design

### Friend Activity List

Add:

```http
GET /friend/activities
Authorization: Bearer <accessToken>
```

Returns the current user's friend activities ordered by `createdAt DESC`.

Each item should include:

- activity id
- type
- readAt
- createdAt
- requestId
- optional message snapshot
- counterparty public profile
- current request state if relevant for detail rendering

### Unread Count

Add:

```http
GET /friend/activities/unread-count
Authorization: Bearer <accessToken>
```

Returns:

```json
{ "count": 3 }
```

This endpoint powers the contacts-tab red dot.

### Mark Single Activity As Read

Add:

```http
POST /friend/activities/:activityId/read
Authorization: Bearer <accessToken>
```

Marks exactly one activity as read.

Do not provide a bulk "mark all as read" endpoint in this iteration because it contradicts the requested interaction model.

### Friend Activity Detail

Add either:

```http
GET /friend/activities/:activityId
```

or return enough information in the list item that the detail page can be rendered without a dedicated detail endpoint.

Recommended approach: add the detail endpoint, because the page will need:

- current request state
- original request message
- actor/counterparty profile
- action availability

### Existing Request Handling APIs To Reuse

Continue using:

- `POST /friend/requests`
- `POST /friend/requests/:requestId/accept`
- `POST /friend/requests/:requestId/reject`
- `DELETE /friend/requests/:requestId`

These state transitions must now also generate friend-activity records.

## Frontend Structure

### New Friends Screen

Repurpose the current `NewFriendsScreen` into a friend-activity inbox.

List behavior:

- time-descending feed
- each card shows avatar, display name, event copy, timestamp, unread dot
- tapping a card marks only that card as read
- tapping a card opens the activity detail screen

This page no longer fetches `GET /friend`.

It fetches `GET /friend/activities`.

### Friend Activity Detail Screen

Add a dedicated detail page for one friend activity.

This page handles all detail interaction paths:

- pending incoming request: show accept / reject actions
- sent request pending: show request info and waiting state
- accepted or rejected event: show read-only status summary
- withdrawn event: show read-only withdrawn summary

If the activity corresponds to an already accepted relationship, the page can also offer "查看资料" or "发起聊天" as secondary actions later.

### Contacts Tab Red Dot

The contacts tab should fetch unread friend-activity count and display a red dot when `count > 0`.

This belongs in the tabs layout because the badge is global navigation state, not screen-local state.

Recommended behavior:

- fetch unread count when the tab layout mounts
- refresh when returning focus to the app or when the contacts stack becomes active
- invalidate after marking an item as read or handling a request

## UI Content Model

### Activity Copy

Map event types to explicit user-facing copy.

Suggested copy:

- `REQUEST_RECEIVED`: `{name} 请求添加你为好友`
- `REQUEST_SENT`: `你已向 {name} 发送好友申请`
- `REQUEST_ACCEPTED_BY_OTHER`: `{name} 通过了你的好友申请`
- `REQUEST_REJECTED_BY_OTHER`: `{name} 拒绝了你的好友申请`
- `REQUEST_ACCEPTED_BY_ME`: `你已通过 {name} 的好友申请`
- `REQUEST_REJECTED_BY_ME`: `你已拒绝 {name} 的好友申请`
- `REQUEST_WITHDRAWN_BY_OTHER`: `{name} 撤回了好友申请`

### Detail States

Pending incoming request detail should show:

- counterparty profile
- request message
- request time
- `接受`
- `拒绝`

Read-only activity detail should show:

- counterparty profile
- event summary
- event time
- current outcome status

## Error Handling

### Inbox List

If `GET /friend/activities` fails:

- show page-level error
- provide retry

### Red Dot

If unread-count fetch fails:

- do not show an incorrect count
- fall back to no badge until the next successful refresh

### Detail Page

If activity detail fetch fails:

- show page-level retry state

### Accept / Reject Actions

If request handling fails:

- keep the user on the detail page
- show backend message when available
- do not optimistically fabricate success

## Testing Strategy

### Backend

Add tests for:

- activity creation on send / accept / reject / withdraw
- unread-count correctness
- single-item read behavior
- detail visibility limited to inbox owner

### Frontend Pure Logic

Add tests for:

- event-type-to-copy mapping
- unread-dot visibility logic
- detail action availability by activity type and request state

### Frontend Screens

Add tests for:

- new-friends inbox screen reads `friend/activities`
- tapping a card marks only one activity as read
- contacts-tab red dot responds to unread-count
- detail page renders pending and read-only variants correctly

## Migration Impact

This feature invalidates the previous assumption that "新的朋友" is just a sorted friend list.

The current frontend files that must be reworked:

- `src/features/contacts/screens/NewFriendsScreen.tsx`
- contacts tab badge logic in `app/(tabs)/_layout.tsx`
- friend API helpers in `src/services/api/friends.ts`

Likely new frontend files:

- `src/features/contacts/friend-activities.ts`
- `src/features/contacts/screens/FriendActivityDetailScreen.tsx`
- route file for the activity detail screen

Likely backend impact:

- friend schema / migration
- friend service event creation
- friend activity controller/service methods
- API guide update

## Recommendation

Implement this as a proper friend-activity subsystem, not as a quick patch on top of the accepted-friends list.

That gives you:

- durable inbox history
- correct unread semantics
- a reliable contacts-tab red dot
- room for future notification expansion without reworking the friendship model again
