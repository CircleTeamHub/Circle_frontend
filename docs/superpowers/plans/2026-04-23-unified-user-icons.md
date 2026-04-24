# Unified User Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified user icon system where circle owners can set a circle icon, users can choose up to 5 eligible icons to display, and the same icon list appears on profile, public user profile, and chat profile surfaces.

**Architecture:** Add a backend-backed eligibility and selection model instead of deriving icons independently on each screen. Persist only user display choices and current circle icon pointers; compute system icon eligibility dynamically and resolve the final `displayIcons` payload in shared backend helpers consumed by both self-profile and public-profile endpoints.

**Tech Stack:** NestJS, Prisma, Expo Router, React Native, Zustand, existing REST API client, Node built-in test runner, Jest

---

## File Map

- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
  Add icon enums/models and circle foreign key.
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_unified_user_icons/migration.sql`
  Persist schema changes and seed built-in icon assets.
- Create: `/Users/yiboding/projects/circle_be/src/icon/dto/icon.dto.ts`
  Shared icon DTOs for options and display rows.
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.service.ts`
  Eligibility resolution, user selection persistence, and display-icon mapping.
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.controller.ts`
  `GET /icon/options` and `PUT /icon/display`.
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.module.ts`
  Nest module wiring.
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.controller.ts`
  Add owner-only icon upload/select endpoints.
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.service.ts`
  Add current icon selection and membership cleanup hooks.
- Modify: `/Users/yiboding/projects/circle_be/src/circle/dto/circle.dto.ts`
  Expose current circle icon information.
- Modify: `/Users/yiboding/projects/circle_be/src/auth/auth.service.ts`
  Add `displayIcons` to `me()`.
- Modify: `/Users/yiboding/projects/circle_be/src/user/user.service.ts`
  Add `displayIcons` to public profiles.
- Modify: `/Users/yiboding/projects/circle_be/src/user/dto/public-user.dto.ts`
  Add `displayIcons` field to self/public DTOs.
- Modify: `/Users/yiboding/projects/circle_be/src/app.module.ts`
  Register the new icon module.
- Modify: `/Users/yiboding/projects/circle_be/src/auth/__test__/auth.service.spec.ts`
  Cover `displayIcons` on `/auth/me`.
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.service.spec.ts`
  Cover owner icon actions and leave-circle cleanup.
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.service.spec.ts`
  Cover eligibility, limit validation, and selection persistence.
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/auth.ts`
  Extend backend self-user type with `displayIcons`.
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/profile.ts`
  Extend public-profile typing.
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/utils.ts`
  Normalize icon image URLs.
- Modify: `/Users/yiboding/projects/circle-im/src/stores/authStore.ts`
  Persist `displayIcons` on the auth user.
- Modify: `/Users/yiboding/projects/circle-im/src/types/index.ts`
  Add shared icon and circle-icon types.
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/circles.ts`
  Add circle icon upload/select APIs.
- Create: `/Users/yiboding/projects/circle-im/src/services/api/icons.ts`
  Add `fetchIconOptions` and `updateDisplayIcons`.
- Create: `/Users/yiboding/projects/circle-im/src/components/ui/user-icon-row.tsx`
  Shared icon row component for profile surfaces.
