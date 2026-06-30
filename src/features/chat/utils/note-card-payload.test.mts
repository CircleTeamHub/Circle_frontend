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
