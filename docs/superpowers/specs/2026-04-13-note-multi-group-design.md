# 2026-04-13 Note Multi-Group Design

## Summary

Upgrade notes from a single optional group to persistent multi-group classification. The notes page keeps the two fixed filters `全部` and `未分组`, adds user-managed custom groups such as `北京` or `上海`, and allows one note to belong to multiple custom groups at the same time.

This requires coordinated backend and frontend changes because the current model stores only one `groupID` on each note. The new design uses a many-to-many relation between notes and custom groups, preserves notes when a group is deleted, and updates the notes list, note editor, and group management UI to reflect the new behavior.

## Approach Options

### Option 1: True backend-backed many-to-many groups (recommended)

Replace the current single-group relation with a persistent note-to-group join table and update the frontend to edit and filter by multiple groups.

Pros:

- matches the approved product behavior exactly
- supports long-term persistence and future expansion
- keeps filtering and counts consistent

Cons:

- requires coordinated backend, API, and frontend changes
- needs migration from existing single-group data

### Option 2: Keep backend single-group, fake multi-select in frontend

Serialize multiple group ids into a frontend-only field or custom string format while leaving backend storage unchanged.

Pros:

- lower short-term implementation effort

Cons:

- data model becomes misleading and fragile
- filters, counts, and edits will drift from persisted data
- blocks future backend features built on note groups

### Option 3: Add group management only, keep note assignment single-select

Allow users to create, rename, and delete custom groups but continue storing only one group per note.

Pros:

- smaller implementation scope

Cons:

- directly conflicts with the approved requirement that one note can belong to multiple groups

## Scope

In scope:

- persistent custom note groups
- fixed filters `全部` and `未分组`
- create, rename, and delete custom groups
- assign one note to multiple custom groups
- remove one or all group assignments from a note
- update notes list filtering and counts
- update note create/edit flows
- preserve notes when a group is deleted

Out of scope:

- nested groups
- group colors or icons
- drag-and-drop group reordering on the frontend
- server-defined system groups beyond `全部` and `未分组`
- bulk assigning many notes to groups from the list page

## Product Rules

### Fixed filters

The notes page always shows these two fixed filters first:

- `全部`: shows every note in the current status view
- `未分组`: shows notes with zero custom group assignments

These are not editable records in the database. They are frontend filters backed by note data.

### Custom groups

Users can create custom groups like `北京` and `上海`.

Rules:

- custom groups can be created, renamed, and deleted
- custom groups are user-scoped
- deleting a custom group removes only the note-group associations for that group
- deleting a custom group never deletes notes

### Multi-group note membership

Each note can belong to zero, one, or many custom groups.

Behavior:

- a note with zero custom groups appears under `未分组`
- a note with multiple groups appears in each corresponding custom group filter
- group counts represent the number of notes associated with that custom group

## Recommended UX

### Notes list page

`src/features/notes/screens/NotesScreen.tsx` should keep the current horizontal filter row but evolve it as follows:

- order filters as `全部`, `未分组`, then all custom groups
- keep custom groups horizontally scrollable
- add a `管理` entry or overflow action at the end of the group row
- opening the management action shows a bottom sheet or modal dedicated to group management

The current summary text remains valid but should count custom groups only:

- `共 X 个分组，合计 Y 条笔记`

Where `X` is the number of custom groups, not including `全部` and `未分组`.

### Group management sheet

The management UI should list only editable custom groups, never the fixed filters.

Supported actions:

- create a new group
- rename an existing group
- delete an existing group

Recommended interaction:

- each group row shows name and note count
- row action supports rename and delete
- bottom area contains new-group input and confirm action

Validation:

- trim whitespace
- reject empty names
- reject duplicate names within the same user
- enforce backend name length limits in the frontend too

### Note create/edit screen

`src/features/notes/screens/EditNoteScreen.tsx` should replace the current single `groupId` model with a multi-select group picker.

Behavior:

- load the available custom groups when opening the editor
- allow selecting multiple groups
- show existing selections when editing a note
- allow clearing all selections
- submit all selected group ids on save

Metadata display near the note date should evolve from a single tag to either:

- a compact multi-tag row, or
- a short summary like `已分组 3 个`

The preferred implementation is a compact multi-tag row when space allows, because it gives immediate feedback while editing.

## Data Model Changes

### Backend schema

The backend currently stores a single optional `groupID` on `Note`. Replace this with a many-to-many structure.

Recommended schema change in `/Users/yiboding/projects/circle_be/prisma/schema.prisma`:

- remove the single-source-of-truth role of `Note.groupID`
- add a join model such as `NoteGroupMembership`
- relate `Note` to many memberships
- relate `NoteGroup` to many memberships

Recommended join model fields:

- `id`
- `noteID`
- `groupID`
- `createdAt`

Constraints:

- unique composite index on `noteID + groupID`
- foreign keys cascade or clean up memberships when note or group is deleted

### Migration

Existing notes may already have one `groupID`.

