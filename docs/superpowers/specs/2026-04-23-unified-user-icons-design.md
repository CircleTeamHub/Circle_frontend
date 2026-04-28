# 2026-04-23 Unified User Icons Design

## Summary

Introduce a unified user-icon system that treats VIP, newcomer, and circle icons as the same display entity.

Circle owners can configure a current icon for their circle by either selecting from built-in assets or uploading a custom image. Users can then choose which eligible icons to display from a single icon-management screen. The same chosen icons appear consistently in the profile gold card, the user profile page, and chat profile cards.

The design avoids splitting "system icons" and "circle icons" into separate rendering pipelines. Eligibility is computed by the backend, while visibility and order are controlled by the user. A user can display at most 5 icons at the same time.

## Approach Options

### Option 1: Unified user display-icon system (recommended)

Model VIP, newcomer, and circle icons as one display system with one options endpoint and one selection endpoint.

Pros:

- matches the approved product behavior exactly
- keeps all display surfaces on one shared data contract
- makes the 5-icon limit, ordering, and hide/show rules straightforward
- lets circle icon changes propagate automatically without per-user rewrites

Cons:

- requires new schema and API work across both frontend and backend
- needs careful eligibility validation on writes

### Option 2: Separate system-icon and circle-icon pipelines, merge in frontend

Keep system icons and circle icons in different backend models, then combine them during rendering.

Pros:

- may reuse more existing logic at first glance

Cons:

- duplicates selection and ordering logic
- complicates the shared 5-icon limit
- increases drift risk across profile, user page, and chat-card surfaces

### Option 3: Compute icons dynamically without storing display choices

Always derive icons from current user state and joined circles, without persisting which ones the user wants visible.

Pros:

- lowest backend write complexity

Cons:

- directly conflicts with the approved requirement that users can show or hide every icon manually
- cannot support stable user-defined ordering

## Scope

In scope:

- built-in icon assets for system-defined icons
- circle-owner selection of the current circle icon
- circle-owner custom icon upload
- user icon-management page with add, hide, and reorder behavior
- a unified `displayIcons` contract shared by profile gold card, user profile page, and chat profile cards
- service-side enforcement of the 5-icon display limit
- automatic cleanup when users lose eligibility for an icon

Out of scope:

- icon moderation and review workflows
- animated icon formats
- per-surface custom icon ordering
- multiple active icons per circle
- gifting, trading, or selling icons

## Product Rules

### Unified icon concept

All visible user icons are the same product concept. The system distinguishes them only by source.

Supported sources in this iteration:

- `SYSTEM`: VIP, newcomer
- `CIRCLE`: the current active icon of a circle the user has joined

### Ownership and control

Rules:

- the system determines whether a user is eligible to use an icon
- the user decides whether to display or hide an eligible icon
- the user can reorder displayed icons
- a user can display at most 5 icons at the same time
- the same chosen order is used everywhere the app renders user icons

### Circle icon rules

Rules:

- each circle has at most one active icon at a time
- only the circle owner can change the active circle icon
- the owner can either pick a built-in icon or upload a new custom image
- members do not own a static copy of the icon image; they reference the circle's current icon
- if a circle owner changes the circle icon, members who display that circle icon automatically show the new asset

### Eligibility rules

#### VIP icon

- available when `user.vipLevel > 0`
- label should reflect the actual current level, for example `VIP5`
- users may show or hide it manually

#### Newcomer icon

- available during the user's first 30 days after account creation
- users may show or hide it manually

#### Circle icon

- available when the user is an active member of that circle
- the circle must currently have an active icon
- users may show or hide it manually

### Automatic cleanup

If a user loses eligibility for an icon, the backend must remove it from both:

- the icon-options response
- the user's persisted display selections

Examples:

- newcomer period expires
- VIP level drops to 0
- user leaves or is removed from a circle
- circle icon is cleared or becomes unavailable

## Recommended UX

### Circle settings

Add a `圈子图标` section to the circle-management flow available only to the owner.

Recommended structure:

- current icon preview
- built-in icon grid
- uploaded icon grid for this circle
- upload button
- `设为当前图标` action

Behavior:

- the current active icon is visually marked
- selecting a built-in icon updates the current icon immediately after confirmation
- uploading a new icon does not change the current icon until the owner explicitly selects it, unless the UI chooses to combine upload and select into one action
- non-owners can view the current icon but never edit it

### My icons page

Add a dedicated `我的图标` management page linked from the profile area.

Recommended layout:

1. `当前展示`
2. horizontal or wrapped row of up to 5 displayed icons
3. drag handle or reorder interaction
4. grouped `可选图标` sections:
   - `系统图标`
   - `我的圈子`

Behavior:

