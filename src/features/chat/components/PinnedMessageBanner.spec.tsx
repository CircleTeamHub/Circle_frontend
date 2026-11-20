import React from 'react';
import { Alert, AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PinnedMessageBanner } from './PinnedMessageBanner';
import { setChatPinnedMessage } from '@/chat-core/api';
import type { ChatConversationDto, ChatPinnedMessageDto } from '@/chat-core/protocol';

let mockConversation: Partial<ChatConversationDto> | undefined;

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(cb, [cb]);
  },
}));
jest.mock('@/hooks/use-reduce-motion', () => ({ useReduceMotion: () => true }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: { primary: '#6855ee' } }),
  withAlpha: () => '#eee',
}));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View testID="pinned-messages-sheet">{children}</View> : null,
  };
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; preview?: string }) => {
      if (options?.count !== undefined) return `${key}:${options.count}`;
      if (options?.preview !== undefined) return `${key}:${options.preview}`;
      return key;
    },
  }),
}));
jest.mock('@/chat-core/api', () => ({ setChatPinnedMessage: jest.fn(() => Promise.resolve()) }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: { conversations: unknown[] }) => unknown) =>
    selector({ conversations: mockConversation ? [mockConversation] : [] }),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_e: unknown, fallback: string) => fallback }));

const pin = (messageId: string, preview: string): ChatPinnedMessageDto => ({
  messageId, height: 8, preview, pinnedAt: '2026-11-06T00:00:00.000Z',
});
const notePin = pin('msg-3', '[笔记] 周末羽毛球场地');
const textPin = pin('msg-2', '下周六 9 点集合');
const imagePin = pin('msg-1', '[图片]');

/** 面板没开时屏幕上只有横幅这一个按钮。 */
const openList = () => fireEvent.press(screen.getByRole('button'));

beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  mockConversation = { id: 'conv-1', type: 'GROUP', myRole: 'MEMBER', pinnedMessages: [textPin] };
});

test('a single pin reads like the group notice banner, with no unpin control on it', () => {
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.getByText('chat.pin.tag')).toBeTruthy();
  expect(screen.getByText('下周六 9 点集合')).toBeTruthy();
  expect(screen.getByLabelText('chat.pin.bannerA11y:下周六 9 点集合')).toBeTruthy();
  expect(screen.queryByTestId('pinned-messages-sheet')).toBeNull();
  expect(screen.queryByLabelText('chat.pin.unpin')).toBeNull();
});

test('several pins: the banner shows the newest and the count', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [notePin, textPin, imagePin] };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.getByText('chat.pin.listTitle:3')).toBeTruthy();
  expect(screen.getByText('[笔记] 周末羽毛球场地')).toBeTruthy();
  expect(screen.queryByText('下周六 9 点集合')).toBeNull();
  // 读屏也要听到一共几条,而不只是最新那条。
  expect(screen.getByLabelText('chat.pin.listTitle:3 [笔记] 周末羽毛球场地')).toBeTruthy();
});

test('once the last pin is gone, a later pin shows the banner with the list closed', () => {
  mockConversation = { ...mockConversation, myRole: 'ADMIN' };
  const view = render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList();
  expect(screen.getByTestId('pinned-messages-sheet')).toBeTruthy();

  // 开着列表时最后一条没了(自己 ×、别人取消、被撤回都一样)。
  mockConversation = { ...mockConversation, pinnedMessages: [] };
  view.rerender(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.queryByTestId('pinned-message-banner')).toBeNull();

  // 之后又有人置顶:横幅回来,但列表不能自己弹出来。
  mockConversation = { ...mockConversation, pinnedMessages: [imagePin] };
  view.rerender(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.getByText('[图片]')).toBeTruthy();
  expect(screen.queryByTestId('pinned-messages-sheet')).toBeNull();
});

test('tapping the banner lists every pin; tapping one closes the list and jumps there', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [notePin, textPin, imagePin] };
  const onJump = jest.fn();
  render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);

  openList();
  expect(screen.getByTestId('pinned-messages-sheet')).toBeTruthy();
  expect(screen.getByText('下周六 9 点集合')).toBeTruthy();
  expect(screen.getByText('[图片]')).toBeTruthy();

  fireEvent.press(screen.getByText('[图片]'));
  expect(onJump).toHaveBeenCalledWith('msg-1');
  expect(screen.queryByTestId('pinned-messages-sheet')).toBeNull();
});

test('ordinary group members can open the list but not unpin', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [notePin, textPin] };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList();
  expect(screen.getByText('下周六 9 点集合')).toBeTruthy();
  expect(screen.queryByLabelText('chat.pin.unpin')).toBeNull();
});

test('a group admin unpins exactly the row they tap', async () => {
  mockConversation = { ...mockConversation, myRole: 'ADMIN', pinnedMessages: [notePin, textPin, imagePin] };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList();
  const unpinButtons = screen.getAllByLabelText('chat.pin.unpin');
  expect(unpinButtons).toHaveLength(3);
  await act(async () => { fireEvent.press(unpinButtons[1]); });
  expect(setChatPinnedMessage).toHaveBeenCalledWith('conv-1', 'msg-2', false);
});

test('both sides of a direct chat can unpin', () => {
  mockConversation = { ...mockConversation, type: 'DIRECT', myRole: undefined };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList();
  expect(screen.getByLabelText('chat.pin.unpin')).toBeTruthy();
});

test('a failed unpin tells the user and keeps the list open', async () => {
  mockConversation = { ...mockConversation, myRole: 'OWNER' };
  jest.mocked(setChatPinnedMessage).mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList();
  await act(async () => { fireEvent.press(screen.getByLabelText('chat.pin.unpin')); });
  expect(alert).toHaveBeenCalledWith('chat.pin.failed', 'common.retryLater');
  expect(screen.getByTestId('pinned-messages-sheet')).toBeTruthy();
  alert.mockRestore();
});

test('an empty preview shows the generic placeholder', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [pin('msg-9', '')] };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.getByText('chat.pin.fallbackPreview')).toBeTruthy();
});

test.each([
  ['an empty list', []],
  ['an old server without the field', undefined],
])('nothing renders for %s', (_case, pinnedMessages) => {
  mockConversation = { ...mockConversation, pinnedMessages };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.queryByTestId('pinned-message-banner')).toBeNull();
});
