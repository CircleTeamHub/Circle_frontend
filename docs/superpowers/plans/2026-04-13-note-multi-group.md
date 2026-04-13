# Note Multi-Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent multi-group note classification with editable and reorderable custom groups, fixed `全部` / `未分组` filters, and note membership in zero or more custom groups.

**Architecture:** Replace the backend's single-note `groupID` relation with a many-to-many note-group membership table, then update the frontend note contract from `group/groupId` to `groups/groupIds`. Keep `全部` and `未分组` as frontend filters, persist custom-group order via `sortOrder`, add a dedicated group-management sheet with drag-to-reorder on the notes list page, and switch the note editor to multi-select group assignment.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Expo Router, React Native, TypeScript, Node `node:test`, Jest, existing `apiClient` helpers.

---

## File Structure

- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_note_multi_groups/migration.sql`
- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Modify: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.spec.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/note.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/note.service.spec.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/note.controller.ts`
- Modify: `/Users/yiboding/projects/circle_be/docs/frontend-api-guide.md`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/types.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/notes.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/NotesScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/EditNoteScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/components/NoteCard.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/utils/note-format.ts`
- Test: `/Users/yiboding/projects/circle-im/test/notes-api.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/notes-screen.test.js`

## Task 1: Backend DTO And Schema Contract

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_note_multi_groups/migration.sql`
- Modify: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.spec.ts`

- [ ] **Step 1: Write the failing DTO tests for `groupIds`**

```ts
it('accepts multiple group ids and rejects invalid group id payloads', () => {
  const validDto = plainToInstance(CreateNoteDto, {
    title: '测试笔记',
    groupIds: [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ],
    media: [],
  });

  expect(validateSync(validDto)).toHaveLength(0);

  const invalidDto = plainToInstance(CreateNoteDto, {
    title: '测试笔记',
    groupIds: ['not-a-uuid'],
    media: [],
  });

  expect(validateSync(invalidDto).some((error) => error.property === 'groupIds')).toBe(true);
});
```

- [ ] **Step 2: Run DTO tests to verify they fail**

Run: `pnpm -C /Users/yiboding/projects/circle_be test src/note/dto/note.dto.spec.ts --runInBand`  
Expected: FAIL because `CreateNoteDto` still exposes `groupId` instead of `groupIds`.

- [ ] **Step 3: Update DTOs and Prisma schema minimally**

```ts
@ApiPropertyOptional({ type: [String] })
@IsOptional()
@IsArray()
@IsUUID(undefined, { each: true })
groupIds?: string[];
```

```prisma
model NoteGroupMembership {
  id        String   @id @default(uuid())
  noteID    String
  groupID   String
  createdAt DateTime @default(now())

  note  Note      @relation(fields: [noteID], references: [id], onDelete: Cascade)
  group NoteGroup @relation(fields: [groupID], references: [id], onDelete: Cascade)

  @@unique([noteID, groupID])
  @@index([groupID])
}
```

- [ ] **Step 4: Add migration SQL for backfill**

```sql
INSERT INTO "NoteGroupMembership" ("id", "noteID", "groupID", "createdAt")
SELECT gen_random_uuid()::text, "id", "groupID", NOW()
FROM "Note"
WHERE "groupID" IS NOT NULL;
```

- [ ] **Step 5: Run DTO tests again**

Run: `pnpm -C /Users/yiboding/projects/circle_be test src/note/dto/note.dto.spec.ts --runInBand`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C /Users/yiboding/projects/circle_be add prisma/schema.prisma prisma/migrations src/note/dto/note.dto.ts src/note/dto/note.dto.spec.ts
git -C /Users/yiboding/projects/circle_be commit -m "feat: add note multi-group schema contract"
```

