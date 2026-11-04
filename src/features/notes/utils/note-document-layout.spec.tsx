import { getNoteDocumentInstances } from './note-document-layout';
import { buildNoteSections } from './note-sections';

const image = { type: 'IMAGE' as const, objectKey: 'notes/photo.jpg', url: 'https://cdn/photo.jpg' };
const video = { type: 'VIDEO' as const, objectKey: 'notes/video.mp4', url: 'https://cdn/video.mp4' };
const verification = { type: 'VIDEO' as const, objectKey: 'notes/verification.mp4', url: 'https://cdn/verification.mp4' };

test.each([false, true])('separates legacy image, video and verification regions (saved layout: %s)', (withLayout) => {
  const layout = withLayout ? [{ type: 'noteLayout', props: {
    blocks: [{ id: 'pictures', kind: 'image' }, { id: 'verification', kind: 'showcase' }],
    mediaBlocks: [{ id: 'pictures', target: 'media', objectKeys: [image.objectKey, video.objectKey] }],
  } }] : [];
  const sections = buildNoteSections({ sections: {
    media: { items: [image, video] }, showcase: { items: [verification] },
  } });
  const instances = getNoteDocumentInstances(sections, ['media', 'showcase'], layout);
  const ordinary = instances.filter((entry) => entry.kind === 'media');
  expect(ordinary.map((entry) => entry.sections.media.items.map((item) => item.objectKey))).toEqual([[image.objectKey], [video.objectKey]]);
  expect(ordinary.map((entry) => entry.mediaKind)).toEqual(['image', 'video']);
  expect(instances.filter((entry) => entry.kind === 'showcase').map((entry) => entry.sections.showcase.items.map((item) => item.objectKey))).toEqual([[verification.objectKey]]);
});

test('preserves repeated regions and valid owners while repairing an old mixed owner', () => {
  const secondImage = { ...image, objectKey: 'notes/second.jpg', url: 'https://cdn/second.jpg' };
  const secondVideo = { ...video, objectKey: 'notes/second.mp4', url: 'https://cdn/second.mp4' };
  const sections = buildNoteSections({ sections: { media: { items: [image, secondImage, video, secondVideo] } } });
  const layout = [{ type: 'noteLayout', props: {
    blocks: [{ id: 'i1', kind: 'image' }, { id: 'v1', kind: 'video' }, { id: 'i2', kind: 'image' }, { id: 'v2', kind: 'video' }],
    mediaBlocks: [
      { id: 'i1', target: 'media', objectKeys: [image.objectKey, video.objectKey] },
      { id: 'i2', target: 'media', objectKeys: [secondImage.objectKey] },
      { id: 'v2', target: 'media', objectKeys: [secondVideo.objectKey] },
    ],
  } }];
  expect(getNoteDocumentInstances(sections, ['media'], layout).map((entry) => [entry.id, entry.sections.media.items.map((item) => item.objectKey)]))
    .toEqual([['i1', [image.objectKey]], ['v1', [video.objectKey]], ['i2', [secondImage.objectKey]], ['v2', [secondVideo.objectKey]]]);
});
