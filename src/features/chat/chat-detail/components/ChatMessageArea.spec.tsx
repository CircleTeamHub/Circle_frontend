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

// react-native-web's FlatList asserts in componentDidUpdate that this callback
// keeps its identity (native only checks nullability). If it changes when the
// unread anchor is computed after history loads, the web app crashes into the
// root error boundary.
test('keeps onViewableItemsChanged identity when the unread anchor changes', () => {
  const props = buildProps();
  const view = render(<ChatMessageArea {...props} />);
  const first = viewableCallback();

  view.rerender(<ChatMessageArea {...props} unreadStartMessageID="m-1" />);

  expect(viewableCallback()).toBe(first);
});

test('the stable callback uses the latest unread anchor and handler', () => {
  const firstHandler = jest.fn();
  const latestHandler = jest.fn();
  const props = buildProps({ handleUnreadStartVisibilityChange: firstHandler });
  const view = render(<ChatMessageArea {...props} />);
  const callback = viewableCallback();

  view.rerender(
    <ChatMessageArea
      {...props}
      unreadStartMessageID="m-1"
      handleUnreadStartVisibilityChange={latestHandler}
    />,
  );
  callback({
    viewableItems: [{ item: messages[1], key: 'm-1', index: 1, isViewable: true }],
  });

  expect(latestHandler).toHaveBeenLastCalledWith(true);
  expect(firstHandler).not.toHaveBeenCalled();
});
