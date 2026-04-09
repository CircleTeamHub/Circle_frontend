# Send Friend Request Form Design

## Goal

Replace the current direct-send friend-request action with a dedicated Chinese-language `发送好友申请` page that:

- collects a greeting message before sending
- lets the sender set a private remark for the target user
- lets the sender preselect friend tags
- stores those remark and tag choices with the request
- automatically applies those choices if the request is accepted

This iteration does not implement image upload, photo remarks, or friend-permission editing. Those sections exist in the UI as placeholders only.

## Product Flow

The new flow is:

1. user searches by `accountId`
2. user opens the other person's profile page
3. user taps `发好友申请`
4. app opens a dedicated `发送好友申请` page
5. user fills greeting, remark, and tags
6. user sends the request
7. if the other side accepts later, the sender's saved remark and tags become active automatically

This replaces the current behavior where the profile page directly calls `POST /friend/requests`.

## Scope

### Real Functionality In This Iteration

- greeting message
- private remark name
- existing tag selection
- saving request metadata on send
- auto-applying saved metadata on accept

### Placeholder-Only Sections In This Iteration

- image
- photo remarks
- friends' permissions
- greeting pinning / top greeting behavior

Placeholder sections should look intentional in the UI, but they do not need data persistence or backend support yet.

## UI Design

### Search Page

The current `添加好友` search page remains focused on searching by `accountId`.

It should continue to:

- accept a full `accountId`
- show an exact-match user result
- navigate to the target profile page

No request form fields are added on the search page.

### Profile Page

For non-friends in `NONE` state, the bottom CTA changes from an immediate send action to navigation:

- button label: `发好友申请`
- action: navigate to the request form page with target user id and display name

Existing non-send states remain unchanged:

- `已发送申请`
- `等待处理`
- `已是好友`
- `已拉黑`

### Request Form Page

Add a dedicated page named `发送好友申请`.

Recommended structure, top to bottom:

1. `验证消息`
2. greeting text area
3. placeholder image row
4. placeholder toggle / hint for `设为打招呼置顶内容`
5. `备注名`
6. remark text input
7. inline emoji/helper row if desired
8. `标签`
9. tag selector row
10. `备注` placeholder row
11. `照片备注` placeholder row
12. `朋友权限` placeholder row
13. bottom primary button `发送`

The UI should be Chinese-localized and visually close to the provided reference, but follow the app's existing theme and component language instead of copying the screenshot literally.

### Field Rules

#### 验证消息

- optional
- prefill with a short default greeting, such as `你好，我是 {我的昵称}`
- max length should stay aligned with backend validation

#### 备注名

- optional
- this is the sender's future private remark for the target user
- it should not affect the recipient's view

#### 标签

- first iteration supports selecting existing tags only
- no inline create-tag flow in this page
- if the user has no tags yet, show an empty-state hint like `暂无标签，可稍后在联系人标签中创建`

#### Placeholder Rows

The placeholder rows should be visibly non-editable or routed to a `暂未开放` message.

Do not make them appear partially functional.

## Frontend Architecture

### Route Changes

Introduce a dedicated route for the request form under the contacts flow.

Suggested route shape:

- `/(tabs)/contacts/user/[id]/request`

The route should receive:

- target user id
- optional display name

The profile page becomes the handoff point into this route.

### Screen Responsibilities

#### Search Screen

Responsibility stays unchanged:

- search by `accountId`
- show result
- navigate to profile

#### User Profile Screen

Responsibilities after this change:

- show target profile
- show current relationship status
- navigate to request form when status is `NONE`

It should no longer submit friend requests directly.

#### Send Friend Request Screen

Responsibilities:

- fetch sender's available tags
- manage form state
- validate form before submit
- submit the request payload
- show success feedback
- return to an appropriate previous screen after submit

### API Client Changes

Extend the friend request client payload from:

```ts
createFriendRequest(targetId: string, message?: string)
```

to something like:

```ts
createFriendRequest({
  targetId,
  message,
  remark,
  tagIds,
})
```

The frontend should send only meaningful values:

- omit empty remark
- omit empty message
- send `tagIds: []` only if the API contract prefers explicit empties

## Backend Architecture

## Relationship Between Request State And Future Metadata

The friend request record already represents the relationship request itself.

This iteration extends that record so it can also carry sender-authored metadata that should only become active if the request is accepted.

