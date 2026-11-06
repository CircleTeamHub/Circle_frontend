import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { NoteCardBubble } from './note-card-bubble';
import type { ChatMessage, NoteCardData } from '@/types';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native');
  return { Image: ({ source }: { source: { uri: string } }) => <View testID={`img:${source.uri}`} /> };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('./shared', () => ({
  BubbleStatusText: () => null,
  CHAT_CARD_GAP: 8,
  CHAT_CARD_PADDING_VERTICAL: 8,
  CHAT_CARD_STANDARD_WIDTH: 260,
  MessageAvatar: () => null,
}));

const card = (overrides: Partial<NoteCardData> = {}): NoteCardData => ({
  noteId: 'n1',
  title: '北京大妞',
  contentPreview: null,
  coverUrl: null,
  imageCount: 5,
  videoCount: 1,
  groupNames: [],
  ...overrides,
});

const message = (noteCard: NoteCardData): ChatMessage =>
  ({ id: 'm1', type: 'note-card', outgoing: false, noteCard }) as ChatMessage;

test('shows a row of preview thumbnails when the card carries them', () => {
  render(
    <NoteCardBubble
      message={message(card({ previewUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] }))}
      outgoing={false}
    />,
  );
  expect(screen.getByTestId('note-card-previews')).toBeTruthy();
  expect(screen.getByTestId('img:https://cdn/a.jpg')).toBeTruthy();
  expect(screen.getByTestId('img:https://cdn/b.jpg')).toBeTruthy();
});

test('older cards without previews render no thumbnail row', () => {
  render(<NoteCardBubble message={message(card())} outgoing={false} />);
  expect(screen.queryByTestId('note-card-previews')).toBeNull();
});

test('with the four-image grid the top-left cover is dropped, the rest of the card stays', () => {
  render(
    <NoteCardBubble
      message={message(card({
        coverUrl: 'https://cdn/cover.jpg',
        contentPreview: '沪 真实学生假期兼职',
        previewUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg', 'https://cdn/d.jpg'],
      }))}
      outgoing={false}
    />,
  );
  expect(screen.queryByTestId('img:https://cdn/cover.jpg')).toBeNull();
  expect(screen.getAllByTestId(/^img:https:\/\/cdn\/[a-d]\.jpg$/)).toHaveLength(4);
  expect(screen.getByText('北京大妞')).toBeTruthy();
  expect(screen.getByText('沪 真实学生假期兼职')).toBeTruthy();
  expect(screen.getByText('chat.noteCard.includes')).toBeTruthy();
  expect(screen.getByText('chat.noteCard.chips.video')).toBeTruthy();
});

test('older cards without the grid keep their cover image', () => {
  render(<NoteCardBubble message={message(card({ coverUrl: 'https://cdn/cover.jpg' }))} outgoing={false} />);
  expect(screen.getByTestId('img:https://cdn/cover.jpg')).toBeTruthy();
});
