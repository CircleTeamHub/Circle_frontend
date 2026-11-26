import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { NoteDocumentBody } from './NoteDocumentBody';
import { buildNoteSections } from '../utils/note-sections';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  Radius: {}, Spacing: {}, Typography: {}, useTheme: () => ({ colors: {} }),
}));
jest.mock('./NoteBlockRenderer', () => ({
  NoteBlockRenderer: ({ blocks }: { blocks: Record<string, unknown>[] }) => {
    const { Text: MockText } = jest.requireActual('react-native');
    return <MockText>{blocks.map((block) => (block.props as { url: string }).url).join(',')}</MockText>;
  },
}));

test.each([false, true])('labels each material in document order without a section heading or delete button (virtualized: %s)', (virtualized) => {
  const sections = buildNoteSections({ sections: {
    media: { items: [
      { type: 'IMAGE', objectKey: 'photo', url: 'https://cdn/photo' },
      { type: 'IMAGE', objectKey: 'photo2', url: 'https://cdn/photo2' },
      { type: 'VIDEO', objectKey: 'video', url: 'https://cdn/video' },
    ] },
    showcase: { items: [{ type: 'VIDEO', objectKey: 'check', url: 'https://cdn/check' }] },
  } });
  const onLayout = jest.fn();
  const onSectionLayout = jest.fn(() => onLayout);
  render(<NoteDocumentBody title="Note" createdAt="2026-11-03T00:00:00Z" groups={[]} sections={sections} order={['text', 'media', 'showcase']} virtualized={virtualized} onSectionLayout={onSectionLayout} />);

  const rows = screen.getAllByTestId('note-document-material');
  expect(rows).toHaveLength(4);
  const expected = [
    ['https://cdn/photo', 'notes.section.image'],
    ['https://cdn/photo2', 'notes.section.image'],
    ['https://cdn/video', 'notes.section.video'],
    ['https://cdn/check', 'notes.edit.sections.showcase'],
  ];
  rows.forEach((row, index) => {
    expect(within(row).getByText(expected[index][0])).toBeTruthy();
    expect(within(row).getByTestId('note-material-badge')).toHaveTextContent(expected[index][1]);
    expect(within(row).queryByRole('button')).toBeNull();
  });
  expect(screen.queryByText('notes.section.text')).toBeNull();
  expect(screen.queryByText('notes.section.emptyText')).toBeNull();
  expect(onSectionLayout.mock.calls).toEqual([['media'], ['showcase']]);
  const event = { nativeEvent: { layout: { y: 120 } } };
  fireEvent(rows[0], 'layout', event);
  expect(onLayout).toHaveBeenCalledWith(event);
});
