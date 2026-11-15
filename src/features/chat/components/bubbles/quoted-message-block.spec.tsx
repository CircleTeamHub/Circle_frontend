import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ChatMessage, NoteCardData } from '@/types';
import {
  collectQuoteSources,
  QuotedMessageBlock,
  QuoteSourcesContext,
  type QuoteSources,
} from './quoted-message-block';

const imageProps: { cachePolicy?: unknown; source?: { uri?: string; cacheKey?: string } }[] = [];
jest.mock('expo-image', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: (props: { cachePolicy?: unknown; source?: { uri?: string; cacheKey?: string } }) => {
      imageProps.push(props);
      return <View testID={`img:${props.source?.uri}`} />;
    },
  };
});
// 卡片本体有自己的 spec;这里只看引用块有没有把整张卡片、正确的来源和回调交给它。
const cardProps: {
  note: NoteCardData;
  outgoing: boolean;
  width?: number;
  onPress?: (note: NoteCardData) => void;
  onSectionPress?: (note: NoteCardData, section: string) => void;
}[] = [];
jest.mock('./note-card-body', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NoteCardBody: (props: (typeof cardProps)[number]) => {
      cardProps.push(props);
      return <Pressable testID="note-card-body" onPress={() => props.onPress?.(props.note)} />;
    },
  };
});
jest.mock('@expo/vector-icons', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <View testID={`icon:${name}`} /> };
});
// 真的 i18next 插值:断言要看到「[笔记] 标题」这种拼好的文字,而不是 key。
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      (options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_, name: string) => options?.[name] ?? ''),
  }),
}));

const quote = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'q1',
  type: 'received',
  text: '这张不错',
  quotedText: '小明: [图片]',
  quoteMessageId: 'orig',
  quoteSenderName: '小明',
  ...overrides,
});

const image: ChatMessage = {
  id: 'orig',
  type: 'image',
  imageUrl: 'https://signed/full.jpg',
  imageThumbUrl: 'https://signed/thumb.jpg',
  imageKey: 'chat/u2/full.jpg',
  imageThumbKey: 'chat/u2/thumb.jpg',
  burnDurationSec: null,
};

function renderBlock(
  message: ChatMessage,
  sources: Partial<QuoteSources> & { originals?: ChatMessage[] } = {},
  onPress?: () => void,
) {
  const value: QuoteSources = {
    byId: collectQuoteSources([message, ...(sources.originals ?? [])]),
    openMedia: sources.openMedia,
    openNoteCard: sources.openNoteCard,
    selfDestructEnabled: sources.selfDestructEnabled ?? false,
  };
  return render(
    <QuoteSourcesContext.Provider value={value}>
      <QuotedMessageBlock message={message} align="start" onPress={onPress} />
    </QuoteSourcesContext.Provider>,
  );
}

beforeEach(() => {
  imageProps.length = 0;
  cardProps.length = 0;
});

it('falls back to the server snapshot text when the original is not on this page', () => {
  renderBlock(quote());

  expect(screen.getByText('小明: [图片]')).toBeTruthy();
  expect(screen.queryByTestId('quote-thumbnail')).toBeNull();
});

