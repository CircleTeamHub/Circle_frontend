import test from 'node:test';
import assert from 'node:assert/strict';

test('owner can manage admins and members; admins only members; nobody the owner', async () => {
  const { canManageGroupTarget } = await import('./group-admin-permissions.ts');

  assert.equal(canManageGroupTarget('OWNER', 'ADMIN'), true);
  assert.equal(canManageGroupTarget('OWNER', 'MEMBER'), true);
  assert.equal(canManageGroupTarget('OWNER', 'OWNER'), false);
  assert.equal(canManageGroupTarget('ADMIN', 'MEMBER'), true);
  assert.equal(canManageGroupTarget('ADMIN', 'ADMIN'), false);
  assert.equal(canManageGroupTarget('ADMIN', 'OWNER'), false);
  assert.equal(canManageGroupTarget('MEMBER', 'MEMBER'), false);
  assert.equal(canManageGroupTarget(null, 'MEMBER'), false);
  assert.equal(canManageGroupTarget('OWNER', null), false);
});

test('only the owner assigns roles, never to the owner seat', async () => {
  const { canAssignGroupRole } = await import('./group-admin-permissions.ts');

  assert.equal(canAssignGroupRole('OWNER', 'MEMBER'), true);
  assert.equal(canAssignGroupRole('OWNER', 'ADMIN'), true);
  assert.equal(canAssignGroupRole('OWNER', 'OWNER'), false);
  assert.equal(canAssignGroupRole('ADMIN', 'MEMBER'), false);
  assert.equal(canAssignGroupRole('OWNER', null), false);
});

test('standalone self role prefers the directory and falls back to ownerId', async () => {
  const { resolveStandaloneSelfRole } = await import('./group-admin-permissions.ts');

  const members = [
    { userId: 'owner', role: 'OWNER' as const },
    { userId: 'admin', role: 'ADMIN' as const },
    { userId: 'legacy', role: null },
  ];
  assert.equal(
    resolveStandaloneSelfRole({ members, currentUserID: 'admin', ownerId: 'owner' }),
    'ADMIN',
  );
  // 老后端不返角色:ownerId 兜底认群主,其余在座成员是普通成员。
  assert.equal(
    resolveStandaloneSelfRole({ members, currentUserID: 'legacy', ownerId: 'legacy' }),
    'OWNER',
  );
  assert.equal(
    resolveStandaloneSelfRole({ members, currentUserID: 'legacy', ownerId: 'owner' }),
    'MEMBER',
  );
  // 目录里没有自己(还没加载 / 已不在群):除非 ownerId 指向自己,否则无角色。
  assert.equal(
    resolveStandaloneSelfRole({ members: [], currentUserID: 'owner', ownerId: 'owner' }),
    'OWNER',
  );
  assert.equal(
    resolveStandaloneSelfRole({ members: [], currentUserID: 'x', ownerId: 'owner' }),
    null,
  );
  assert.equal(
    resolveStandaloneSelfRole({ members, currentUserID: null, ownerId: 'owner' }),
    null,
  );
});
