import test from 'node:test';
import assert from 'node:assert/strict';

test('group member permission policy is available', async () => {
  let policy: typeof import('./group-member-permissions.ts') | undefined;

  try {
    policy = await import('./group-member-permissions.ts');
  } catch {
    policy = undefined;
  }

  assert.equal(typeof policy?.canViewGroupMembers, 'function');
  assert.equal(typeof policy?.canChangeGroupMemberRole, 'function');
});

test('only owners and administrators can view the group member directory', async () => {
  const { canViewGroupMembers } = await import('./group-member-permissions.ts');

  assert.equal(canViewGroupMembers(100), true);
  assert.equal(canViewGroupMembers(60), true);
  assert.equal(canViewGroupMembers(20), false);
  assert.equal(canViewGroupMembers(undefined), false);
});

test('circle member directory follows the same owner/admin policy', async () => {
  const policy = await import('./group-member-permissions.ts');
  assert.equal(typeof (policy as any).canViewCircleMembers, 'function');

  assert.equal((policy as any).canViewCircleMembers('OWNER'), true);
  assert.equal((policy as any).canViewCircleMembers('ADMIN'), true);
  assert.equal((policy as any).canViewCircleMembers('MEMBER'), false);
  assert.equal((policy as any).canViewCircleMembers(null), false);
});

test('only the owner can change a non-owner member role', async () => {
  const { canChangeGroupMemberRole } = await import('./group-member-permissions.ts');

  assert.equal(canChangeGroupMemberRole(100, 20), true);
  assert.equal(canChangeGroupMemberRole(100, 60), true);
  assert.equal(canChangeGroupMemberRole(60, 20), false);
  assert.equal(canChangeGroupMemberRole(20, 20), false);
  assert.equal(canChangeGroupMemberRole(100, 100), false);
});

test('revalidation grants access only for live owner/admin roles', async () => {
  const { revalidateGroupMemberView } = await import('./group-member-permissions.ts');

  assert.equal(
    await revalidateGroupMemberView({ loadSelfMember: async () => ({ roleLevel: 100 }) }),
    true,
  );
  assert.equal(
    await revalidateGroupMemberView({ loadSelfMember: async () => ({ roleLevel: 60 }) }),
    true,
  );
  assert.equal(
    await revalidateGroupMemberView({ loadSelfMember: async () => ({ roleLevel: 20 }) }),
    false,
  );
});

test('revalidation fails closed when the membership lookup breaks', async () => {
  const { revalidateGroupMemberView } = await import('./group-member-permissions.ts');

  // 已不在群里（查无成员记录）→ 无权。
  assert.equal(
    await revalidateGroupMemberView({ loadSelfMember: async () => null }),
    false,
  );
  // 查询抛错（断网 / SDK 未就绪）→ 无权，绝不放行。
  assert.equal(
    await revalidateGroupMemberView({
      loadSelfMember: async () => {
        throw new Error('sdk offline');
      },
    }),
    false,
  );
});

test('ordinary members never trigger the full member-directory loader', async () => {
  const policy = await import('./group-member-permissions.ts');
  assert.equal(typeof (policy as any).loadAuthorizedGroupMembers, 'function');
  let fullDirectoryLoads = 0;

  const result = await (policy as any).loadAuthorizedGroupMembers({
    loadCurrentMember: async () => ({ userID: 'self', roleLevel: 20 }),
    loadMembers: async () => {
      fullDirectoryLoads += 1;
      return [{ userID: 'other', roleLevel: 20 }];
    },
  });

  assert.equal(fullDirectoryLoads, 0);
  assert.deepEqual(result, {
    currentMember: { userID: 'self', roleLevel: 20 },
    members: [],
    authorized: false,
  });
});

test('owners and administrators load the full member directory', async () => {
  const policy = await import('./group-member-permissions.ts');
  assert.equal(typeof (policy as any).loadAuthorizedGroupMembers, 'function');

  for (const roleLevel of [60, 100]) {
    const members = [{ userID: 'other', roleLevel: 20 }];
    const result = await (policy as any).loadAuthorizedGroupMembers({
      loadCurrentMember: async () => ({ userID: 'self', roleLevel }),
      loadMembers: async () => members,
    });

    assert.equal(result.authorized, true);
    assert.equal(result.members, members);
  }
});
