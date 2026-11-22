import { createRef } from 'react';
import { FlatList, type ViewToken } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { type TFunction } from 'i18next';
import { ChatMessageArea, type ChatMessageAreaProps } from './ChatMessageArea';
import { type ChatDetailThemedStyles } from '@/features/chat/chat-detail/hooks/use-chat-detail-themed-styles';
import { lightColors } from '@/theme/colors';
import { type ChatMessage } from '@/types';

function buildProps(overrides: Partial<ChatMessageAreaProps> = {}): ChatMessageAreaProps {
  return {
    headerInset: 0,
    composerInset: 0,
    colors: lightColors,
    t: ((key: string) => key) as unknown as TFunction<'translation', undefined>,
    mountedRef: { current: true },
    backgroundImageUri: null,
    d: {} as ChatDetailThemedStyles,
    flatListRef: createRef<FlatList<ChatMessage>>(),
    scrollRetryCountRef: { current: 0 },
    scrollRetryTimerRef: { current: null },
    messagesLengthRef: { current: 0 },
    handleLoadOlder: jest.fn(),
    historyWindowFull: false,
    unreadCount: 0,
    showUnreadJump: false,
    showLatestJump: false,
    handleJumpToLatest: jest.fn(),
    unreadStartMessageID: null,
    messages: [],
    displayMessages: [],
    handleMessageListScroll: jest.fn(),
    handleJumpToUnread: jest.fn(),
    handleUnreadStartVisibilityChange: jest.fn(),
    renderItem: () => null,
    keyExtractor: (item) => item.id,
    closeInputPanels: jest.fn(),
    ...overrides,
  };
}

const viewable = (id: string) =>
  ({ viewableItems: [{ item: { id } } as ViewToken], changed: [] });

describe('ChatMessageArea viewability callback', () => {
  // react-native-web 的 FlatList 在 componentDidUpdate 里断言 onViewableItemsChanged
  // 不能换函数（原生 RN 只查有没有）。未读锚点晚到一换回调，网页聊天页就整页崩到错误边界。
  it('keeps the same onViewableItemsChanged across unread anchor changes', () => {
    const first = jest.fn();
    const props = buildProps({ handleUnreadStartVisibilityChange: first });
    const { rerender } = render(<ChatMessageArea {...props} />);
    const before = screen.UNSAFE_getByType(FlatList).props.onViewableItemsChanged;

    const latest = jest.fn();
    rerender(
      <ChatMessageArea
        {...props}
        unreadStartMessageID="m-2"
        handleUnreadStartVisibilityChange={latest}
      />,
    );
    const after = screen.UNSAFE_getByType(FlatList).props.onViewableItemsChanged;

    expect(after).toBe(before);
    // 同一个函数也必须读到最新的锚点和回调。
    after(viewable('m-2'));
    expect(latest).toHaveBeenCalledWith(true);
    expect(first).not.toHaveBeenCalled();
  });

  it('reports the anchor as hidden when there is no unread anchor', () => {
    const onChange = jest.fn();
    render(<ChatMessageArea {...buildProps({ handleUnreadStartVisibilityChange: onChange })} />);
    screen.UNSAFE_getByType(FlatList).props.onViewableItemsChanged(viewable('m-1'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
