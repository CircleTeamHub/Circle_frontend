import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoteSections,
  getNoteSectionAvailability,
  getInitialNoteSection,
  type StructuredNoteInput,
} from './note-sections.ts';

const legacyNote: StructuredNoteInput = {
  content: 'plain fallback',
  contentJson: [
    { type: 'paragraph', content: [{ text: 'hello' }] },
    { type: 'image', props: { url: 'https://cdn.test/one.jpg' } },
    { type: 'video', props: { url: 'https://cdn.test/one.mp4' } },
  ],
  media: [
    {
      id: 'img-1',
      type: 'IMAGE',
      objectKey: 'one.jpg',
      url: 'https://cdn.test/one.jpg',
      mimeType: 'image/jpeg',
      size: 10,
      width: 100,
      height: 100,
      durationMs: null,
      posterUrl: null,
      sortOrder: 0,
    },
  ],
};

test('buildNoteSections uses explicit sections when present', () => {
  const sections = buildNoteSections({
    sections: {
      text: { content: 'structured', contentJson: [{ type: 'paragraph' }] },
      media: { items: [] },
      showcase: { items: [{ id: 'show-1', type: 'IMAGE', url: 'https://cdn.test/show.jpg' }] },
      location: { title: 'Shenzhen', address: 'Nanshan', latitude: 22.5, longitude: 113.9 },
    },
    content: 'legacy',
    contentJson: null,
    media: [],
  });

  assert.equal(sections.text.content, 'structured');
  assert.equal(sections.showcase.items.length, 1);
  assert.equal(sections.location?.title, 'Shenzhen');
});

test('buildNoteSections derives four sections from legacy content and media', () => {
  const sections = buildNoteSections(legacyNote);

  assert.equal(sections.text.content, 'plain fallback');
  assert.equal(sections.text.contentJson?.length, 3);
  assert.equal(sections.media.items.length, 1);
  assert.equal(sections.showcase.items.length, 1);
  assert.equal(sections.location, null);
});

test('getNoteSectionAvailability reports addressable sections', () => {
  const availability = getNoteSectionAvailability(buildNoteSections(legacyNote));

  assert.deepEqual(availability, {
    hasText: true,
    hasMedia: true,
    hasShowcase: true,
    hasLocation: false,
  });
});

test('getInitialNoteSection falls back when requested section is unavailable', () => {
  const sections = buildNoteSections(legacyNote);

  assert.equal(getInitialNoteSection('location', sections), 'text');
  assert.equal(getInitialNoteSection('media', sections), 'media');
});
