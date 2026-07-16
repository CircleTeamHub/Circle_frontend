import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveManagedCircles,
  getJoinedCirclesNeedingRoleFallback,
} from './managed-circles.ts';

test('deriveManagedCircles keeps created circles and adds joined circles the user administers', () => {
  const createdCircles = [
    { id: 'created-1', name: 'Created One' },
    { id: 'created-2', name: 'Created Two' },
  ];
  // 加入的圈子自带 myRole（GET /circle/my 直接返回），无需逐个拉详情。
  const joinedCircles = [
    { id: 'created-2', name: 'Created Two', myRole: 'ADMIN' as const },
    { id: 'joined-admin', name: 'Joined Admin', myRole: 'ADMIN' as const },
    { id: 'joined-member', name: 'Joined Member', myRole: 'MEMBER' as const },
  ];

  const managedCircles = deriveManagedCircles({
    createdCircles,
    joinedCircles,
  });

  assert.deepEqual(
    managedCircles.map((circle) => circle.id),
    ['created-1', 'created-2', 'joined-admin'],
  );
});

test('deriveManagedCircles does not treat an unknown role as managed', () => {
  // 老后端不返回 myRole 时宁可漏（不显示在「我管理的」），也不能误判成管理员。
  const managedCircles = deriveManagedCircles({
    createdCircles: [],
    joinedCircles: [
      { id: 'no-role' },
      { id: 'null-role', myRole: null },
      { id: 'member', myRole: 'MEMBER' as const },
    ],
  });

  assert.deepEqual(managedCircles, []);
});

test('deriveManagedCircles uses detail roles when the joined list omits myRole', () => {
  const joinedCircles = [{ id: 'legacy-admin', name: 'Legacy Admin' }];

  const managedCircles = deriveManagedCircles({
    createdCircles: [],
    joinedCircles,
    joinedCircleDetails: [{ id: 'legacy-admin', myRole: 'ADMIN' as const }],
  });

  assert.deepEqual(managedCircles, joinedCircles);
});

test('role fallback only fetches details for joined rows without myRole', () => {
  const candidates = [
    { id: 'missing' },
    { id: 'null', myRole: null },
    { id: 'admin', myRole: 'ADMIN' as const },
    { id: 'member', myRole: 'MEMBER' as const },
  ];

  assert.deepEqual(
    getJoinedCirclesNeedingRoleFallback(candidates).map((circle) => circle.id),
    ['missing', 'null'],
  );
});