- Create: `/Users/yiboding/projects/circle-im/src/features/profile/screens/MyIconsScreen.tsx`
  User icon management page.
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/profile/icons.tsx`
  Route export for icon management page.
- Modify: `/Users/yiboding/projects/circle-im/src/features/profile/screens/ProfileScreen.tsx`
  Replace ad hoc VIP/newbie logic with shared icon row and entrypoint to icon management.
- Modify: `/Users/yiboding/projects/circle-im/src/features/user/screens/UserProfileScreen.tsx`
  Render the shared icon row from backend data.
- Modify: `/Users/yiboding/projects/circle-im/src/features/chat/screens/ChatInfoScreen.tsx`
  Render compact icon row for chat profile info.
- Modify: `/Users/yiboding/projects/circle-im/src/features/discover/screens/CircleDetailScreen.tsx`
  Add owner-only circle icon management UI.
- Modify: `/Users/yiboding/projects/circle-im/src/i18n/locales/zh.json`
  Add Chinese labels for icon management and circle icon actions.
- Modify: `/Users/yiboding/projects/circle-im/src/i18n/locales/en.json`
  Add English labels for the same keys.
- Create: `/Users/yiboding/projects/circle-im/test/icons-api.test.js`
  Static coverage for new API client paths.
- Create: `/Users/yiboding/projects/circle-im/test/my-icons-screen.test.js`
  Static coverage for the icon management screen.
- Modify: `/Users/yiboding/projects/circle-im/test/profile-screen-card.test.js`
  Assert shared `displayIcons` usage instead of local VIP/newbie derivation.
- Modify: `/Users/yiboding/projects/circle-im/test/user-profile-screen.test.js`
  Assert public profile renders the unified icon row.
- Modify: `/Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`
  Assert chat info renders compact icons.
- Modify: `/Users/yiboding/projects/circle-im/test/circle-detail-screen.test.js`
  Assert owner icon management affordances.

## Phase Split

- Phase 1: Backend schema, service, and profile DTO plumbing.
- Phase 2: Frontend shared icon rendering and icon management page.
- Phase 3: Circle owner icon management UI.

## Product Decisions Locked By This Plan

- Users can manually show or hide every eligible icon, including VIP and newcomer.
- A user can display at most 5 icons at once.
- Circle icon selections reference the circle, not a historical asset, so circle icon changes propagate automatically.
- Chat profile shows a compact icon row, but it reads from the same `displayIcons` data source as the larger profile screens.

### Task 1: Define backend behavior with failing tests

**Files:**
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.service.spec.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.service.spec.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/auth/__test__/auth.service.spec.ts`

- [ ] **Step 1: Write the failing icon eligibility test**

```ts
it('returns eligible system and circle icons and trims stale display selections', async () => {
  prisma.user.findUnique.mockResolvedValue({
    id: 'user-1',
    vipLevel: 5,
    createdAt: new Date(),
  });
  prisma.circleMember.findMany.mockResolvedValue([
    {
      circleID: 'circle-1',
      circle: {
        id: 'circle-1',
        name: 'Nbuuhbub',
        currentIconAsset: { id: 'asset-1', imageUrl: 'http://cdn/circle.png' },
      },
    },
  ]);
  prisma.userDisplayIcon.findMany.mockResolvedValue([
    { id: 'row-1', userID: 'user-1', displayType: 'SYSTEM', systemKey: 'VIP', circleID: null, sortOrder: 0 },
  ]);

  const result = await service.getIconOptions('user-1');

  expect(result.systemIcons).toHaveLength(2);
  expect(result.circleIcons[0].circleId).toBe('circle-1');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- icon.service.spec.ts --runInBand`
Expected: FAIL because the icon module and service do not exist.

- [ ] **Step 3: Write the failing circle owner test**

```ts
it('allows the circle owner to select the current circle icon', async () => {
  prisma.circle.findFirst.mockResolvedValue({
    id: 'circle-1',
    ownerID: 'owner-1',
    currentIconAssetID: null,
  });
  prisma.iconAsset.findFirst.mockResolvedValue({
    id: 'asset-1',
    sourceType: 'CIRCLE',
    circleID: 'circle-1',
  });

  await service.selectCircleIcon('owner-1', 'circle-1', { iconAssetId: 'asset-1' });

  expect(prisma.circle.update).toHaveBeenCalledWith({
    where: { id: 'circle-1' },
    data: { currentIconAssetID: 'asset-1' },
  });
});
```

- [ ] **Step 4: Run the circle service test to verify it fails**

Run: `npm test -- circle.service.spec.ts --runInBand`
Expected: FAIL because `selectCircleIcon` does not exist.

- [ ] **Step 5: Write the failing auth profile test**

```ts
it('includes displayIcons in me()', async () => {
  iconService.getDisplayIconsForUser.mockResolvedValue([
    { id: 'vip', type: 'SYSTEM', title: 'VIP5', imageUrl: null, fallbackIconName: 'diamond', sortOrder: 0 },
  ]);

  const me = await service.me('uuid-1');

  expect(me.displayIcons).toHaveLength(1);
  expect(me.displayIcons[0].title).toBe('VIP5');
});
```

- [ ] **Step 6: Run the auth service test to verify it fails**

Run: `npm test -- auth.service.spec.ts --runInBand`
Expected: FAIL because `displayIcons` is not returned.