## Task 2: Backend Service Mapping, Filtering, And Group Deletion Semantics

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/note/note.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/note.service.spec.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/note/note.controller.ts`

- [ ] **Step 1: Write the failing service test for multi-group create and list mapping**

```ts
it('creates notes with multiple groups and returns groups in summaries', async () => {
  prisma.noteGroup.findMany.mockResolvedValueOnce([
    { id: 'group-1', ownerID: 'user-1', deletedAt: null },
    { id: 'group-2', ownerID: 'user-1', deletedAt: null },
  ]);

  await service.createNote('user-1', {
    title: '测试笔记',
    groupIds: ['group-1', 'group-2'],
    media: [],
  });

  expect(prisma.note.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        groupMemberships: {
          createMany: {
            data: expect.arrayContaining([
              { groupID: 'group-1' },
              { groupID: 'group-2' },
            ]),
          },
        },
      }),
    }),
  );
});
```

- [ ] **Step 2: Add the failing service test for deleting a group without deleting notes**

```ts
it('deletes a group by soft deleting the group and removing memberships only', async () => {
  prisma.noteGroup.findFirst.mockResolvedValueOnce({
    id: 'group-1',
    ownerID: 'user-1',
    deletedAt: null,
  });

  await service.deleteGroup('user-1', 'group-1');

  expect(prisma.noteGroup.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'group-1' },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    }),
  );
  expect(prisma.note.updateMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add the failing service test for reordering custom groups**

```ts
it('rewrites custom group sort order from an ordered id list', async () => {
  prisma.noteGroup.findMany.mockResolvedValueOnce([
    { id: 'group-1', ownerID: 'user-1', deletedAt: null },
    { id: 'group-2', ownerID: 'user-1', deletedAt: null },
  ]);

  await service.reorderGroups('user-1', ['group-2', 'group-1']);

  expect(prisma.$transaction).toHaveBeenCalled();
  expect(prisma.noteGroup.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'group-2' },
      data: expect.objectContaining({ sortOrder: 0 }),
    }),
  );
});
```

- [ ] **Step 4: Run service tests to verify they fail**

Run: `pnpm -C /Users/yiboding/projects/circle_be test src/note/note.service.spec.ts --runInBand`  
Expected: FAIL because the service still uses `groupID` and `group`.

- [ ] **Step 5: Implement minimal service changes**

```ts
const NOTE_INCLUDE = {
  groupMemberships: {
    where: { group: { deletedAt: null } },
    include: {
      group: {
        select: { id: true, name: true },
      },
    },
  },
  media: { orderBy: { sortOrder: 'asc' } },
  coverMedia: { select: { id: true, type: true, url: true } },
} as const;
```

```ts
private mapGroups(note: any) {
  return (note.groupMemberships ?? []).map((membership: any) => ({
    id: membership.group.id,
    name: membership.group.name,
  }));
}
```

```ts
const uniqueGroupIds = [...new Set(input.groupIds ?? [])];
```

- [ ] **Step 6: Add the reorder endpoint and service write path**

```ts
@Patch('group/order')
reorderGroups(
  @Body() dto: ReorderNoteGroupsDto,
  @Req() req: any,
) {
  return this.noteService.reorderGroups(req.user.userId, dto.groupIds);
}
```

```ts
await this.prisma.$transaction(
  uniqueGroupIds.map((groupId, index) =>
    this.prisma.noteGroup.update({
      where: { id: groupId },
      data: { sortOrder: index },
    }),
  ),
);
```

- [ ] **Step 7: Update list filtering and group counts**

```ts
where: {
  ownerID,
  status: query.status ?? 'ACTIVE',
  ...(query.groupId
    ? {
        groupMemberships: {
          some: {
            groupID: query.groupId,
            group: { deletedAt: null },
          },
        },
      }
    : {}),
}
```

```ts
_count: {
  select: {
    memberships: true,
  },
}
```

- [ ] **Step 8: Run service tests again**

Run: `pnpm -C /Users/yiboding/projects/circle_be test src/note/note.service.spec.ts --runInBand`  
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git -C /Users/yiboding/projects/circle_be add src/note/note.service.ts src/note/note.service.spec.ts src/note/note.controller.ts
git -C /Users/yiboding/projects/circle_be commit -m "feat: support multi-group note memberships"
```

## Task 3: Backend API Documentation And Full Verification

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/docs/frontend-api-guide.md`
- Verify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Verify: `/Users/yiboding/projects/circle_be/src/note/dto/note.dto.ts`
- Verify: `/Users/yiboding/projects/circle_be/src/note/note.service.ts`

- [ ] **Step 1: Document the new request and response payloads**

```md
- `groupIds?: string[]` on create and update note payloads
- `groups: Array<{ id: string; name: string }>` on note summary and detail payloads
- `PATCH /note/group/order` rewrites custom-group `sortOrder`
- deleting a note group removes memberships only and does not delete notes
```

- [ ] **Step 2: Run the targeted backend tests**

Run: `pnpm -C /Users/yiboding/projects/circle_be test src/note/note.service.spec.ts src/note/dto/note.dto.spec.ts --runInBand`  
Expected: PASS

- [ ] **Step 3: Run backend type generation and typecheck**

Run: `pnpm -C /Users/yiboding/projects/circle_be prisma generate`  
Expected: PASS

Run: `pnpm -C /Users/yiboding/projects/circle_be exec tsc --noEmit`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git -C /Users/yiboding/projects/circle_be add docs/frontend-api-guide.md prisma/schema.prisma src/note
git -C /Users/yiboding/projects/circle_be commit -m "docs: update note api for multi-group support"
```

## Task 4: Frontend Type And API Contract Update

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/types.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/notes.ts`
- Modify: `/Users/yiboding/projects/circle-im/test/notes-api.test.js`

- [ ] **Step 1: Write the failing frontend API assertions**

```js
test('note types and api client use groups arrays and groupIds payloads', () => {
  const typesSource = read('src/features/notes/types.ts');
  const apiSource = read('src/services/api/notes.ts');

  assert.match(typesSource, /groups: \{ id: string; name: string \}\[]/);
  assert.match(typesSource, /groupIds\?: string\[]/);
  assert.doesNotMatch(typesSource, /group: \{ id: string; name: string \} \| null/);
  assert.match(apiSource, /groupIds/);
  assert.match(apiSource, /reorderNoteGroups/);
});
```

- [ ] **Step 2: Run the API tests to verify they fail**

Run: `node --test test/notes-api.test.js`  
Expected: FAIL because the frontend still uses `group` and `groupId`.

- [ ] **Step 3: Update the frontend note contract**

```ts
export interface NoteSummary {
  groups: { id: string; name: string }[];
}

export interface CreateNoteInput {
  groupIds?: string[];
}
```

- [ ] **Step 4: Keep `fetchNotes` query filtering compatible**

```ts
if (params?.groupId) q.set('groupId', params.groupId);
```

The list endpoint still filters by a single selected tab even though notes can belong to many groups.

- [ ] **Step 5: Add the reorder API helper**

```ts
export async function reorderNoteGroups(groupIds: string[]): Promise<NoteGroup[]> {
  return apiClient<NoteGroup[]>('/note/group/order', {
    method: 'PATCH',
    body: { groupIds },
  });
}
```

- [ ] **Step 6: Run the API tests again**

Run: `node --test test/notes-api.test.js`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/features/notes/types.ts src/services/api/notes.ts test/notes-api.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: update note frontend contract for multi-groups"
```

## Task 5: Notes List Filtering, Group Management, And Drag Reorder

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/NotesScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/components/NoteCard.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/utils/note-format.ts`
- Modify: `/Users/yiboding/projects/circle-im/test/notes-screen.test.js`

- [ ] **Step 1: Write the failing notes screen assertions**

```js
test('NotesScreen supports custom group management and multi-group filtering', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(src, /管理|ellipsis-horizontal/);
  assert.match(src, /note\.groups/);
  assert.match(src, /groups\.length === 0/);
  assert.match(src, /createNoteGroup/);
  assert.match(src, /updateNoteGroup/);
  assert.match(src, /deleteNoteGroup/);
  assert.match(src, /reorderNoteGroups/);
});
```

- [ ] **Step 2: Run the notes screen tests to verify they fail**

Run: `node --test test/notes-screen.test.js`  
Expected: FAIL because the screen still assumes one `group`.

- [ ] **Step 3: Implement the smallest list-screen UI changes**

```tsx
const isUngrouped = (note: NoteSummary) => note.groups.length === 0;
```

```tsx
else if (activeTab !== 'all') {
  result = result.filter((note) => note.groups.some((group) => group.id === activeTab));
}
```

```tsx
<Pressable onPress={() => setGroupManagerVisible(true)} hitSlop={8}>
  <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
</Pressable>
```

- [ ] **Step 4: Add the group management sheet behavior**

```tsx
await createNoteGroup(trimmedName);
await updateNoteGroup(group.id, trimmedName);
await deleteNoteGroup(group.id);
await load();
if (activeTab === group.id) setActiveTab('all');
```

- [ ] **Step 5: Add drag-to-reorder persistence**

```tsx
const handleReorderGroups = async (nextGroups: NoteGroup[]) => {
  const orderedIds = nextGroups.map((group) => group.id);
  setGroups(nextGroups);
  try {
    await reorderNoteGroups(orderedIds);
  } catch {
    await load();
  }
};
```

Use the list library already present in the app if it supports drag-and-drop cleanly; otherwise add the smallest focused dependency that works inside the management sheet instead of building custom gesture math.

- [ ] **Step 6: Compress note card group metadata**

```ts
const groupLabel =
  note.groups.length <= 2
    ? note.groups.map((group) => group.name).join('、')
    : `${note.groups[0]?.name}、${note.groups[1]?.name} +${note.groups.length - 2}`;
```

- [ ] **Step 7: Run the notes screen tests again**

Run: `node --test test/notes-screen.test.js`  
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/features/notes/screens/NotesScreen.tsx src/features/notes/components/NoteCard.tsx src/features/notes/utils/note-format.ts test/notes-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: add note group management to notes list"
```

## Task 6: Note Editor Multi-Select Group Assignment

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/EditNoteScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/notes/screens/NotesScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/test/notes-screen.test.js`

- [ ] **Step 1: Extend the source-based tests to cover editor multi-select**

```js
test('EditNoteScreen loads and submits multiple group ids', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /fetchNoteGroups/);
  assert.match(src, /selectedGroupIds|groupIds/);
  assert.match(src, /groupIds:/);
  assert.match(src, /Pressable/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/notes-screen.test.js`  
Expected: FAIL because the editor still stores a single `groupId`.

- [ ] **Step 3: Implement the smallest editor state shift**

```ts
const [availableGroups, setAvailableGroups] = useState<NoteGroup[]>([]);
const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
```

```ts
setSelectedGroupIds(note.groups.map((group) => group.id));
```

```ts
groupIds: selectedGroupIds,
```

- [ ] **Step 4: Add multi-select toggles and compact selected tags**

```tsx
const toggleGroup = (groupId: string) =>
  setSelectedGroupIds((prev) =>
    prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
  );
```

```tsx
{availableGroups.map((group) => (
  <Pressable key={group.id} onPress={() => toggleGroup(group.id)}>
    <Text>{group.name}</Text>
  </Pressable>
))}
```

- [ ] **Step 5: Run the notes screen tests again**

Run: `node --test test/notes-screen.test.js`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/features/notes/screens/EditNoteScreen.tsx src/features/notes/screens/NotesScreen.tsx test/notes-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: allow assigning notes to multiple groups"
```

## Task 7: Final Verification

**Files:**
- Verify the files above in both repositories

- [ ] **Step 1: Run targeted frontend tests**

Run: `node --test test/notes-api.test.js test/notes-screen.test.js`  
Expected: PASS

- [ ] **Step 2: Run targeted backend tests**

Run: `pnpm -C /Users/yiboding/projects/circle_be test src/note/note.service.spec.ts src/note/dto/note.dto.spec.ts --runInBand`  
Expected: PASS

- [ ] **Step 3: Run frontend typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 4: Run backend typecheck**

Run: `pnpm -C /Users/yiboding/projects/circle_be exec tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Manual verification**

Check:

- create custom groups like `北京` and `上海`
- drag custom groups so `上海` appears before `北京`
- rename and delete a custom group
- verify deleted group does not delete notes
- assign one note to multiple groups
- verify `未分组` shows only notes with zero groups
- verify `全部` still shows every note
- verify the reordered custom-group tab order persists after reload

- [ ] **Step 6: Final commit if needed**

```bash
git -C /Users/yiboding/projects/circle-im status
git -C /Users/yiboding/projects/circle_be status
```