it('shows the quoted image as a thumbnail that opens the viewer, while the text still jumps', () => {
  const openMedia = jest.fn();
  const onPress = jest.fn();
  renderBlock(quote(), { originals: [image], openMedia }, onPress);

  expect(screen.getByTestId('img:https://signed/thumb.jpg')).toBeTruthy();
  // 签名地址每小时轮换:缓存键必须是存储 key,否则过一个窗口就整张重下。
  expect(imageProps[0]?.source?.cacheKey).toBe('chat/u2/thumb.jpg');
  expect(imageProps[0]?.cachePolicy).toBe('memory-disk');

  fireEvent.press(screen.getByLabelText('查看图片'));
  expect(openMedia).toHaveBeenCalledWith(image);
  expect(onPress).not.toHaveBeenCalled();

  // 缩略图本身就是内容:文字只留发送者,不再重复「[图片]」。
  expect(screen.queryByText('小明: [图片]')).toBeNull();
  fireEvent.press(screen.getByText('小明:'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('still shows the thumbnail when the quote has no sender name yet', () => {
  renderBlock(quote({ quoteSenderName: undefined }), { originals: [image] });

  expect(screen.getByTestId('img:https://signed/thumb.jpg')).toBeTruthy();
  expect(screen.queryByText(/:/)).toBeNull();
});

it('sits under the bubble on the same side as the bubble', () => {
  const { unmount } = renderBlock(quote());
  expect(screen.getByTestId('quote-block')).toHaveStyle({ alignSelf: 'flex-start' });
  unmount();

  render(<QuotedMessageBlock message={quote()} align="end" />);
  expect(screen.getByTestId('quote-block')).toHaveStyle({ alignSelf: 'flex-end' });
});

it('keeps a burn-after-reading original out of the disk cache', () => {
  renderBlock(quote(), { originals: [{ ...image, burnDurationSec: 30 }] });

  expect(imageProps[0]?.cachePolicy).toBe('memory');
});

it('expands a quoted note into the full note card that opens like the original', () => {
  const note: ChatMessage = {
    id: 'orig',
    type: 'note-card',
    noteCard: {
      noteId: 'n1',
      title: '周末去哪儿',
      contentPreview: null,
      coverUrl: 'https://signed/cover.jpg',
      imageCount: 1,
      videoCount: 0,
      groupNames: [],
    },
  };
  const openNoteCard = jest.fn();
  const onPress = jest.fn();
  renderBlock(quote({ quotedText: '小明: [笔记]' }), { originals: [note], openNoteCard }, onPress);

  // 整张卡片原样展开,文字只留发送者,不再是「[笔记] 标题」一行摘要。
  expect(screen.getByText('小明:')).toBeTruthy();
  expect(screen.queryByText('小明: [笔记] 周末去哪儿')).toBeNull();
  expect(cardProps[0]).toMatchObject({ note: note.noteCard, outgoing: false, width: 264 });

  fireEvent.press(screen.getByTestId('note-card-body'));
  expect(openNoteCard).toHaveBeenCalledWith(note, note.noteCard);
  cardProps[0]?.onSectionPress?.(note.noteCard!, 'showcase');
  expect(openNoteCard).toHaveBeenLastCalledWith(note, note.noteCard, 'showcase');
  expect(onPress).not.toHaveBeenCalled();

  fireEvent.press(screen.getByText('小明:'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('marks a quoted video thumbnail with a play badge', () => {
  const video: ChatMessage = {
    id: 'orig',
    type: 'video',
    videoUrl: 'https://signed/v.mp4',
    videoThumbUrl: 'https://signed/poster.jpg',
  };
  renderBlock(quote({ quotedText: '小明: [视频]' }), { originals: [video], openMedia: jest.fn() });

  expect(screen.getByTestId('img:https://signed/poster.jpg')).toBeTruthy();
  expect(screen.getByTestId('icon:play')).toBeTruthy();
  expect(screen.getByLabelText('播放视频')).toBeTruthy();
});

it('ignores the original once the quote is marked revoked', () => {
  renderBlock(
    quote({ quoteRevoked: true, quotedText: '消息已撤回' }),
    { originals: [image] },
  );

  expect(screen.getByText('消息已撤回')).toBeTruthy();
  expect(screen.queryByTestId('quote-thumbnail')).toBeNull();
});

it('collects only originals that a quote on the page points at', () => {
  const unrelated: ChatMessage = { ...image, id: 'other' };
  const notice: ChatMessage = { id: 'orig2', type: 'system-notice', text: '你撤回了一条消息' };
  const byId = collectQuoteSources([
    quote(),
    quote({ id: 'q2', quoteMessageId: 'orig2' }),
    image,
    unrelated,
    notice,
  ]);

  expect([...byId.keys()]).toEqual(['orig']);
});
