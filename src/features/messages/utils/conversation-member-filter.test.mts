import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterConversationMembers,
  toggleFilteredConversationMembers,
} from './conversation-member-filter.ts';

const conversations = [
  { id: 'group-work', name: 'Work Team', conversationType: 'group' as const },
  { id: 'group-family', name: 'Family', conversationType: 'group' as const },
  { id: 'direct-alice', name: 'Alice', conversationType: 'private' as const },
];

test('conversation member filtering combines name search and chat type', () => {
  assert.deepEqual(
    filterConversationMembers(
      conversations,
      'group',
      '  WORK  ',
      new Set(),
    ).map((conversation) => conversation.id),
    ['group-work'],
  );
});

test('selected filter only returns conversations already in the custom group', () => {
  assert.deepEqual(
    filterConversationMembers(
      conversations,
      'selected',
      '',
      new Set(['group-family', 'direct-alice']),
    ).map((conversation) => conversation.id),
    ['group-family', 'direct-alice'],
  );
});

test('bulk select deduplicates current and visible conversation ids', () => {
  assert.deepEqual(
    toggleFilteredConversationMembers(
      ['group-family', 'direct-alice'],
      ['group-work', 'group-family'],
      true,
    ),
    ['group-family', 'direct-alice', 'group-work'],
  );
});

test('bulk deselect preserves selected conversations outside current results', () => {
  assert.deepEqual(
    toggleFilteredConversationMembers(
      ['group-work', 'group-family', 'direct-alice'],
      ['group-work', 'group-family'],
      false,
    ),
    ['direct-alice'],
  );
});
