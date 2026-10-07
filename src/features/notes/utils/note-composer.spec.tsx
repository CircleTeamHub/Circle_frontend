import {
  buildNoteComposerBlocksMetadata,
  buildNoteComposerMetadata,
  normalizeNoteComposerBlocks,
  normalizeNoteComposerOrder,
  readNoteComposerBlocks,
  readNoteComposerOrder,
  stripNoteComposerMetadata,
} from './note-composer';

describe('note composer layout metadata', () => {
  it('reads only supported, unique block kinds', () => {
    expect(
      readNoteComposerOrder([
        { type: 'paragraph' },
        {
          type: 'noteLayout',
          props: { order: ['image', 'image', 'unknown', 'location'] },
        },
      ]),
    ).toEqual(['image', 'location']);
  });

  it('keeps empty sections available for a new editor', () => {
    expect(
      normalizeNoteComposerOrder(['text'], {
        text: { content: null, contentJson: [] },
        media: { items: [] },
        showcase: { items: [] },
        location: null,
      }),
    ).toEqual(['text', 'title', 'image', 'showcase', 'location']);
  });

  it('removes the private marker before rendering and rebuilds it on save', () => {
    const marker = buildNoteComposerMetadata(['title', 'text', 'image']);
    const blocks = [{ type: 'paragraph' }, marker];
    expect(stripNoteComposerMetadata(blocks)).toEqual([{ type: 'paragraph' }]);
    expect(marker).toEqual({
      type: 'noteLayout',
      props: { order: ['title', 'text', 'image'] },
    });
  });

  it('preserves repeated composer instances and their order', () => {
    const marker = buildNoteComposerBlocksMetadata([
      { id: 'text-a', kind: 'text' },
      { id: 'image-a', kind: 'image' },
      { id: 'image-b', kind: 'image' },
      { id: 'text-b', kind: 'text' },
    ]);

    expect(readNoteComposerBlocks([marker])).toEqual([
      { id: 'text-a', kind: 'text' },
      { id: 'image-a', kind: 'image' },
      { id: 'image-b', kind: 'image' },
      { id: 'text-b', kind: 'text' },
    ]);
    expect(marker).toEqual({
      type: 'noteLayout',
      props: {
        order: ['text', 'image', 'image', 'text'],
        blocks: [
          { id: 'text-a', kind: 'text' },
          { id: 'image-a', kind: 'image' },
          { id: 'image-b', kind: 'image' },
          { id: 'text-b', kind: 'text' },
        ],
      },
    });
  });

  it('upgrades legacy kind-only metadata to stable instance ids', () => {
    expect(
      readNoteComposerBlocks([
        { type: 'noteLayout', props: { order: ['text', 'image', 'text'] } },
      ]),
    ).toEqual([
      { id: 'text-1', kind: 'text' },
      { id: 'image-2', kind: 'image' },
      { id: 'text-3', kind: 'text' },
    ]);
  });

  it('keeps repeatable instances while collapsing singleton blocks', () => {
    const marker = buildNoteComposerBlocksMetadata([
      { id: 'text-a', kind: 'text' },
      { id: 'title-a', kind: 'title' },
      { id: 'image-a', kind: 'image' },
      { id: 'title-b', kind: 'title' },
      { id: 'contact-a', kind: 'contact' },
      { id: 'contact-b', kind: 'contact' },
      { id: 'location-a', kind: 'location' },
      { id: 'location-b', kind: 'location' },
      { id: 'group-a', kind: 'group' },
      { id: 'group-b', kind: 'group' },
      { id: 'image-b', kind: 'image' },
    ]);

    expect(readNoteComposerBlocks([marker])).toEqual([
      { id: 'text-a', kind: 'text' },
      { id: 'title-a', kind: 'title' },
      { id: 'image-a', kind: 'image' },
      { id: 'contact-a', kind: 'contact' },
      { id: 'location-a', kind: 'location' },
      { id: 'group-a', kind: 'group' },
      { id: 'image-b', kind: 'image' },
    ]);

    expect(
      normalizeNoteComposerBlocks(
        [
          { id: 'title-a', kind: 'title' },
          { id: 'title-b', kind: 'title' },
          { id: 'contact-a', kind: 'contact' },
          { id: 'contact-b', kind: 'contact' },
          { id: 'text-a', kind: 'text' },
          { id: 'text-b', kind: 'text' },
        ],
        {},
      ),
    ).toEqual([
      { id: 'title-a', kind: 'title' },
      { id: 'contact-a', kind: 'contact' },
      { id: 'text-a', kind: 'text' },
      { id: 'text-b', kind: 'text' },
    ]);
  });

  it('keeps duplicate instances while appending missing legacy sections', () => {
    expect(
      normalizeNoteComposerBlocks(
        [
          { id: 'text-a', kind: 'text' },
          { id: 'image-a', kind: 'image' },
          { id: 'image-b', kind: 'image' },
          { id: 'text-b', kind: 'text' },
        ],
        {
          text: { content: '正文', contentJson: [] },
          media: { items: [] },
        },
      ),
    ).toEqual([
      { id: 'text-a', kind: 'text' },
      { id: 'image-a', kind: 'image' },
      { id: 'image-b', kind: 'image' },
      { id: 'text-b', kind: 'text' },
      { id: 'title-5', kind: 'title' },
    ]);
  });
});