That metadata is not visible as active friendship metadata while the request is still pending.

### Pending Remark

Add a sender-side pending remark field to the request record.

Suggested field:

- `pendingRemarkBySender`

Purpose:

- stores the sender's planned private remark for the target user
- becomes the sender-side friend remark when the request is accepted

Do not write this value into `remarkA` / `remarkB` while the request is still pending.

### Pending Tags

Do not write pending tags into the accepted-friend tag junction yet.

Instead, create a dedicated pending-tag relation keyed by request id.

Suggested new model:

- `PendingFriendTagOnRequest`

Suggested fields:

- `id`
- `ownerId`
- `requestId`
- `tagId`
- `createdAt`

Purpose:

- store which existing tags the sender wants to apply if the request becomes an accepted friendship

This keeps accepted-friend tagging and pending-request metadata separate.

## Backend API Design

### Send Friend Request

Extend:

```http
POST /friend/requests
Authorization: Bearer <accessToken>
```

Request body becomes:

```json
{
  "targetId": "uuid",
  "message": "你好，我是 ...",
  "remark": "小王",
  "tagIds": ["tag-uuid-1", "tag-uuid-2"]
}
```

Validation rules:

- `targetId` required
- `message` optional
- `remark` optional
- `tagIds` optional
- every tag id must belong to the sender

### Accept Request

When the recipient accepts:

1. request state becomes `ACCEPTED`
2. sender-side pending remark is copied into the correct accepted friendship remark slot
3. sender-side pending tags are copied into `FriendTagOnFriend`
4. pending metadata records can then be deleted or left unused, depending on preferred cleanup strategy

Recommended behavior:

- copy into active structures
- delete pending tag rows after successful copy
- clear the pending remark field after migration if the team prefers a cleaner accepted record

### Reject Request / Withdraw Request

When a request is rejected or withdrawn:

- do not apply pending remark
- do not apply pending tags
- keep request/activity history
- pending metadata may remain attached to the historical request record

That keeps history complete and avoids losing the original request context.

## Friend Activity Detail Impact

The new request metadata should be visible from the friend-activity detail page when helpful.

Recommended detail payload additions:

- request message
- pending remark
- pending tags
- current action availability

This lets the recipient see the full request context before deciding.

## Validation And Error Handling

### Frontend

- disable send while submitting
- prevent duplicate submissions
- show a clear error if tags fail validation on the backend
- show a dedicated empty state if the user has no tags

### Backend

Reject request submission when:

- target user does not exist
- target user is blocked / blocking
- request already exists in a pending or accepted state
- provided tag ids do not belong to the sender

Ignore stale tag ids during accept only if the tag was deleted after request creation and product prefers permissive acceptance.

Recommended behavior:

- accept the friend request anyway
- skip only the invalid/deleted tag rows
- log the inconsistency for debugging

That prevents tag deletion from blocking acceptance of a real friend request.

## Data Ownership Rules

Private metadata remains directional.

- sender's pending remark becomes only the sender's accepted-friend remark
- sender's pending tags become only the sender's tag assignments
- recipient does not inherit or see those values as their own editable metadata

This should mirror the existing directional semantics of `remarkA` / `remarkB`.

## Testing Strategy

### Frontend Tests

Add or update tests for:

- profile page navigates to request form instead of sending directly
- request form renders Chinese labels and placeholder rows
- request form submits `message`, `remark`, and `tagIds`
- request form handles empty-tag state
- request form blocks duplicate submits

### Backend Tests

Add tests for:

- request creation saves pending remark and pending tags
- invalid tag ids are rejected
- accepting a request applies pending remark to the correct side
- accepting a request creates active friend-tag assignments
- rejecting or withdrawing a request does not apply pending metadata

### Integration Expectations

Manual verification should cover:

1. search user by `accountId`
2. open profile
3. enter greeting, remark, and tags
4. send request
5. inspect recipient `新的朋友` detail
6. accept request
7. confirm sender sees active remark and tags on the new friendship

## Assumptions

- first iteration uses existing tags only; no inline tag creation from the request form
- placeholder rows are intentionally non-functional
- sender-authored request metadata is private, directional, and activates only on acceptance

## Out Of Scope

- inline tag creation from the request form
- request-form image upload
- photo remarks persistence
- friend permissions persistence
- bulk request editing after send
- real-time push updates for the request form itself
