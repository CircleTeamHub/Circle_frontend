# Contacts And Friends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mocked contacts flow with backend-backed friends, tags, recent friends, and account-based add-friend search.

**Architecture:** Add a small friend-domain API and mapping layer under `src/services/api` and `src/features/contacts`, then wire the contacts tab, new-friends page, tags pages, add-friend page, and user profile relationship actions to that shared layer. Keep sorting, grouping, exact account matching, and friend-status derivation in pure helpers so the screens stay focused on rendering and navigation.

**Tech Stack:** Expo Router, React Native, existing `apiClient`, Node `node:test` source assertions, TypeScript.

---

## File Structure

- Modify: `src/features/contacts/screens/ContactsScreen.tsx`  
  Replace mocked list data with real friends loading, quick-action navigation, and grouped sections.
- Create: `src/features/contacts/contact-friends.ts`  
  Pure helpers for display-name selection, alphabetical grouping, recent-friends sorting, and tag sorting.
- Create: `src/features/contacts/screens/NewFriendsScreen.tsx`  
  Render recently added successful friends from the same friend list source.
- Create: `src/features/contacts/screens/FriendTagsScreen.tsx`  
  Render tag list and navigate to tag detail.
- Create: `src/features/contacts/screens/FriendTagDetailScreen.tsx`  
  Render one tag's friends alphabetically.
- Modify: `src/features/social/screens/AddFriendScreen.tsx`  
  Replace placeholder menu with account search, result card, empty state, and error state.
- Modify: `src/features/user/screens/UserProfileScreen.tsx`  
  Load friend status for non-self profiles and send friend request from profile page.
- Create: `src/services/api/friends.ts`  
  Friend list, status, request, and tags API helpers plus normalized frontend types.
- Create: `src/services/api/users.ts`  
  Account-based user search helper that prefers exact `accountId`.
- Create: `app/(tabs)/contacts/new-friends.tsx`
- Create: `app/(tabs)/contacts/tags.tsx`
- Create: `app/(tabs)/contacts/tags/[id].tsx`
- Test: `test/contact-friends.test.js`
- Test: `test/contacts-screen.test.js`
- Test: `test/add-friend-screen.test.js`
- Test: `test/user-profile-screen.test.js`

### Task 1: Friend Domain API And Mapper Layer

**Files:**
- Create: `src/services/api/friends.ts`
- Create: `src/services/api/users.ts`
- Create: `src/features/contacts/contact-friends.ts`
- Test: `test/contact-friends.test.js`

- [ ] **Step 1: Write the failing mapper and exact-match tests**

```js
test('buildContactSections groups normalized friends by letter and pushes unsupported initials into #', () => {
  const { buildContactSections } = loadContactFriends();
  const sections = buildContactSections([
    { id: '1', nickname: 'Alice', accountId: 'alice', friendsSince: '2026-04-08T10:00:00.000Z' },
    { id: '2', nickname: '张三', accountId: 'zhangsan', friendsSince: '2026-04-07T10:00:00.000Z' },
  ]);

  assert.deepEqual(sections.map((section) => section.title), ['A', '#']);
});

test('pickExactAccountMatch prefers case-insensitive exact accountId matches over partial matches', () => {
  const { pickExactAccountMatch } = loadUsersApi();
  const match = pickExactAccountMatch(
    'ACC_100',
    [{ accountId: 'ACC_1000' }, { accountId: 'acc_100' }],
  );

  assert.equal(match.accountId, 'acc_100');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/contact-friends.test.js`  
Expected: FAIL because helper modules or exported functions do not exist yet.

- [ ] **Step 3: Write minimal API and mapper implementation**

```ts
export function getFriendDisplayName(friend: FriendProfile) {
  return friend.nickname?.trim() || friend.accountId;
}

export function buildRecentFriends(friends: FriendProfile[]) {
  return [...friends].sort(
    (left, right) =>
      new Date(right.friendsSince).getTime() - new Date(left.friendsSince).getTime(),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/contact-friends.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/contact-friends.test.js src/features/contacts/contact-friends.ts src/services/api/friends.ts src/services/api/users.ts
git commit -m "feat: add friend domain helpers"
```

### Task 2: Contacts Tab And Recent Friends Screen

**Files:**
- Modify: `src/features/contacts/screens/ContactsScreen.tsx`
- Create: `src/features/contacts/screens/NewFriendsScreen.tsx`
- Create: `app/(tabs)/contacts/new-friends.tsx`
- Modify: `src/features/contacts/index.ts`
- Test: `test/contacts-screen.test.js`

- [ ] **Step 1: Write the failing contacts screen source tests**

```js
test('contacts screen navigates quick actions and renders friend-backed sections', () => {
  const source = fs.readFileSync(contactsScreenPath, 'utf8');

  assert.match(source, /fetchFriends/);
  assert.match(source, /router\\.push\\(\"\\/\\(tabs\\)\\/contacts\\/new-friends\"\\)/);
  assert.match(source, /buildContactSections/);
  assert.doesNotMatch(source, /CONTACT_SECTIONS/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/contacts-screen.test.js`  
Expected: FAIL because the screen is still wired to mocked data.

- [ ] **Step 3: Write minimal contacts and recent-friends implementation**

