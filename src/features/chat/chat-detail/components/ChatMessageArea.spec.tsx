import { createRef } from 'react';
import { FlatList, type ViewToken } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { TFunction } from 'i18next';
import { ChatMessageArea, type ChatMessageAreaProps } from './ChatMessageArea';
import type { ChatDetailThemedStyles } from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { lightColors } from '@/theme/colors';
import type { ChatMessage } from '@/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const messages = [
  { id: 'm-2', height: 2 },
  { id: 'm-1', height: 1 },
] as unknown as ChatMessage[];

function buildProps(overrides: Partial<ChatMessageAreaProps> = {}): ChatMessageAreaProps {
  return {
    headerInset: 0,
    composerInset: 0,
    colors: lightColors,
    t: ((key: string) => key) as unknown as TFunction<'translation', undefined>,
    mountedRef: { current: true },
    backgroundImageUri: null,
    d: {
      messageArea: {},
      unreadJumpButton: {},
      unreadJumpText: { color: '#000' },
    } as unknown as ChatDetailThemedStyles,
    flatListRef: createRef<FlatList<ChatMessage>>(),
    scrollRetryCountRef: { current: 0 },
    scrollRetryTimerRef: { current: null },
    messagesLengthRef: { current: messages.length },
    handleLoadOlder: jest.fn(),
    historyWindowFull: false,
    unreadCount: 0,
    showUnreadJump: false,
    showLatestJump: false,
    handleJumpToLatest: jest.fn(),
    unreadStartMessageID: null,
    messages,
    displayMessages: messages,
    handleMessageListScroll: jest.fn(),
    handleJumpToUnread: jest.fn(),
    handleUnreadStartVisibilityChange: jest.fn(),
    renderItem: () => null,
    keyExtractor: (item) => item.id,
    closeInputPanels: jest.fn(),
    ...overrides,
  };
}

function viewableCallback() {
  return screen.UNSAFE_getByType(FlatList).props.onViewableItemsChanged as (info: {
    viewableItems: ViewToken[];
  }) => void;
}

// react-native-web 的 FlatList 在 componentDidUpdate 里断言这个回调引用不变,
// 变了就抛 invariant(原生只查是否为空)。消息拉回来、未读起点算出来时
// 回调若跟着换引用,Web 端整页崩到错误边界。
test('keeps onViewableItemsChanged identity when the unread anchor changes', () => {
  const props = buildProps();
  const view = render(<ChatMessageArea {...props} />);
  const first = viewableCallback();

  view.rerender(<ChatMessageArea {...props} unreadStartMessageID="m-1" />);

  expect(viewableCallback()).toBe(first);
});

test('the stable callback still checks the latest unread anchor', () => {
  const handleUnreadStartVisibilityChange = jest.fn();
  const props = buildProps({ handleUnreadStartVisibilityChange });
  const view = render(<ChatMessageArea {...props} />);

  view.rerender(<ChatMessageArea {...props} unreadStartMessageID="m-1" />);
  viewableCallback()({
    viewableItems: [{ item: messages[1], key: 'm-1', index: 1, isViewable: true }],
  });

  expect(handleUnreadStartVisibilityChange).toHaveBeenLastCalledWith(true);
});
