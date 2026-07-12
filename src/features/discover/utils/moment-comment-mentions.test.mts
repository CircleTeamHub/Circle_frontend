import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMomentMentionedUserIds,
  insertMomentMention,
  MOMENT_MENTION_LIMIT,
  reconcileMomentMentionOccurrences,
} from './moment-comment-mentions.ts';

test('mention insertion accepts 20 unique users and refuses the 21st', () => {
  let state = {
    text: '',
    occurrences: [] as ReturnType<
      typeof insertMomentMention
    >['occurrences'],
    limitReached: false,
  };
  for (let index = 0; index < MOMENT_MENTION_LIMIT; index += 1) {
    state = insertMomentMention(state.text, state.occurrences, {
      userID: `user-${index}`,
      nickname: `User${index}`,
    });
    assert.equal(state.limitReached, false);
  }

  const atLimit = state;
  const duplicate = insertMomentMention(state.text, state.occurrences, {
    userID: 'user-0',
    nickname: 'User0',
  });
  assert.equal(duplicate.limitReached, false);
  assert.deepEqual(duplicate.occurrences, atLimit.occurrences);

  const blocked = insertMomentMention(state.text, state.occurrences, {
    userID: 'user-20',
    nickname: 'User20',
  });
  assert.equal(blocked.limitReached, true);
  assert.equal(blocked.text, atLimit.text);
  assert.deepEqual(blocked.occurrences, atLimit.occurrences);
});

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

  assert.equal(duplicate.text, first.text);
  assert.deepEqual(duplicate.occurrences, first.occurrences);
  assert.equal(duplicate.limitReached, false);
  assert.equal(first.text, 'manual @Alex @Alex ');
  assert.deepEqual(getMomentMentionedUserIds(first.occurrences), ['alex-1']);
});
