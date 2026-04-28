# 2026-04-24 Tab Badge Realtime Design

## Summary

Introduce a unified real-time tab-badge system for the app.

The goal is to stop driving tab red dots from route changes and instead drive them from event sources that match each domain:

- OpenIM events for chat/message unread state
- backend WebSocket events for product-domain unread state such as friend requests, circle activity, and system notifications
- HTTP only as a fallback for bootstrap, app foreground recovery, and socket reconnect recovery

This design keeps the tab bar responsive in real time while reducing unnecessary polling pressure on endpoints like `/api/v1/friend/activities/unread-count`.

## Problem

The current `contacts` tab unread dot is refreshed in `app/(tabs)/_layout.tsx` whenever `segments` changes. That means the app issues unread-count requests on many route transitions that are unrelated to actual unread-state changes.

Current issues:

- route-driven refresh is not truly real time
- request volume grows with navigation frequency, not with unread-state changes
- the pattern does not scale to future badge sources such as unread moments, system notices, or wallet/order notifications
- the tab bar currently has no single source of truth for cross-domain badge counts

## Goals

- show tab red dots in near real time
- support multiple unread domains under one shared tab-badge model
- avoid request-per-navigation behavior
- separate IM-domain unread state from business-domain unread state
- provide deterministic recovery after reconnect, app foreground, or missed events

## Non-Goals

- building a full notification center UI in this phase
- replacing existing message rendering or conversation list logic
- adding push notifications in this document
- defining server storage schemas for every future unread domain in detail

## Recommended Approach

### Option 1: Unified badge store with event-driven updates and HTTP fallback (recommended)

Use a single frontend store for tab badges.

Feed it from:

- OpenIM listeners for message-domain unread changes
- backend WebSocket events for friend activity, circle activity, and system notifications
- HTTP fallback refresh on bootstrap, app foreground, and reconnect

Pros:

- matches the product need for real-time red dots
- avoids route-driven request spam
- cleanly separates IM and business responsibilities
- easy to extend when more unread domains are added

Cons:

- requires backend WebSocket work for business events
- requires a small badge aggregation layer in frontend

### Option 2: Poll unread-count endpoints on an interval

Refresh all badge counts every N seconds.

Pros:

- simpler initial implementation

Cons:

- wastes requests when nothing changes
- still not truly real time
- becomes expensive as more badge categories are added

### Option 3: Let each tab own its own badge refresh logic

Each tab or screen refreshes its own unread count independently.

Pros:

- low initial coordination

Cons:

- duplicated logic
- inconsistent update timing
- hard to debug and scale

## Architecture

### Frontend Source of Truth

Add a single `tabBadgeStore`.

Recommended shape:

```ts
type TabBadgeState = {
  messagesUnread: number;
  contactsUnread: number;
  discoverUnread: number;
  profileUnread: number;
  isRealtimeConnected: boolean;
  lastSyncedAt: number | null;
};
```

Derived display rules:

- a tab shows a red dot when its unread value is greater than 0
- a tab may later show a numeric badge if product wants that, but this design only requires the red dot
- the tab bar never calls unread APIs directly

### Event Sources

#### OpenIM-owned

OpenIM remains the source of truth for:

- total unread messages
- conversation unread changes
- new incoming messages
- read-state changes

The frontend should continue listening to:

- `onTotalUnreadMessageCountChanged`

That event updates:

- `tabBadgeStore.messagesUnread`

#### Backend WebSocket-owned

The app backend becomes the source of truth for business unread state:

- friend activities
- circle activity
- system notifications
- future order/payment/member events that should affect badges

That socket updates:

- `tabBadgeStore.contactsUnread`
- `tabBadgeStore.discoverUnread`
- `tabBadgeStore.profileUnread`

### Transport Split

#### OpenIM transport

Use existing OpenIM SDK listeners for chat-domain events.

#### App backend transport

Add a dedicated app WebSocket connection for business events.

Recommended channel types:

- authenticated websocket session scoped to current user
- room or subscription keyed by `userId`

The app backend should not try to tunnel these business events through OpenIM.

## Badge Domain Ownership

### `messages` tab

Owned by OpenIM.

Includes:

- unread direct messages
- unread group messages

Does not include:

- friend request unread
- circle activity unread

### `contacts` tab

Owned by backend business events.

Includes:

- unread friend requests
- unread friend-activity items

Primary count source:

- backend WebSocket event

Fallback HTTP:

- `/api/v1/friend/activities/unread-count`

### `discover` tab

Owned by backend business events.

Includes:

- unread circle activity
- unread mentions in circle content
- unread replies/comments for discover-scope content

Fallback HTTP:

- `/api/v1/circle/activities/unread-count`

### `profile` tab

Reserved for product-domain unread items that belong to the user center.

Potential examples:

- system notices
- membership state changes
- wallet/order completion notices

This tab can remain `0` until a concrete unread source is added.

## WebSocket Event Contract

Use explicit domain events instead of one opaque "badge changed" string.

### Event 1: friend activity unread changed

Event name:

```txt
friend.activity.unread.changed
```

Payload:

```json
{
  "count": 3,
  "changedAt": "2026-04-24T03:00:00.000Z"
}
```

Frontend action:

- set `tabBadgeStore.contactsUnread = count`

### Event 2: circle activity unread changed

Event name:

```txt
circle.activity.unread.changed
```