- tapping an eligible icon adds it to the displayed list if fewer than 5 are selected
- tapping an already displayed icon hides it
- drag and drop changes `sortOrder`
- reaching 5 icons disables additional adds and shows a clear message

### Display surfaces

All display surfaces should render from the same `displayIcons` payload.

#### Profile gold card

- show the full selected icon row
- use circular image containers with consistent sizing

#### User profile page

- show the same selected icon row near the member identity area

#### Chat profile card

- show the same data, but a compact version is acceptable
- recommended compact rule: show up to 3 icons, then `+N` if more are selected

## Data Model Changes

### Frontend model

The frontend should stop inferring icon rows from ad hoc fields. It should consume a single typed list.

Recommended display item shape:

```ts
type DisplayIconType = "SYSTEM" | "CIRCLE";
type SystemIconKey = "VIP" | "NEW_USER";

type DisplayIcon = {
  id: string;
  type: DisplayIconType;
  title: string;
  imageUrl: string | null;
  fallbackIconName: string | null;
  circleId?: string;
  circleName?: string;
  systemKey?: SystemIconKey;
  sortOrder: number;
};
```

Recommended icon-option item shape:

```ts
type IconOption = {
  type: DisplayIconType;
  title: string;
  imageUrl: string | null;
  fallbackIconName: string | null;
  selected: boolean;
  circleId?: string;
  circleName?: string;
  systemKey?: SystemIconKey;
};
```

### Backend schema

The existing `BadgeTemplate`, `BadgeSource`, `BadgeInstance`, and `UserBadgeCount` models are badge-oriented and should not be repurposed for this feature. They model badge issuance, not a user's active cross-surface icon selection.

Recommended additions in `/Users/yiboding/projects/circle_be/prisma/schema.prisma`:

#### `IconAsset`

Purpose:

- stores image-backed assets that can be used by the unified icon system

Suggested fields:

- `id`
- `name`
- `sourceType` enum: `SYSTEM`, `CIRCLE`
- `imageUrl`
- `createdByID?`
- `createdAt`
- `updatedAt`

Notes:

- built-in icons are `SYSTEM`
- circle-owned uploaded icons are `CIRCLE`
- built-in assets can be seeded

#### `Circle.currentIconAssetID`

Purpose:

- points each circle at its current active icon asset

Suggested relation:

- optional foreign key from `Circle` to `IconAsset`

#### `UserDisplayIcon`

Purpose:

- stores only the icons the user currently chooses to display

Suggested fields:

- `id`
- `userID`
- `displayType` enum: `SYSTEM`, `CIRCLE`
- `systemKey?` enum: `VIP`, `NEW_USER`
- `circleID?`
- `sortOrder`
- `createdAt`
- `updatedAt`

Constraints:

- unique on `(userID, systemKey)` when `systemKey` is present
- unique on `(userID, circleID)` when `circleID` is present
- service-level validation that the total active rows per user is at most 5

Why this shape:

- system icons do not need per-icon asset foreign keys in user selections because their eligibility and label are computed
- circle icon selections should reference the circle, not a historical uploaded asset, so changes to `Circle.currentIconAssetID` propagate automatically

### Migration and seed strategy

Migration steps:

1. add `IconAsset` and `UserDisplayIcon`
2. add `Circle.currentIconAssetID`
3. seed built-in system assets for VIP and newcomer
4. keep existing badge tables untouched

No legacy data migration is required for user-selected icons because this is a new capability.

## API Contract Changes

### `GET /users/me/icon-options`

Returns all icons the current user is eligible to show.

Response groups:

- `systemIcons`
- `circleIcons`
- optionally a flattened `selectedIcons` list if that simplifies frontend bootstrapping

Each item should include:

- title
- selected state
- preview image or fallback icon
- identifying key (`systemKey` or `circleId`)

Service behavior:

- computes eligibility in real time
- removes stale user selections before returning the response

### `PUT /users/me/display-icons`

Persists the user's chosen visible icons and order.

Recommended payload:

```json
{
  "items": [
    { "displayType": "SYSTEM", "systemKey": "VIP", "sortOrder": 0 },
    { "displayType": "CIRCLE", "circleId": "circle-1", "sortOrder": 1 }
  ]
}
```

Validation:

- max 5 items
- no duplicate `systemKey`
- no duplicate `circleId`
- every submitted item must still be eligible
- `sortOrder` must be normalized on write

### `POST /circles/:id/icon/upload`

Uploads a custom icon asset for the current circle.

Rules:

- owner only
- image validation should align with existing media-upload rules
- response returns the new `IconAsset`

### `POST /circles/:id/icon/select`

Sets the circle's current active icon.

Recommended payload:

```json
{
  "iconAssetId": "asset-123"
}
```

