import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NoteCardBubble } from './note-card-bubble';
import { noteCardWidth } from './note-card-body';
import type { ChatMessage, NoteCardData } from '@/types';

jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native');
  return { Image: ({ source }: { source: { uri: string } }) => <View testID={`img:${source.uri}`} /> };
});
jest.mock('@expo/vector-icons', () => {
  const { View } = jest.requireActual('react-native');
  return {
    Ionicons: () => null,
    MaterialCommunityIcons: ({ name, color }: { name: string; color: string }) => (
      <View testID={`mci:${name}`} accessibilityHint={color} />
    ),
  };
});
let mockWindowWidth = 390;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWindowWidth, height: 900, scale: 3, fontScale: 1 }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('./shared', () => ({
  AVATAR_COLUMN_SIZE: 44,
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

test('the counts line ends with the verification videos, not counted again as videos', () => {
  render(<NoteCardBubble message={message(card({ videoCount: 1, showcaseCount: 1 }))} outgoing={false} />);
  expect(screen.getByTestId('note-card-counts').props.children)
    .toBe('chat.noteCard.imageCount · chat.noteCard.verificationCount');
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
  // 图片/视频数是标题区里单独的一行小字,不再和按钮挤在一行。
  expect(screen.getByTestId('note-card-counts').props.children).toBe('chat.noteCard.imageCount · chat.noteCard.videoCount');
  expect(screen.getByText('chat.noteCard.chips.video')).toBeTruthy();
});

test('the grid shows at most four images and no extra count overlay', () => {
  render(
    <NoteCardBubble
      message={message(card({
        imageCount: 6,
        videoCount: 3,
        previewUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg', 'https://cdn/d.jpg'],
      }))}
      outgoing={false}
    />,
  );
  expect(screen.getAllByTestId(/^img:/)).toHaveLength(4);
  expect(screen.queryByText(/^\+\d+$/)).toBeNull();
});

test('all four section buttons are always there; the ones the note lacks are disabled', () => {
  const onSectionPress = jest.fn();
  render(
    <NoteCardBubble
      message={message(card({
        contentPreview: '简介',
        videoCount: 0,
        imageCount: 0,
        showcaseCount: 0,
        hasLocation: false,
        workStatus: 'CLOSED',
      }))}
      outgoing={false}
      onSectionPress={onSectionPress}
    />,
  );
  for (const key of ['note', 'video', 'display', 'location']) {
    expect(screen.getByText(`chat.noteCard.chips.${key}`)).toBeTruthy();
  }
  fireEvent.press(screen.getByText('chat.noteCard.chips.location'));
  expect(onSectionPress).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('chat.noteCard.chips.note'));
  expect(onSectionPress).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'n1' }), 'text');
  expect(screen.getByText('chat.noteCard.workStatus.closed')).toBeTruthy();
});

test('older cards without the grid keep their cover image', () => {
  render(<NoteCardBubble message={message(card({ coverUrl: 'https://cdn/cover.jpg' }))} outgoing={false} />);
  expect(screen.getByTestId('img:https://cdn/cover.jpg')).toBeTruthy();
});

test("always shows the source's monthly rating counters, updated once reconciled", () => {
  const { useNoteRatingCountsStore } = jest.requireActual<
    typeof import('@/features/notes/store/use-note-rating-counts-store')
  >('@/features/notes/store/use-note-rating-counts-store');
  render(<NoteCardBubble message={message(card({ noteId: 'rated-card' }))} outgoing={false} />);
  // Not reconciled yet: the area is there with zeros, so the card keeps its height.
  expect(screen.getByTestId('note-card-rating-good')).toHaveTextContent('0');
  expect(screen.getByTestId('note-card-rating-bad')).toHaveTextContent('0');
  // 好评 is a firework, 差评 a rain cloud — no thumbs.
  expect(screen.getByTestId('mci:firework')).toBeTruthy();
  expect(screen.getByTestId('mci:weather-pouring')).toBeTruthy();

  React.act(() => {
    useNoteRatingCountsStore.getState().record([{ noteId: 'rated-card', goodCount: 3, badCount: 1 }]);
  });

  expect(screen.getByTestId('note-card-rating-good')).toHaveTextContent('3');
  expect(screen.getByTestId('note-card-rating-bad')).toHaveTextContent('1');
});

test('the note card grows with the screen instead of staying at the 260pt chat-card width', () => {
  // 列表左右留白 18×2 + 头像列 44 + 间距 8 + 对侧留 16 = 104。
  expect(noteCardWidth(440)).toBe(336); // iPhone Pro Max
  expect(noteCardWidth(393)).toBe(289); // iPhone 标准尺寸
  expect(noteCardWidth(360)).toBe(260); // 窄屏不比原来更窄
  expect(noteCardWidth(1280)).toBe(360); // 桌面网页版封顶,四宫格不至于太大
});

test('on a wide phone the card and its four thumbnails are laid out at the wider size', () => {
  mockWindowWidth = 440;
  render(
    <NoteCardBubble
      message={message(card({ previewUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] }))}
      outgoing={false}
    />,
  );
  expect(StyleSheet.flatten(screen.getByTestId('note-card-body').props.style).width).toBe(336);
  // (336 - 左右内边距 12×2 - 三道 4 的缝) / 4 = 75。
  for (const tile of screen.getAllByTestId('note-card-tile')) {
    expect(StyleSheet.flatten(tile.props.style)).toMatchObject({ width: 75, height: 75 });
  }
});

test('rating icons are coloured, with a pale variant on the purple outgoing card', () => {
  // 没有 ThemeProvider 时 useTheme 回落到暗色主题。
  const { darkColors } = jest.requireActual<typeof import('@/theme/colors')>('@/theme/colors');
  const { rerender } = render(<NoteCardBubble message={message(card())} outgoing={false} />);
  expect(screen.getByTestId('mci:firework').props.accessibilityHint).toBe(darkColors.ratingGood);
  expect(screen.getByTestId('mci:weather-pouring').props.accessibilityHint).toBe(darkColors.ratingBad);

  rerender(<NoteCardBubble message={message(card())} outgoing />);
  expect(screen.getByTestId('mci:firework').props.accessibilityHint).toBe(darkColors.ratingGoodOnAccent);
  expect(screen.getByTestId('mci:weather-pouring').props.accessibilityHint).toBe(darkColors.ratingBadOnAccent);
});
