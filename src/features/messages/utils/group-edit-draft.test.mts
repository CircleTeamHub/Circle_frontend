import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_GROUP_DRAFT,
  diffGroupDraft,
  hasGroupDraftChanges,
} from './group-edit-draft.ts';

const saved = {
  name: '家人',
  pinnedToTabs: true,
  conversationIDs: ['c-1', 'c-2'],
};

test('an untouched draft has nothing to save', () => {
  const changes = diffGroupDraft(saved, { ...saved, conversationIDs: ['c-2', 'c-1'] });
  assert.deepEqual(changes, { patch: {}, conversationIDs: null });
  assert.equal(hasGroupDraftChanges(changes), false);
});

test('a trimmed name equal to the saved one is not a rename', () => {
  assert.deepEqual(diffGroupDraft(saved, { ...saved, name: '  家人 ' }).patch, {});
});

test('rename and visibility go out as one patch, members as the full new list', () => {
  const changes = diffGroupDraft(saved, {
    name: ' 工作 ',
    pinnedToTabs: false,
    conversationIDs: ['c-2', 'c-3', 'c-3'],
  });
  assert.deepEqual(changes, {
    patch: { name: '工作', pinnedToTabs: false },
    conversationIDs: ['c-2', 'c-3'],
  });
  assert.equal(hasGroupDraftChanges(changes), true);
});

test('a new group with only a name still needs no member write', () => {
  const changes = diffGroupDraft(EMPTY_GROUP_DRAFT, { ...EMPTY_GROUP_DRAFT, name: '同学' });
  assert.deepEqual(changes, { patch: { name: '同学' }, conversationIDs: null });
});