### Task 2: Add Prisma schema and backend icon module

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/prisma/schema.prisma`
- Create: `/Users/yiboding/projects/circle_be/prisma/migrations/<timestamp>_unified_user_icons/migration.sql`
- Create: `/Users/yiboding/projects/circle_be/src/icon/dto/icon.dto.ts`
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.service.ts`
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.controller.ts`
- Create: `/Users/yiboding/projects/circle_be/src/icon/icon.module.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/app.module.ts`
- Test: `/Users/yiboding/projects/circle_be/src/icon/icon.service.spec.ts`

- [ ] **Step 1: Add Prisma enums and models**

```prisma
enum IconAssetSourceType {
  SYSTEM
  CIRCLE
}

enum UserDisplayIconType {
  SYSTEM
  CIRCLE
}

enum SystemIconKey {
  VIP
  NEW_USER
}

model IconAsset {
  id         String              @id @default(uuid())
  name       String
  sourceType IconAssetSourceType
  imageUrl   String
  circleID   String?
  createdByID String?
  createdAt  DateTime            @default(now())
  updatedAt  DateTime            @updatedAt
}

model UserDisplayIcon {
  id          String              @id @default(uuid())
  userID      String
  displayType UserDisplayIconType
  systemKey   SystemIconKey?
  circleID    String?
  sortOrder   Int
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
}
```

- [ ] **Step 2: Add the migration and seed built-in icon assets**

Run: `npx prisma migrate dev --name unified_user_icons`
Expected: migration files generated; seed insert statements for built-in system icons added to SQL if Prisma does not generate them automatically.

- [ ] **Step 3: Implement the icon DTOs and service**

```ts
async getIconOptions(userId: string) {
  const eligibility = await this.resolveEligibility(userId);
  await this.pruneInvalidSelections(userId, eligibility);
  return this.buildOptionsPayload(eligibility);
}

async updateDisplayIcons(userId: string, items: UpdateDisplayIconsItemDto[]) {
  this.assertSelectionLimit(items);
  const eligibility = await this.resolveEligibility(userId);
  this.assertItemsEligible(items, eligibility);
  return this.replaceSelections(userId, normalizeSortOrder(items));
}
```

- [ ] **Step 4: Wire the icon module into the app**

```ts
imports: [PrismaModule, IconModule, ...]
```

- [ ] **Step 5: Run the focused icon tests**

Run: `npm test -- icon.service.spec.ts --runInBand`
Expected: PASS

### Task 3: Add circle owner icon management and cleanup hooks

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.controller.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/circle/circle.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/circle/dto/circle.dto.ts`
- Test: `/Users/yiboding/projects/circle_be/src/circle/circle.service.spec.ts`

- [ ] **Step 1: Add owner-only upload/select DTO coverage**

```ts
@Post(':id/icon/upload')
uploadCircleIcon(@Param('id') id: string, @Body() dto: UploadCircleIconDto, @Req() req: any) {
  return this.circleService.uploadCircleIcon(req.user.userId, id, dto);
}

@Post(':id/icon/select')
selectCircleIcon(@Param('id') id: string, @Body() dto: SelectCircleIconDto, @Req() req: any) {
  return this.circleService.selectCircleIcon(req.user.userId, id, dto);
}
```

- [ ] **Step 2: Implement minimal owner authorization and circle update logic**

```ts
private async assertOwner(userId: string, circleId: string) {
  const circle = await this.prisma.circle.findFirst({ where: { id: circleId, deleted: false } });
  if (!circle) throw new NotFoundException('Circle not found');
  if (circle.ownerID !== userId) throw new ForbiddenException('Only the owner can manage circle icons');
  return circle;
}
```

- [ ] **Step 3: Remove circle display selections on leave**

```ts
await tx.userDisplayIcon.deleteMany({
  where: { userID: userId, circleID: circleId },
});
```

- [ ] **Step 4: Run the circle service tests**

Run: `npm test -- circle.service.spec.ts --runInBand`
Expected: PASS

### Task 4: Expose unified `displayIcons` on backend profiles

**Files:**
- Modify: `/Users/yiboding/projects/circle_be/src/auth/auth.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/user/user.service.ts`
- Modify: `/Users/yiboding/projects/circle_be/src/user/dto/public-user.dto.ts`
- Test: `/Users/yiboding/projects/circle_be/src/auth/__test__/auth.service.spec.ts`

- [ ] **Step 1: Extend DTOs with `displayIcons`**

