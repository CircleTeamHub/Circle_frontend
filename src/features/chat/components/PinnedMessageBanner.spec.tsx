import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PinnedMessageBanner } from './PinnedMessageBanner';
import { setChatPinnedMessage } from '@/chat-core/api';
import type { ChatConversationDto, ChatPinnedMessageDto } from '@/chat-core/protocol';

let mockConversation: Partial<ChatConversationDto> | undefined;

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }),
}));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { ScrollView, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View testID="pinned-messages-sheet">{children}</View> : null,
    BottomSheetScrollView: ScrollView,
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

const openList = (count: number) =>
  fireEvent.press(screen.getByRole('button', { name: `chat.pin.openList:${count}` }));

beforeEach(() => {
  jest.clearAllMocks();
  mockConversation = { id: 'conv-1', type: 'GROUP', myRole: 'MEMBER', pinnedMessages: [textPin] };
});

test('the banner jumps straight to a single pin', () => {
  const onJump = jest.fn();
  render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);
  expect(screen.getByText('chat.pin.tag')).toBeTruthy();
  const preview = screen.getByText('下周六 9 点集合');
  fireEvent.press(preview);
  expect(onJump.mock.calls).toEqual([['msg-2']]);
  expect(preview.props.numberOfLines).toBe(1);
  expect(screen.queryByTestId('pinned-messages-sheet')).toBeNull();
  expect(screen.queryByRole('button', { name: 'chat.pin.openList:1' })).toBeNull();
});

test('a multiple-pin banner still jumps to the newest pin', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [notePin, textPin, imagePin] };
  const onJump = jest.fn();
  render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);
  expect(screen.queryByText('下周六 9 点集合')).toBeNull();
  fireEvent.press(screen.getByText('[笔记] 周末羽毛球场地'));
  expect(onJump.mock.calls).toEqual([['msg-3']]);
  expect(screen.getByRole('button', { name: 'chat.pin.jumpA11y:[笔记] 周末羽毛球场地' })).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.queryByTestId('pinned-messages-sheet')).toBeNull();
});

test('once the last pin is gone, a later pin shows the banner with the list closed', () => {
  mockConversation = { ...mockConversation, myRole: 'ADMIN' };
  const view = render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList(1);
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

test('the count opens the list without jumping and each row jumps to its message', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [notePin, textPin, imagePin] };
  const onJump = jest.fn();
  render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);

  openList(3);
  expect(screen.getByTestId('pinned-messages-sheet')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'chat.pin.listHeading' })).toBeTruthy();
  expect(screen.getByText('chat.pin.listCount:3')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'chat.pin.jumpA11y:下周六 9 点集合' })).toBeTruthy();
  expect(onJump).not.toHaveBeenCalled();

  fireEvent.press(screen.getByRole('button', { name: 'chat.pin.jumpA11y:[图片]' }));
  expect(onJump.mock.calls).toEqual([['msg-1']]);
  expect(screen.queryByTestId('pinned-messages-sheet')).toBeNull();
});

test('close dismisses the list without jumping', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [notePin, imagePin] };
  const onJump = jest.fn();
  render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);
  openList(2);

  fireEvent.press(screen.getByRole('button', { name: 'common.close' }));
  expect(screen.queryByRole('header', { name: 'chat.pin.listHeading' })).toBeNull();
  expect(onJump).not.toHaveBeenCalled();
});

test('ordinary group members can open the list but not unpin', () => {
  mockConversation = { ...mockConversation, pinnedMessages: [notePin, textPin] };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList(2);
  expect(screen.getByText('下周六 9 点集合')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^chat\.pin\.unpinA11y/ })).toBeNull();
});

test('a group admin unpins exactly the row they tap', async () => {
  mockConversation = { ...mockConversation, myRole: 'ADMIN', pinnedMessages: [notePin, textPin, imagePin] };
  const onJump = jest.fn();
  render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);
  openList(3);
  const unpin = screen.getByRole('button', { name: 'chat.pin.unpinA11y:下周六 9 点集合' });
  await act(async () => { fireEvent.press(unpin); });
  expect(jest.mocked(setChatPinnedMessage).mock.calls).toEqual([['conv-1', 'msg-2', false]]);
  expect(onJump).not.toHaveBeenCalled();
});

test('both sides of a direct chat can unpin', () => {
  mockConversation = { ...mockConversation, type: 'DIRECT', myRole: undefined };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList(1);
  expect(screen.getByRole('button', { name: 'chat.pin.unpinA11y:下周六 9 点集合' })).toBeTruthy();
});

test('a failed unpin tells the user and keeps the list open', async () => {
  mockConversation = { ...mockConversation, myRole: 'OWNER' };
  jest.mocked(setChatPinnedMessage).mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  openList(1);
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'chat.pin.unpinA11y:下周六 9 点集合' }));
  });
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
