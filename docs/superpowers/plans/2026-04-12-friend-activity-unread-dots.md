# Friend Activity Unread Dots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the existing contacts-tab red dot and add the same unread friend-activity red dot to the `新的朋友` quick-action row, with both indicators driven by one shared frontend unread source.

**Architecture:** Add a tiny Zustand store dedicated to friend-activity unread count so `app/(tabs)/_layout.tsx`, `ContactsScreen.tsx`, and `NewFriendsScreen.tsx` can read and update the same state. Keep the UI change minimal by extending `MenuRow` with a small right-side dot option instead of introducing a second quick-action row component.

**Tech Stack:** Expo Router, React Native, Zustand, existing `apiClient` helpers, Node `node:test`, TypeScript.

---

## File Structure

- Create: `/Users/yiboding/projects/circle-im/src/stores/friendActivityUnreadStore.ts`
- Modify: `/Users/yiboding/projects/circle-im/src/components/ui/menu-row.tsx`
- Modify: `/Users/yiboding/projects/circle-im/app/(tabs)/_layout.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/ContactsScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/NewFriendsScreen.tsx`
- Test: `/Users/yiboding/projects/circle-im/test/friend-activity-unread-store.test.js`
- Test: `/Users/yiboding/projects/circle-im/test/contacts-screen.test.js`

### Task 1: Shared Friend Activity Unread Store

**Files:**
- Create: `/Users/yiboding/projects/circle-im/src/stores/friendActivityUnreadStore.ts`
- Test: `/Users/yiboding/projects/circle-im/test/friend-activity-unread-store.test.js`

- [ ] **Step 1: Write the failing store tests**

```js
test('friend activity unread store refreshes count from API and decrements after marking read', async () => {
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: async () => 3,
      },
    },
  );

  await useFriendActivityUnreadStore.getState().refresh();
  assert.equal(useFriendActivityUnreadStore.getState().count, 3);

  useFriendActivityUnreadStore.getState().markRead(['a-1', 'a-2']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/friend-activity-unread-store.test.js`  
Expected: FAIL because the store file does not exist yet.

- [ ] **Step 3: Write minimal store implementation**

```ts
export const useFriendActivityUnreadStore = create<FriendActivityUnreadState>(
  (set, get) => ({
    count: 0,
    refresh: async () => {
      const count = await fetchUnreadFriendActivityCount();
      set({ count });
    },
    markRead: (activityIds) =>
      set((state) => ({
        count: Math.max(0, state.count - activityIds.length),
      })),
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/friend-activity-unread-store.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/stores/friendActivityUnreadStore.ts test/friend-activity-unread-store.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: add friend activity unread store"
```