Payload:

```json
{
  "count": 5,
  "changedAt": "2026-04-24T03:00:00.000Z"
}
```

Frontend action:

- set `tabBadgeStore.discoverUnread = count`

### Event 3: system notification unread changed

Event name:

```txt
system.notification.unread.changed
```

Payload:

```json
{
  "count": 1,
  "changedAt": "2026-04-24T03:00:00.000Z"
}
```

Frontend action:

- set `tabBadgeStore.profileUnread = count`

### Event 4: unread snapshot

This is the safest recovery event for initial connect and reconnect.

Event name:

```txt
badge.snapshot
```

Payload:

```json
{
  "messagesUnread": 12,
  "contactsUnread": 3,
  "discoverUnread": 5,
  "profileUnread": 1,
  "syncedAt": "2026-04-24T03:00:00.000Z"
}
```

Frontend action:

- overwrite current business counts from the snapshot
- keep `messagesUnread` driven by OpenIM after initial sync if OpenIM is already connected

Recommendation:

- emit this snapshot immediately after socket authentication succeeds

## Backend Responsibilities

### HTTP fallback endpoints

Keep or add count endpoints for recovery usage:

- `GET /friend/activities/unread-count`
- `GET /circle/activities/unread-count`
- `GET /notifications/unread-count` if profile-domain unread is added

These endpoints remain useful, but they should no longer be bound to navigation changes.

### WebSocket gateway

Add a backend gateway responsible for:

- authenticating the user
- binding the socket to the current user
- emitting `badge.snapshot` on connect
- pushing domain unread updates when business state changes

### Emit triggers

Backend should emit unread-change events when:

- a friend request or friend-activity record becomes unread
- a friend-activity item is marked read
- a circle activity item becomes unread
- a circle activity item is marked read
- a system-notification item becomes unread or read

### Delivery semantics

WebSocket events should be treated as state updates, not append-only deltas.

Recommendation:

- emit the latest count, not `+1` / `-1`

Why:

- avoids drift when a client misses an event
- easier reconnect behavior
- easier debugging

## Frontend Responsibilities

### `tabBadgeStore`

The store should expose:

- setters for each unread domain
- a `hydrateFromSnapshot()` action
- a `refreshFallbackCounts()` action for HTTP recovery
- a `reset()` action on logout

### OpenIM listeners

Keep `onTotalUnreadMessageCountChanged` as the primary source for message unread.

That listener should update only:

- `messagesUnread`

It should not attempt to refresh friend or circle badge counts.

### Backend WebSocket client

Add a socket client module that:

- connects after auth/session bootstrap
- authenticates with current access token
- listens for `badge.snapshot`
- listens for unread-change events by domain
- marks `isRealtimeConnected`

### Tab layout

`app/(tabs)/_layout.tsx` should read only from `tabBadgeStore`.

It should not trigger unread HTTP requests on `segments` changes.

## Recovery Strategy

Real-time systems still need recovery paths.

### On app bootstrap

- connect OpenIM
- connect backend WebSocket
- request or receive `badge.snapshot`
- run one HTTP fallback refresh only if socket bootstrap fails

### On app foreground

- if backend socket is disconnected, reconnect
- run fallback unread refresh once after reconnect attempt

### On socket reconnect

- backend emits `badge.snapshot`
- frontend overwrites badge counts from snapshot

### On logout

- clear `tabBadgeStore`
- disconnect backend socket
- logout from OpenIM

## Why `/friend/activities/unread-count` Exists Today

The current requests are coming from `app/(tabs)/_layout.tsx`, where unread friend-activity count is refreshed whenever `segments` changes.

That was acceptable as a temporary implementation, but it is not the right long-term model for a real-time badge system.

The endpoint should stay as a fallback source, not the primary update mechanism.

## Rollout Plan

### Phase 1

- add `tabBadgeStore`
- move tab bar badge rendering to that store
- keep OpenIM for messages
- remove route-driven unread refresh in tab layout
- keep HTTP fallback only for startup and reconnect

### Phase 2

- add backend WebSocket gateway
- emit `badge.snapshot`
- emit unread-change events for friend activities
- wire `contactsUnread` to backend socket

### Phase 3

- add circle-activity unread events
- wire `discoverUnread`

### Phase 4

- add profile/system unread events if product needs them

## Testing

### Frontend

- tab bar updates when `messagesUnread` changes from OpenIM events
- tab bar updates when `contactsUnread` changes from backend socket
- tab bar updates when `discoverUnread` changes from backend socket
- logout clears all badge state
- reconnect snapshot overwrites stale local counts

### Backend

- socket auth binds unread events to the correct user
- friend unread create/read flows emit the latest count
- circle unread create/read flows emit the latest count
- snapshot emits correct aggregated values on connect

### Integration

- receiving a new message updates `messages` tab without HTTP
- receiving a new friend request updates `contacts` tab without route change
- receiving a new circle event updates `discover` tab without route change

## Recommendation

Implement the unified event-driven badge architecture now, but do it in layers:

1. create `tabBadgeStore`
2. stop route-driven polling from `app/(tabs)/_layout.tsx`
3. preserve OpenIM as the message-domain source
4. add backend WebSocket unread events for business domains
5. keep unread-count HTTP endpoints as recovery-only fallbacks

This gives the app true real-time tab reminders without turning navigation into an accidental polling loop.