```ts
@ApiProperty({ type: [DisplayIconDto] })
@Expose()
displayIcons: DisplayIconDto[];
```

- [ ] **Step 2: Inject `IconService` into auth and user services**

```ts
const [user, displayIcons] = await Promise.all([
  this.prisma.user.findUnique({ where: { id: userId }, select: ME_SELECT }),
  this.iconService.getDisplayIconsForUser(userId),
]);
return { ...user, displayIcons };
```

- [ ] **Step 3: Run the auth service test**

Run: `npm test -- auth.service.spec.ts --runInBand`
Expected: PASS

### Task 5: Define frontend API and rendering behavior with failing tests

**Files:**
- Create: `/Users/yiboding/projects/circle-im/test/icons-api.test.js`
- Create: `/Users/yiboding/projects/circle-im/test/my-icons-screen.test.js`
- Modify: `/Users/yiboding/projects/circle-im/test/profile-screen-card.test.js`
- Modify: `/Users/yiboding/projects/circle-im/test/user-profile-screen.test.js`
- Modify: `/Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`
- Modify: `/Users/yiboding/projects/circle-im/test/circle-detail-screen.test.js`

- [ ] **Step 1: Write the failing API client coverage**

```js
test('icons API uses the backend icon endpoints', () => {
  const src = read('src/services/api/icons.ts');
  assert.match(src, /\/icon\/options/);
  assert.match(src, /\/icon\/display/);
  assert.match(src, /fetchIconOptions/);
  assert.match(src, /updateDisplayIcons/);
});
```

- [ ] **Step 2: Run the API test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/icons-api.test.js`
Expected: FAIL because the file does not exist.

- [ ] **Step 3: Write the failing profile-screen test**

```js
test('ProfileScreen renders a shared display icon row from user.displayIcons', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.match(src, /user\?\.displayIcons/);
  assert.match(src, /UserIconRow/);
  assert.doesNotMatch(src, /rocket-outline/);
  assert.doesNotMatch(src, /Date\.now\(\) - accountCreatedAt/);
});
```

- [ ] **Step 4: Run the focused frontend tests to verify they fail**

Run: `node --test /Users/yiboding/projects/circle-im/test/profile-screen-card.test.js /Users/yiboding/projects/circle-im/test/icons-api.test.js`
Expected: FAIL because the shared component and API do not exist yet.

### Task 6: Add frontend icon types, APIs, and shared row component

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/auth.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/profile.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/utils.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/stores/authStore.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/types/index.ts`
- Create: `/Users/yiboding/projects/circle-im/src/services/api/icons.ts`
- Create: `/Users/yiboding/projects/circle-im/src/components/ui/user-icon-row.tsx`
- Test: `/Users/yiboding/projects/circle-im/test/icons-api.test.js`

- [ ] **Step 1: Extend frontend types**

```ts
export type DisplayIcon = {
  id: string;
  type: 'SYSTEM' | 'CIRCLE';
  title: string;
  imageUrl: string | null;
  fallbackIconName: keyof typeof Ionicons.glyphMap | null;
  circleId?: string;
  sortOrder: number;
};
```

- [ ] **Step 2: Add the icons API client**

```ts
export async function fetchIconOptions() {
  return apiClient<IconOptionsResponse>('/icon/options');
}

export async function updateDisplayIcons(items: UpdateDisplayIconsItem[]) {
  return apiClient<DisplayIcon[]>('/icon/display', {
    method: 'PUT',
    body: { items },
  });
}
```

- [ ] **Step 3: Add the shared row component**

```tsx
export function UserIconRow({ icons, compact = false }: Props) {
  const visibleIcons = compact ? icons.slice(0, 3) : icons;
  return <View>{visibleIcons.map(renderIcon)}</View>;
}
```

- [ ] **Step 4: Run the API and type checks**

Run: `node --test /Users/yiboding/projects/circle-im/test/icons-api.test.js`
Expected: PASS

