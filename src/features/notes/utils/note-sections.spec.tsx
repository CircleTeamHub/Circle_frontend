import { getNoteVideoItems, type NoteSections } from './note-sections';

function sections(overrides: Partial<NoteSections> = {}): NoteSections {
  return {
    text: { content: null, contentJson: null },
    media: { items: [] },
    showcase: { items: [] },
    audio: { items: [] },
    contacts: { items: [] },
    groups: { items: [] },
    location: null,
    ...overrides,
  };
}

test('getNoteVideoItems returns signed videos once across note media sections', () => {
  const result = getNoteVideoItems(
    sections({
      media: {
        items: [
          {
            type: 'VIDEO',
            objectKey: 'notes/video.mp4',
            url: 'https://cdn.test/video.mp4?signature=old',
            mimeType: 'video/mp4',
          },
        ],
      },
      showcase: {
        items: [
          {
            type: 'VIDEO',
            objectKey: 'notes/video.mp4',
            url: 'https://cdn.test/video.mp4?signature=new',
            mimeType: 'video/mp4',
          },
          {
            type: 'IMAGE',
            objectKey: 'notes/photo.jpg',
            url: 'https://cdn.test/photo.jpg',
          },
        ],
      },
    }),
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toEqual(
    expect.objectContaining({
      type: 'VIDEO',
      objectKey: 'notes/video.mp4',
      mimeType: 'video/mp4',
    }),
  );
});
