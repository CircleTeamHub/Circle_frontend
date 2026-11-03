import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
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

test.each([false, true])('renders three independent media headers and lists (virtualized: %s)', (virtualized) => {
  const sections = buildNoteSections({ sections: {
    media: { items: [
      { type: 'IMAGE', objectKey: 'photo', url: 'https://cdn/photo' },
      { type: 'VIDEO', objectKey: 'video', url: 'https://cdn/video' },
    ] },
    showcase: { items: [{ type: 'VIDEO', objectKey: 'check', url: 'https://cdn/check' }] },
  } });
  render(<NoteDocumentBody title="Note" createdAt="2026-11-03T00:00:00Z" groups={[]} sections={sections} order={['media', 'showcase']} virtualized={virtualized} />);
  expect(screen.getByText('notes.section.image')).toBeTruthy();
  expect(screen.getByText('notes.section.video')).toBeTruthy();
  expect(screen.getByText('notes.section.showcase')).toBeTruthy();
  expect(screen.queryByText('notes.section.media')).toBeNull();
  expect(screen.getByText('https://cdn/photo')).toBeTruthy();
  expect(screen.getByText('https://cdn/video')).toBeTruthy();
  expect(screen.getByText('https://cdn/check')).toBeTruthy();
  expect(screen.UNSAFE_getAllByType(Text).map((node) => node.props.children).filter((value) => typeof value === 'string' && value.startsWith('notes.section.')))
    .toEqual(['notes.section.image', 'notes.section.video', 'notes.section.showcase']);
});