Rules:

- owner only
- selected asset must be either:
  - a built-in system-provided circle-eligible asset, or
  - an uploaded asset belonging to that circle

### Profile-bearing endpoints

Any endpoint that returns the current user or another user's profile summary for display surfaces should expose:

- `displayIcons`

At minimum, update the endpoints consumed by:

- profile screen
- user profile screen
- chat profile card / user detail entry points

If the app already has multiple profile DTOs, centralize the icon mapping in one backend helper to avoid drift.

## Backend Architecture

### Eligibility service

Add a dedicated service layer that computes icon eligibility.

Responsibilities:

- resolve whether the user currently has VIP access
- resolve whether the user is still in the newcomer window
- load circles the user is actively a member of
- map circle membership to circles with active icons
- sanitize persisted `UserDisplayIcon` rows against current eligibility

This should be the single source of truth used by both:

- `GET /users/me/icon-options`
- profile `displayIcons` mappers

### Circle icon management service

Add a focused service for circle-owner icon actions.

Responsibilities:

- authorize the current user as circle owner
- upload and persist custom icon assets
- validate selection against built-in and circle-owned assets
- update `Circle.currentIconAssetID`

### Display icon persistence service

Add a focused service for user-controlled display choices.

Responsibilities:

- normalize incoming order
- enforce the 5-item maximum
- reject ineligible items
- upsert the current selection atomically

## Frontend Architecture

### Shared icon presentation component

Create one shared UI component for rendering icon rows from `displayIcons`.

Responsibilities:

- render image-backed circular icons
- fall back to system glyphs where needed
- support `compact` mode for chat cards
- keep spacing and sizing consistent across screens

This component should replace ad hoc icon-row logic in:

- `/Users/yiboding/projects/circle-im/src/features/profile/screens/ProfileScreen.tsx`
- `/Users/yiboding/projects/circle-im/src/features/user/screens/UserProfileScreen.tsx`
- the chat-profile surface that currently renders identity information

### Icon management screen

Add a dedicated screen under the profile flow, for example:

- `/(tabs)/profile/icons`

Responsibilities:

- load `icon-options`
- show current display selection
- let users add, remove, and reorder icons
- submit the normalized selection to `PUT /users/me/display-icons`

### Circle owner icon settings

Extend the existing circle-management flow rather than creating a disconnected admin page.

Recommended touchpoints:

- `CreateCircleScreen` for initial built-in selection only if desired
- `CircleDetailScreen` or a dedicated circle-settings route for ongoing management

The owner flow should reuse the same upload client used elsewhere in the app for image assets if one already exists.

## Error Handling

Backend responses should distinguish validation failures clearly:

- `403` for non-owner circle icon actions
- `400` for invalid icon payloads
- `409` for duplicate or stale selection conflicts if needed

Frontend behavior:

- preserve the current visible state on failed save
- show a clear "最多展示 5 个图标" message when the limit is exceeded
- show upload failure feedback without clearing the previous circle icon
- if an icon becomes invalid while the management screen is open, refresh options after save failure and reconcile the UI

If an image URL fails to load, the frontend should render a fallback circular placeholder and keep layout stable.

## Testing Strategy

### Backend tests

- owner can upload a circle icon
- non-owner cannot upload or select a circle icon
- selecting a built-in icon updates `Circle.currentIconAssetID`
- `GET /users/me/icon-options` returns:
  - VIP when `vipLevel > 0`
  - newcomer when account age is within 30 days
  - circle icons only for active memberships with active circle icons
- stale `UserDisplayIcon` rows are removed when eligibility disappears
- `PUT /users/me/display-icons` rejects:
  - more than 5 items
  - duplicate system icons
  - duplicate circles
  - ineligible icons

### Frontend tests

- profile gold card renders the shared icon row from `displayIcons`
- user profile screen renders the same ordered icons
- chat profile card renders compact icon output
- icon management screen can hide, add, and reorder icons
- adding the 6th icon shows a limit message and does not persist
- circle settings show owner edit affordances only for the owner

### Manual verification

End-to-end validation should cover:

1. owner uploads a circle icon and selects it
2. member joins the circle
3. member sees the circle icon in `我的图标`
4. member enables it and reorders it with system icons
5. the same icon order appears on profile, user page, and chat card
6. owner changes the circle icon and member surfaces reflect the new image
7. member leaves the circle and the icon disappears from selections and display

## Open Questions Deferred From This Iteration

These do not block implementation and should remain out of scope unless product direction changes:

- whether built-in circle icons need their own dedicated category distinct from generic system assets
- whether uploaded circle icons require moderation before becoming selectable
- whether circles should retain historical uploaded assets forever or allow deletion
