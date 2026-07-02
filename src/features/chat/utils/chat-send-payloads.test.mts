import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtMessagePayload,
  buildQuotePreviewText,
  filterMentionCandidates,
  getActiveMentionQuery,
  getMentionsPresentInText,
  type MentionTarget,
} from './chat-send-payloads.ts';

test('buildAtMessagePayload dedupes selected mention ids and preserves text', () => {
  const mentions: MentionTarget[] = [
    { userID: 'u1', nickname: 'Alice' },
    { userID: 'u1', nickname: 'Alice' },
    { userID: 'u2', nickname: 'Bob' },
  ];

  const payload = buildAtMessagePayload('hi @Alice @Bob', mentions);

  assert.equal(payload.text, 'hi @Alice @Bob');
  assert.deepEqual(payload.atUserList, ['u1', 'u2']);
  assert.deepEqual(payload.atUsersInfo, [
    { userID: 'u1', nickname: 'Alice' },
    { userID: 'u2', nickname: 'Bob' },
  ]);
});

test('getMentionsPresentInText drops selected mentions removed from draft text', () => {
  const mentions: MentionTarget[] = [
    { userID: 'u1', nickname: 'Alice' },
    { userID: 'u2', nickname: 'Bob' },
    { userID: 'u3', nickname: 'Bo' },
  ];

  assert.deepEqual(getMentionsPresentInText('hi @Alice and @Bob ', mentions), [
    { userID: 'u1', nickname: 'Alice' },
    { userID: 'u2', nickname: 'Bob' },
  ]);
  assert.deepEqual(getMentionsPresentInText('hi @Alice, meet @Bob。', mentions), [
    { userID: 'u1', nickname: 'Alice' },
    { userID: 'u2', nickname: 'Bob' },
  ]);
});

test('getActiveMentionQuery detects the current at-token before cursor', () => {
  assert.equal(getActiveMentionQuery('hi @ali', 7), 'ali');
  assert.equal(getActiveMentionQuery('hi @alice ok', 12), null);
  assert.equal(getActiveMentionQuery('plain text', 10), null);
});

test('filterMentionCandidates matches nickname and user id case-insensitively', () => {
  const members: MentionTarget[] = [
    { userID: 'u-alice', nickname: 'Alice' },
    { userID: 'u-bob', nickname: 'Bob' },
  ];

  assert.deepEqual(filterMentionCandidates(members, 'ali'), [
    { userID: 'u-alice', nickname: 'Alice' },
  ]);
  assert.deepEqual(filterMentionCandidates(members, 'U-BO'), [
    { userID: 'u-bob', nickname: 'Bob' },
  ]);
});

test('buildQuotePreviewText returns compact text for text and media messages', () => {
  // buildQuotePreviewText now takes `t` (pure util, no i18n import). Fake it with a
  // defaultValue-echoing t that also interpolates {{vars}}, mirroring i18next behavior.
  const t = ((key: string, opts: Record<string, unknown> = {}) => {
    let s = String(opts.defaultValue ?? key);
    for (const [k, v] of Object.entries(opts)) {
      if (k === 'defaultValue') continue;
      s = s.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    }
    return s;
  }) as unknown as Parameters<typeof buildQuotePreviewText>[1];

  assert.equal(
    buildQuotePreviewText({ id: 'm1', type: 'received', text: 'hello world' }, t),
    'hello world',
  );
  assert.equal(buildQuotePreviewText({ id: 'm2', type: 'image' }, t), '[图片]');
  assert.equal(buildQuotePreviewText({ id: 'm3', type: 'note-card', noteCard: { noteId: 'n1', title: 'Trip', contentPreview: null, coverUrl: null, imageCount: 0, videoCount: 0, groupNames: [] } }, t), '[笔记] Trip');
});
