import test from 'node:test';
import assert from 'node:assert/strict';

test('circle member directory follows the same owner/admin policy', async () => {
  const policy = await import('./group-member-permissions.ts');
  assert.equal(typeof (policy as any).canViewCircleMembers, 'function');

  assert.equal((policy as any).canViewCircleMembers('OWNER'), true);
  assert.equal((policy as any).canViewCircleMembers('ADMIN'), true);
  assert.equal((policy as any).canViewCircleMembers('MEMBER'), false);
  assert.equal((policy as any).canViewCircleMembers(null), false);
});
