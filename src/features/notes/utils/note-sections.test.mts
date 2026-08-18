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
  assert.equal(sections.text.contentJson?.length, 1);
  assert.equal(sections.media.items.length, 1);
  assert.equal(sections.showcase.items.length, 1);
  assert.equal(sections.location, null);
});

test('buildNoteSections removes media blocks from the text region', () => {
  const sections = buildNoteSections({
    sections: {
      text: {
        content: 'structured',
        contentJson: [
          { type: 'paragraph', content: [{ text: 'hello' }] },
          { type: 'image', props: { url: 'https://cdn.test/one.jpg' } },
          { type: 'video', props: { url: 'https://cdn.test/one.mp4' } },
        ],
      },
      media: { items: [{ id: 'img-1', type: 'IMAGE', url: 'https://cdn.test/one.jpg' }] },
      showcase: { items: [] },
      location: null,
    },
  });

  assert.deepEqual(
    sections.text.contentJson?.map((block) => block.type),
    ['paragraph'],
  );
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

test('getInitialNoteSection 只认显式请求，其余一律不定位', () => {
  const sections = buildNoteSections(legacyNote);

  // 显式请求且该区块有内容 → 定位过去。
  assert.equal(getInitialNoteSection('media', sections), 'media');

  // 请求的区块没内容（笔记被编辑过）→ 不定位，停顶部比滚到空处强。
  assert.equal(getInitialNoteSection('location', sections), null);

  // 没请求 → 不定位。曾经回落到「第一个有内容的区块」，导致普通点开一条笔记
  // 也被自动滚过标题落到正文，第一眼看不到标题。
  assert.equal(getInitialNoteSection(undefined, sections), null);
  assert.equal(getInitialNoteSection(null, sections), null);
  assert.equal(getInitialNoteSection('', sections), null);
  assert.equal(getInitialNoteSection('bogus', sections), null);
});
