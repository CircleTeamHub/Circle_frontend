import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectedNoteTitle } from './note-collect-title.ts';

test('collect title defaults to group, username, and original title', () => {
  assert.equal(
    buildCollectedNoteTitle({
      groupName: '深圳场地',
      username: 'alice',
      originalTitle: '南山摄影棚',
    }),
    '深圳场地 alice 南山摄影棚',
  );
});

test('collect title uses safe labels for missing values and trims input', () => {
  assert.equal(
    buildCollectedNoteTitle({
      groupName: '  ',
      username: null,
      originalTitle: '  场地  ',
    }),
    '未分组 我 场地',
  );
});
