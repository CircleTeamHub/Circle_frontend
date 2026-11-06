import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageChatPins } from './chat-pins.ts';

test('both sides of a private chat can pin', () => {
  assert.equal(canManageChatPins({ type: 'DIRECT', myRole: null }), true);
});

test('only owners and admins pin in a group', () => {
  assert.equal(canManageChatPins({ type: 'GROUP', myRole: 'OWNER' }), true);
  assert.equal(canManageChatPins({ type: 'GROUP', myRole: 'ADMIN' }), true);
  assert.equal(canManageChatPins({ type: 'GROUP', myRole: 'MEMBER' }), false);
  assert.equal(canManageChatPins({ type: 'GROUP', myRole: null }), false);
});

test('temporary rooms and the assistant have no pins', () => {
  assert.equal(canManageChatPins({ type: 'TEMP', myRole: 'OWNER' }), false);
  assert.equal(canManageChatPins({ type: 'SUPPORT', myRole: null }), false);
});
