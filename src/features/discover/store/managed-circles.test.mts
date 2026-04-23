import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveManagedCircles } from './managed-circles.ts';

test('deriveManagedCircles keeps created circles and adds joined circles with admin privileges', () => {
  const createdCircles = [
    { id: 'created-1', name: 'Created One' },
    { id: 'created-2', name: 'Created Two' },
  ];
  const joinedCircles = [
    { id: 'created-2', name: 'Created Two' },
    { id: 'joined-admin', name: 'Joined Admin' },
    { id: 'joined-member', name: 'Joined Member' },
  ];
  const joinedCircleDetails = [
    { id: 'joined-admin', myRole: 'ADMIN' as const },
    { id: 'joined-member', myRole: 'MEMBER' as const },
  ];

  const managedCircles = deriveManagedCircles({
    createdCircles,
    joinedCircles,
    joinedCircleDetails,
  });

  assert.deepEqual(
    managedCircles.map((circle) => circle.id),
    ['created-1', 'created-2', 'joined-admin'],
  );
});