### Task 7: Replace profile surfaces with shared `displayIcons`

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/profile/screens/ProfileScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/user/screens/UserProfileScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/chat/screens/ChatInfoScreen.tsx`
- Test: `/Users/yiboding/projects/circle-im/test/profile-screen-card.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/user-profile-screen.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`

- [ ] **Step 1: Replace local derivation in `ProfileScreen`**

```tsx
const displayIcons = user?.displayIcons ?? [];
<UserIconRow icons={displayIcons} />
```

- [ ] **Step 2: Add unified icons to `UserProfileScreen`**

```tsx
const profileIcons = profile.displayIcons ?? [];
<UserIconRow icons={profileIcons} />
```

- [ ] **Step 3: Add compact icons to chat info**

```tsx
<UserIconRow icons={profile.displayIcons ?? []} compact />
```

- [ ] **Step 4: Run the focused UI tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/profile-screen-card.test.js /Users/yiboding/projects/circle-im/test/user-profile-screen.test.js /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js`
Expected: PASS

### Task 8: Build the user icon management screen

**Files:**
- Create: `/Users/yiboding/projects/circle-im/src/features/profile/screens/MyIconsScreen.tsx`
- Create: `/Users/yiboding/projects/circle-im/app/(tabs)/profile/icons.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/profile/screens/ProfileScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/i18n/locales/zh.json`
- Modify: `/Users/yiboding/projects/circle-im/src/i18n/locales/en.json`
- Test: `/Users/yiboding/projects/circle-im/test/my-icons-screen.test.js`

- [ ] **Step 1: Write the failing management-screen assertion**

```js
test('MyIconsScreen loads icon options and enforces the 5 icon limit', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');
  assert.match(src, /fetchIconOptions/);
  assert.match(src, /updateDisplayIcons/);
  assert.match(src, /最多展示 5 个图标/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/my-icons-screen.test.js`
Expected: FAIL because the screen does not exist.

- [ ] **Step 3: Implement the minimal screen**

```tsx
const [selected, setSelected] = useState<DisplayIconDraft[]>([]);
const canAddMore = selected.length < 5;
```

- [ ] **Step 4: Link the screen from `ProfileScreen`**

```tsx
router.push('/(tabs)/profile/icons' as never);
```

- [ ] **Step 5: Run the management-screen test**

Run: `node --test /Users/yiboding/projects/circle-im/test/my-icons-screen.test.js`
Expected: PASS

### Task 9: Add circle owner icon management on the frontend

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/services/api/circles.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/features/discover/screens/CircleDetailScreen.tsx`
- Test: `/Users/yiboding/projects/circle-im/test/circle-detail-screen.test.js`

- [ ] **Step 1: Write the failing circle-detail assertion**

```js
test('CircleDetailScreen exposes owner-only circle icon actions', () => {
  const src = read('src/features/discover/screens/CircleDetailScreen.tsx');
  assert.match(src, /uploadCircleIcon/);
  assert.match(src, /selectCircleIcon/);
  assert.match(src, /圈子图标/);
});
```

- [ ] **Step 2: Run the circle-detail test to verify it fails**

Run: `node --test /Users/yiboding/projects/circle-im/test/circle-detail-screen.test.js`
Expected: FAIL because icon management is not rendered.

- [ ] **Step 3: Add the circle icon APIs**

```ts
export async function uploadCircleIcon(id: string, imageUrl: string) {
  return apiClient(`/circle/${id}/icon/upload`, { method: 'POST', body: { imageUrl } });
}
```

- [ ] **Step 4: Add owner-only UI in `CircleDetailScreen`**

```tsx
{isOwnerOrAdmin ? (
  <MenuRow label={t('circle.icon')} onPress={handleOpenCircleIconPicker} />
) : null}
```

- [ ] **Step 5: Run the circle-detail test**

Run: `node --test /Users/yiboding/projects/circle-im/test/circle-detail-screen.test.js`
Expected: PASS

### Task 10: Full verification

**Files:**
- No code changes

- [ ] **Step 1: Run backend focused tests**

Run: `npm test -- icon.service.spec.ts circle.service.spec.ts auth.service.spec.ts --runInBand`
Expected: PASS

- [ ] **Step 2: Run backend build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Run frontend focused tests**

Run: `node --test /Users/yiboding/projects/circle-im/test/icons-api.test.js /Users/yiboding/projects/circle-im/test/my-icons-screen.test.js /Users/yiboding/projects/circle-im/test/profile-screen-card.test.js /Users/yiboding/projects/circle-im/test/user-profile-screen.test.js /Users/yiboding/projects/circle-im/test/chat-info-screen.test.js /Users/yiboding/projects/circle-im/test/circle-detail-screen.test.js`
Expected: PASS

- [ ] **Step 4: Run frontend type check**

Run: `npx tsc --noEmit`
Expected: PASS