Migration strategy:

1. Create the new join table.
2. Backfill one membership row for each note that currently has `groupID`.
3. Update application code to read from memberships.
4. Remove or stop using the legacy single-group column.

This avoids data loss and preserves current note-group assignments.

## API Contract Changes

### Note payloads

Frontend note types in `src/features/notes/types.ts` should move from:

- `group: { id, name } | null`
- `groupId?: string`

To:

- `groups: Array<{ id: string; name: string }>`
- `groupIds?: string[]`

Apply this to both summary and detail flows.

### Notes list endpoint

`GET /note`

Response changes:

- each note returns `groups: []`
- a note with no custom groups returns an empty array

Filtering:

- continue supporting `groupId=<customGroupId>` to mean “notes associated with this custom group”
- `未分组` does not need its own backend record
- the frontend can compute `未分组` by `groups.length === 0`

### Note create/update endpoints

`POST /note` and `PATCH /note/:id`

Request changes:

- replace `groupId` with `groupIds`
- accept zero, one, or many group ids

Validation:

- all submitted group ids must belong to the current user
- duplicate ids in the payload should be normalized
- unknown ids should fail with `400` or `404` depending on current service conventions

### Group endpoints

Keep the existing group endpoints:

- `GET /note/group`
- `POST /note/group`
- `PATCH /note/group/:id`
- `DELETE /note/group/:id`

Behavior changes:

- `GET /note/group` should compute `noteCount` from memberships
- `DELETE /note/group/:id` removes memberships and the group record, but not notes

## Frontend Changes

### Type updates

Update:

- `src/features/notes/types.ts`
- `src/services/api/notes.ts`
- any note utility that still assumes `note.group`

Key shifts:

- note summaries and details expose `groups`
- create/update inputs send `groupIds`
- list filtering logic uses `note.groups.some(...)`

### NotesScreen

Update `src/features/notes/screens/NotesScreen.tsx` to:

- filter `未分组` by `note.groups.length === 0`
- filter custom tabs by membership inside `note.groups`
- render tab counts from the new group counts returned by backend
- add the group management trigger in the horizontal tab area
- refresh notes and groups after create, rename, or delete operations
- if the active custom group is deleted, reset the active tab to `全部`

### Note card metadata

`src/features/notes/components/NoteCard.tsx` and related formatting helpers should stop assuming a single group name.

Recommended list-card rule:

- show up to one or two group names inline if present
- if more than two groups exist, summarize as `北京、上海 +1`

This keeps the list readable without hiding the fact that notes can span multiple groups.

### EditNoteScreen

Update `src/features/notes/screens/EditNoteScreen.tsx` to:

- fetch custom groups for selection
- store selected ids as `string[]`
- render a multi-select group section
- submit `groupIds` on create and update
- render selected groups in the editor metadata area

The save payload should become:

- `title`
- `content`
- `contentJson`
- `groupIds`
- `media`
- `status`

## Error Handling

- creating or renaming a group to an empty name should fail immediately in the UI
- creating or renaming a group to a duplicate name should surface a clear error
- deleting a group while viewing that group should return the user to `全部`
- if a note references groups that were deleted before save, the backend should reject invalid ids and the frontend should refresh groups before retry
- if group fetch fails in the editor, note editing should still load, but group selection should show a recoverable error state instead of blocking the entire editor

## Testing Strategy

### Backend

Add or update tests in `/Users/yiboding/projects/circle_be/src/note` for:

- creating a note with multiple groups
- updating a note to add, replace, and clear group memberships
- listing notes with `groups[]`
- filtering notes by custom `groupId`
- returning notes with no memberships as ungrouped
- deleting a group without deleting notes
- computing `noteCount` from memberships
- rejecting cross-user group ids in create/update
- rejecting duplicate group names per user

### Frontend

Add or update tests in `/Users/yiboding/projects/circle-im/test` for:

- notes API input/output using `groupIds` and `groups`
- notes screen filter logic for `全部`, `未分组`, and custom groups
- presence of the group management trigger
- editor payload submission with multiple selected groups
- fallback behavior when the active group is deleted

## Implementation Order

1. Upgrade backend schema and migrate old single-group data into memberships.
2. Update backend DTOs, service mapping, and API docs.
3. Update frontend note types and API client payloads.
4. Update notes list filtering and counts.
5. Add group management UI.
6. Update note editor to support multi-select groups.
7. Run backend and frontend verification for the changed contract.

## Risks

- the current frontend and backend both assume a single group field, so partial rollout will break note editing if contract changes are not coordinated
- list-card metadata can become noisy if multiple groups are rendered without compression
- migration must preserve existing single-group assignments or users will see notes incorrectly fall into `未分组`

## Success Criteria

- users can create, rename, and delete custom note groups
- users can assign a note to multiple custom groups and persist the result
- `全部` always shows all notes
- `未分组` shows only notes with zero custom groups
- deleting a custom group never deletes notes
- note counts and tab filters remain consistent after edits and deletions
