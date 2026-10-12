import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNoteCardPayload,
  buildNoteCardPayloadFromSummary,
} from './note-card-payload.ts';

test('normalizeNoteCardPayload accepts legacy payloads and infers section flags', () => {
  const payload = normalizeNoteCardPayload({
    noteId: 'note-1',
    ownerId: 'user-1',
    title: 'Trip',
    contentPreview: 'hello',
    coverUrl: null,
    imageCount: 2,
    videoCount: 1,
    groupNames: ['Diary'],
  });

  assert.equal(payload?.hasText, true);
  assert.equal(payload?.showcaseCount, 2);
  assert.equal(payload?.hasLocation, false);
  assert.deepEqual(payload?.groupNames, []);
  assert.equal(payload?.workStatus, 'UNSET');
});

test('normalizeNoteCardPayload preserves explicit structured flags', () => {
  const payload = normalizeNoteCardPayload({
    noteId: 'note-1',
    title: 'Trip',
    contentPreview: null,
    coverUrl: null,
    imageCount: 0,
    videoCount: 0,
    groupNames: [],
    hasText: false,
    showcaseCount: 3,
    hasLocation: true,
  });

  assert.equal(payload?.hasText, false);
  assert.equal(payload?.showcaseCount, 3);
  assert.equal(payload?.hasLocation, true);
});

test('normalizeNoteCardPayload keeps only safe source card snapshots', () => {
  const payload = normalizeNoteCardPayload({
    noteId: 'note-1',
    title: 'Trip',
    personalCardSnapshot: {
      id: ' user-1 ',
      name: ' Relay ',
      faceURL: 'https://cdn.test/u.png',
      extra: 'discarded',
    },
    sourceGroupCardSnapshot: {
      id: 'group-1',
      name: 'Origin group',
      faceURL: 'file:///private.png',
    },
  });

  assert.deepEqual(payload?.personalCardSnapshot, {
    id: 'user-1',
    name: 'Relay',
    faceURL: 'https://cdn.test/u.png',
  });
  assert.deepEqual(payload?.sourceGroupCardSnapshot, {
    id: 'group-1',
    name: 'Origin group',
    faceURL: null,
  });
});

test('buildNoteCardPayloadFromSummary emits structured fields from summary', () => {
  const payload = buildNoteCardPayloadFromSummary(
    {
      id: 'note-1',
      title: 'Trip',
      contentPreview: 'hello',
      status: 'ACTIVE',
      available: true,
      pinned: false,
      groups: [{ id: 'group-1', name: 'Diary' }],
      cover: null,
      imageCount: 2,
      videoCount: 1,
      mediaCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      sections: {
        text: { content: 'hello', contentJson: null },
        media: { items: [] },
        showcase: { items: [{ id: 'show-1', type: 'IMAGE', url: 'https://cdn.test/show.jpg' }] },
        location: { title: 'Shenzhen', address: 'Nanshan' },
      },
    },
    'user-1',
  );

  assert.equal(payload.ownerId, 'user-1');
  assert.equal(payload.hasText, true);
  assert.equal(payload.showcaseCount, 1);
  assert.equal(payload.hasLocation, true);
  assert.deepEqual(payload.groupNames, []);
  assert.equal(payload.workStatus, 'UNSET');
});

test('buildNoteCardPayloadFromSummary preserves explicit work status without private groups', () => {
  const payload = buildNoteCardPayloadFromSummary(
    {
      id: 'note-3',
      title: 'Studio',
      contentPreview: null,
      status: 'ACTIVE',
      available: true,
      workStatus: 'CLOSED',
      pinned: false,
      groups: [{ id: 'private-group', name: '只给自己看的分组' }],
      cover: null,
      imageCount: 0,
      videoCount: 0,
      mediaCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    'user-1',
  );

  assert.equal(payload.workStatus, 'CLOSED');
  assert.deepEqual(payload.groupNames, []);
});

test('buildNoteCardPayloadFromSummary includes source card snapshots without private group names', () => {
  const payload = buildNoteCardPayloadFromSummary(
    {
      id: 'copy-1',
      title: 'Studio',
      contentPreview: null,
      status: 'ACTIVE',
      available: true,
      pinned: false,
      groups: [],
      cover: null,
      imageCount: 0,
      videoCount: 0,
      mediaCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      collectedFrom: {
        sourceNoteId: 'source-1',
        conversationType: 'private',
        conversationID: 'conversation-1',
        clientMsgID: 'message-1',
        sender: { id: 'sender-1', name: 'Sender' },
      },
      sections: {
        contacts: { items: [{ id: 'contact-1', name: 'Previous relay' }] },
        groups: { items: [{ id: 'group-1', name: 'Boss group', avatarUrl: 'https://cdn.test/g.png' }] },
      },
    },
    'owner-1',
  );

  assert.equal(payload.sourceNoteId, 'source-1');
  assert.deepEqual(payload.personalCardSnapshot, {
    id: 'contact-1',
    name: 'Previous relay',
    faceURL: null,
  });
  assert.deepEqual(payload.sourceGroupCardSnapshot, {
    id: 'group-1',
    name: 'Boss group',
    faceURL: 'https://cdn.test/g.png',
  });
  assert.deepEqual(payload.groupNames, []);
});

test('buildNoteCardPayloadFromSummary uses flattened backend summary flags', () => {
  const payload = buildNoteCardPayloadFromSummary(
    {
      id: 'note-2',
      title: 'Location note',
      contentPreview: null,
      status: 'ACTIVE',
      available: true,
      pinned: false,
      groups: [{ id: 'group-1', name: 'Diary' }],
      cover: null,
      imageCount: 1,
      videoCount: 0,
      mediaCount: 1,
      hasText: false,
      showcaseCount: 4,
      hasLocation: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    'user-1',
  );

  assert.equal(payload.hasText, false);
  assert.equal(payload.showcaseCount, 4);
  assert.equal(payload.hasLocation, true);
});
