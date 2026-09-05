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
  assert.equal(sections.media.items.length, 1);
  assert.equal(sections.showcase.items.length, 0);
  assert.equal(sections.location?.title, 'Shenzhen');
});

test('buildNoteSections derives four sections from legacy content and media', () => {
  const sections = buildNoteSections(legacyNote);

  assert.equal(sections.text.content, 'plain fallback');
  assert.equal(sections.text.contentJson?.length, 1);
  assert.equal(sections.media.items.length, 1);
  assert.equal(sections.showcase.items.length, 0);
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
    hasShowcase: false,
    hasLocation: false,
  });
});

test('getInitialNoteSection redirects stale legacy showcase card requests to migrated media', () => {
  const sections = buildNoteSections(legacyNote);

  // 显式请求且该区块有内容 → 定位过去。
  assert.equal(getInitialNoteSection('media', sections), 'media');
  // 滚动升级期间，旧卡片可能还带 showcase 参数；图片已迁到 media，必须落到内容处。
  assert.equal(getInitialNoteSection('showcase', sections), 'media');

  // 请求的区块没内容（笔记被编辑过）→ 不定位，停顶部比滚到空处强。
  assert.equal(getInitialNoteSection('location', sections), null);

  // 没请求 → 不定位。曾经回落到「第一个有内容的区块」，导致普通点开一条笔记
  // 也被自动滚过标题落到正文，第一眼看不到标题。
  assert.equal(getInitialNoteSection(undefined, sections), null);
  assert.equal(getInitialNoteSection(null, sections), null);
  assert.equal(getInitialNoteSection('', sections), null);
  assert.equal(getInitialNoteSection('bogus', sections), null);
});

test('getInitialNoteSection keeps real video showcases addressable', () => {
  const sections = buildNoteSections({
    sections: {
      showcase: { items: [{ type: 'VIDEO', url: 'https://cdn.test/showcase.mp4' }] },
    },
  });

  assert.equal(getInitialNoteSection('showcase', sections), 'showcase');
});

test('partial structured sections keep explicit showcase videos out of derived media', () => {
  const showcaseVideo = {
    id: 'showcase-video',
    type: 'VIDEO' as const,
    objectKey: 'notes/showcase.mp4',
    url: 'https://cdn.test/showcase.mp4',
  };
  const ordinaryImage = {
    id: 'ordinary-image',
    type: 'IMAGE' as const,
    objectKey: 'notes/photo.jpg',
    url: 'https://cdn.test/photo.jpg',
  };

  const sections = buildNoteSections({
    media: [showcaseVideo, ordinaryImage],
    sections: {
      showcase: { items: [showcaseVideo] },
    },
  });

  assert.deepEqual(sections.media.items.map((item) => item.url), [ordinaryImage.url]);
  assert.deepEqual(sections.showcase.items.map((item) => item.url), [showcaseVideo.url]);
});