```ts
useEffect(() => {
  fetchFriends()
    .then((nextFriends) => {
      setFriends(nextFriends);
      setError(null);
    })
    .catch(() => setError('联系人加载失败，请稍后重试'));
    .finally(() => setLoading(false));
}, []);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/contacts-screen.test.js test/contact-friends.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/contacts-screen.test.js src/features/contacts/screens/ContactsScreen.tsx src/features/contacts/screens/NewFriendsScreen.tsx app/(tabs)/contacts/new-friends.tsx src/features/contacts/index.ts
git commit -m "feat: load real contacts and recent friends"
```

### Task 3: Tags List And Tag Detail

**Files:**
- Create: `src/features/contacts/screens/FriendTagsScreen.tsx`
- Create: `src/features/contacts/screens/FriendTagDetailScreen.tsx`
- Create: `app/(tabs)/contacts/tags.tsx`
- Create: `app/(tabs)/contacts/tags/[id].tsx`
- Modify: `src/features/contacts/index.ts`
- Test: `test/contacts-screen.test.js`

- [ ] **Step 1: Extend tests to cover tag route wiring and tag detail loading**

```js
test('contacts quick actions include a tags route and dedicated tag detail screen', () => {
  const contactsSource = fs.readFileSync(contactsScreenPath, 'utf8');
  const tagsSource = fs.readFileSync(friendTagsScreenPath, 'utf8');

  assert.match(contactsSource, /router\\.push\\(\"\\/\\(tabs\\)\\/contacts\\/tags\"\\)/);
  assert.match(tagsSource, /fetchFriendTags/);
  assert.match(tagsSource, /fetchFriendsByTag/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/contacts-screen.test.js`  
Expected: FAIL because tags screens and routes do not exist.

- [ ] **Step 3: Write minimal tags implementation**

```ts
const [tags, setTags] = useState<FriendTag[]>([]);

useEffect(() => {
  fetchFriendTags().then(setTags).catch(() => setError('标签加载失败，请稍后重试'));
}, []);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/contacts-screen.test.js test/contact-friends.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/contacts-screen.test.js src/features/contacts/screens/FriendTagsScreen.tsx src/features/contacts/screens/FriendTagDetailScreen.tsx app/(tabs)/contacts/tags.tsx app/(tabs)/contacts/tags/[id].tsx src/features/contacts/index.ts
git commit -m "feat: add friend tag browsing"
```

### Task 4: Add-Friend Account Search

**Files:**
- Modify: `src/features/social/screens/AddFriendScreen.tsx`
- Create: `src/services/api/users.ts`
- Test: `test/add-friend-screen.test.js`

- [ ] **Step 1: Write the failing add-friend source tests**

```js
test('add friend screen searches by accountId and shows not-found state', () => {
  const source = fs.readFileSync(addFriendScreenPath, 'utf8');

  assert.match(source, /searchUsersByAccountId/);
  assert.match(source, /未找到好友/);
  assert.doesNotMatch(source, /雷达加友/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/add-friend-screen.test.js`  
Expected: FAIL because the screen is still the static menu version.

- [ ] **Step 3: Write minimal search implementation**

```ts
const handleSearch = async () => {
  const result = await searchUsersByAccountId(keyword);
  setResult(result);
  setStatus(result ? 'result' : 'not-found');
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/add-friend-screen.test.js test/contact-friends.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/add-friend-screen.test.js src/features/social/screens/AddFriendScreen.tsx src/services/api/users.ts
git commit -m "feat: add account-based friend search"
```

### Task 5: User Profile Friend Status And Add Request Action

**Files:**
- Modify: `src/features/user/screens/UserProfileScreen.tsx`
- Modify: `src/features/user/profile-view.ts`
- Modify: `test/user-profile-screen.test.js`

- [ ] **Step 1: Write the failing profile relationship tests**

```js
test('user profile screen loads friend status and sends friend requests only for non-self profiles', () => {
  const source = fs.readFileSync(userProfileScreenPath, 'utf8');

  assert.match(source, /fetchFriendStatus/);
  assert.match(source, /createFriendRequest/);
  assert.match(source, /friendStatus/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/user-profile-screen.test.js`  
Expected: FAIL because the profile screen does not load status or send requests yet.

- [ ] **Step 3: Write minimal relationship-action implementation**

```ts
if (!isCurrentUser) {
  fetchFriendStatus(profileId).then(setFriendStatus).catch(() => setFriendStatus('NONE'));
}

const handleAddFriend = async () => {
  await createFriendRequest(profileId);
  setFriendStatus('PENDING_OUTGOING');
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/user-profile-screen.test.js test/contact-friends.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/user-profile-screen.test.js src/features/user/screens/UserProfileScreen.tsx src/features/user/profile-view.ts
git commit -m "feat: wire profile friend actions"
```

### Final Verification

**Files:**
- Verify all touched files above

- [ ] **Step 1: Run focused test suite**

Run: `node --test test/contact-friends.test.js test/contacts-screen.test.js test/add-friend-screen.test.js test/user-profile-screen.test.js`  
Expected: PASS

- [ ] **Step 2: Run existing API and profile tests that might regress**

Run: `node --test test/profile-api.test.js test/api-utils.test.js test/auth-api.test.js`  
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`  
Expected: PASS

- [ ] **Step 4: Manual verification**

Run the app and verify:
- Contacts tab shows accepted friends grouped by letter
- 新的朋友 shows recent successful friends sorted by `friendsSince`
- 标签 list opens tag detail pages
- Add friend screen finds exact `accountId` matches and shows `未找到好友`
- User profile page sends friend request and updates button state

- [ ] **Step 5: Final commit**

```bash
git add src app test docs/superpowers/plans/2026-04-08-contacts-friends.md
git commit -m "feat: implement real contacts and friend search flow"
```
