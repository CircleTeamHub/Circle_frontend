import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMomentMentionedUserIds,
  insertMomentMention,
  reconcileMomentMentionOccurrences,
} from './moment-comment-mentions.ts';

test('two selected users with the same nickname keep separate occurrence identities', () => {
  const first = insertMomentMention('', [], {
    userID: 'alex-1',
    nickname: 'Alex',
  });
  const second = insertMomentMention(first.text, first.occurrences, {
    userID: 'alex-2',
    nickname: 'Alex',
  });

  assert.equal(second.text, '@Alex @Alex ');
  assert.deepEqual(second.occurrences, [
    { userID: 'alex-1', nickname: 'Alex', start: 0, end: 5 },
    { userID: 'alex-2', nickname: 'Alex', start: 6, end: 11 },
  ]);
  assert.deepEqual(getMomentMentionedUserIds(second.occurrences), [
    'alex-1',
    'alex-2',
  ]);
});

test('deleting the first same-nickname occurrence removes only its id', () => {
  const occurrences = [
    { userID: 'alex-1', nickname: 'Alex', start: 0, end: 5 },
    { userID: 'alex-2', nickname: 'Alex', start: 6, end: 11 },
  ];

  const reconciled = reconcileMomentMentionOccurrences(
    '@Alex @Alex ',
    '@Alex ',
    occurrences,
    { start: 0, end: 6 },
  );

  assert.deepEqual(reconciled, [
    { userID: 'alex-2', nickname: 'Alex', start: 0, end: 5 },
  ]);
  assert.deepEqual(getMomentMentionedUserIds(reconciled), ['alex-2']);
});

test('edits before occurrences shift spans and overlapping edits remove them', () => {
  const occurrence = {
    userID: 'alice-id',
    nickname: 'Alice',
    start: 6,
    end: 12,
  };

  assert.deepEqual(
    reconcileMomentMentionOccurrences(
      'hello @Alice ',
      'say hello @Alice ',
      [occurrence],
      { start: 0, end: 0 },
    ),
    [{ ...occurrence, start: 10, end: 16 }],
  );
  assert.deepEqual(
    reconcileMomentMentionOccurrences(
      'hello @Alice ',
      'hello @Al ',
      [occurrence],
      { start: 9, end: 12 },
    ),
    [],
  );
});

test('manual mention text has no ids and duplicate user selection is ignored', () => {
  assert.deepEqual(getMomentMentionedUserIds([]), []);

  const first = insertMomentMention('manual @Alex ', [], {
    userID: 'alex-1',
    nickname: 'Alex',
  });
  const duplicate = insertMomentMention(first.text, first.occurrences, {
    userID: 'alex-1',
    nickname: 'Alex',
  });

  assert.deepEqual(duplicate, first);
  assert.equal(first.text, 'manual @Alex @Alex ');
  assert.deepEqual(getMomentMentionedUserIds(first.occurrences), ['alex-1']);
});