### Task 2: Source Tests For Shared Red Dot Wiring

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/test/contacts-screen.test.js`

- [ ] **Step 1: Write the failing source assertions**

```js
test('contacts unread indicators use the shared unread store', () => {
  const tabsLayoutSource = read('app/(tabs)/_layout.tsx');
  const contactsSource = read('src/features/contacts/screens/ContactsScreen.tsx');
  const menuRowSource = read('src/components/ui/menu-row.tsx');
  const inboxSource = read('src/features/contacts/screens/NewFriendsScreen.tsx');

  assert.match(tabsLayoutSource, /useFriendActivityUnreadStore/);
  assert.match(contactsSource, /useFriendActivityUnreadStore/);
  assert.match(contactsSource, /showIndicatorDot/);
  assert.match(menuRowSource, /showIndicatorDot/);
  assert.match(inboxSource, /markRead/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/contacts-screen.test.js`  
Expected: FAIL because the screens still fetch and manage unread state independently.

- [ ] **Step 3: Keep the assertions narrow**

```js
assert.doesNotMatch(contactsSource, /fetchUnreadFriendActivityCount/);
assert.doesNotMatch(tabsLayoutSource, /const \[unreadFriendActivityCount, setUnreadFriendActivityCount\]/);
```

- [ ] **Step 4: Run test to verify the new failure is stable**

Run: `node --test test/contacts-screen.test.js`  
Expected: FAIL on the new shared-store assertions, not on unrelated source text.

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add test/contacts-screen.test.js
git -C /Users/yiboding/projects/circle-im commit -m "test: cover shared friend activity unread indicators"
```

### Task 3: Tab And Contacts Quick-Action Red Dots

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/components/ui/menu-row.tsx`
- Modify: `/Users/yiboding/projects/circle-im/app/(tabs)/_layout.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/ContactsScreen.tsx`

- [ ] **Step 1: Implement the smallest `MenuRow` extension**

```ts
interface MenuRowProps {
  showIndicatorDot?: boolean;
}
```

```tsx
{showIndicatorDot ? <View style={[s.indicatorDot, d.indicatorDot]} /> : null}
{showArrow ? <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} /> : null}
```

- [ ] **Step 2: Switch the tabs layout to the shared unread store**

```ts
const unreadFriendActivityCount = useFriendActivityUnreadStore((state) => state.count);
const refreshUnreadFriendActivityCount = useFriendActivityUnreadStore((state) => state.refresh);

useEffect(() => {
  void refreshUnreadFriendActivityCount();
}, [refreshUnreadFriendActivityCount, segments]);
```

- [ ] **Step 3: Read the same store in `ContactsScreen`**

```ts
const unreadFriendActivityCount = useFriendActivityUnreadStore((state) => state.count);
const refreshUnreadFriendActivityCount = useFriendActivityUnreadStore((state) => state.refresh);
```

```tsx
useFocusEffect(
  useCallback(() => {
    void refreshUnreadFriendActivityCount();
  }, [refreshUnreadFriendActivityCount]),
);

<MenuRow
  icon={action.icon}
  iconBgColor={action.iconBg}
  label={action.label}
  showIndicatorDot={action.label === '新的朋友' && unreadFriendActivityCount > 0}
  onPress={() => handleQuickActionPress(action.label)}
/>
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `node --test test/contacts-screen.test.js test/friend-activity-unread-store.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/components/ui/menu-row.tsx 'app/(tabs)/_layout.tsx' src/features/contacts/screens/ContactsScreen.tsx test/contacts-screen.test.js test/friend-activity-unread-store.test.js
git -C /Users/yiboding/projects/circle-im commit -m "feat: share friend activity red dots across contacts"
```

### Task 4: Sync Inbox Read Actions Back To Shared State

**Files:**
- Modify: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/NewFriendsScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/src/features/contacts/screens/ContactsScreen.tsx`
- Modify: `/Users/yiboding/projects/circle-im/app/(tabs)/_layout.tsx`

- [ ] **Step 1: Wire `NewFriendsScreen` into the store**

```ts
const markRead = useFriendActivityUnreadStore((state) => state.markRead);
const refreshUnreadFriendActivityCount = useFriendActivityUnreadStore((state) => state.refresh);
```

- [ ] **Step 2: Update local unread count immediately after best-effort read marking**

```ts
if (item.unreadActivityIds.length > 0) {
  await Promise.all(
    item.unreadActivityIds.map((activityId) =>
      markFriendActivityRead(activityId).catch(() => {}),
    ),
  );
  markRead(item.unreadActivityIds);
}
```

- [ ] **Step 3: Keep focus-based resync in place**

```ts
useFocusEffect(
  useCallback(() => {
    void refreshUnreadFriendActivityCount();
  }, [refreshUnreadFriendActivityCount]),
);
```

- [ ] **Step 4: Run tests and typecheck**

Run: `node --test test/friend-activity-unread-store.test.js test/contacts-screen.test.js test/friend-activities.test.js`  
Expected: PASS

Run: `npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /Users/yiboding/projects/circle-im add src/features/contacts/screens/NewFriendsScreen.tsx src/features/contacts/screens/ContactsScreen.tsx 'app/(tabs)/_layout.tsx'
git -C /Users/yiboding/projects/circle-im commit -m "feat: sync friend activity unread state after inbox reads"
```

### Task 5: Final Verification

**Files:**
- Verify the files above

- [ ] **Step 1: Run the targeted frontend tests**

Run: `node --test test/friend-activity-unread-store.test.js test/friend-activities.test.js test/contacts-screen.test.js test/contact-friends.test.js test/add-friend-screen.test.js test/user-profile-screen.test.js`  
Expected: PASS

- [ ] **Step 2: Run frontend typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 3: Manual verification**

Verify:
- the contacts tab still shows a red dot when unread friend activities exist
- the `新的朋友` quick-action row shows the same red dot at the same time
- opening an unread inbox row clears both indicators without manually revisiting the contacts page
- revisiting the contacts stack resyncs unread state from `/friend/activities/unread-count`
