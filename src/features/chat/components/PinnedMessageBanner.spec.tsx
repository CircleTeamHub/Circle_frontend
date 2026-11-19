import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PinnedMessageBanner } from './PinnedMessageBanner';
import { setChatPinnedMessage } from '@/chat-core/api';
import type { ChatConversationDto, ChatPinnedMessageDto } from '@/chat-core/protocol';
import { useChatPreferencesStore } from '@/features/chat/store/use-chat-preferences-store';

let mockConversation: Partial<ChatConversationDto> | undefined;

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
jest.mock('@/storage', () => ({ mmkvJsonStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }));
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

beforeEach(() => {
  jest.clearAllMocks();
  useChatPreferencesStore.setState({ pinsExpandedByConversationID: {} });
  mockConversation = { id: 'conv-1', type: 'GROUP', myRole: 'MEMBER', pinnedMessages: [textPin] };
});

describe('a single pin', () => {
  test('everyone sees it and tapping it jumps there', () => {
    const onJump = jest.fn();
    render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);
    fireEvent.press(screen.getByText('下周六 9 点集合'));
    expect(onJump).toHaveBeenCalledWith('msg-2');
    expect(screen.queryByLabelText('chat.pin.expand')).toBeNull();
  });

  test('an ordinary group member cannot unpin it', () => {
    render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
    expect(screen.queryByLabelText('chat.pin.unpin')).toBeNull();
  });

  test('a group admin unpins exactly that message', async () => {
    mockConversation = { ...mockConversation, myRole: 'ADMIN' };
    render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
    await act(async () => { fireEvent.press(screen.getByLabelText('chat.pin.unpin')); });
    expect(setChatPinnedMessage).toHaveBeenCalledWith('conv-1', 'msg-2', false);
  });
});

describe('several pins', () => {
  beforeEach(() => {
    mockConversation = { ...mockConversation, myRole: 'ADMIN', pinnedMessages: [notePin, textPin, imagePin] };
  });

  test('start collapsed to one line: the newest pin plus the count', () => {
    render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
    expect(screen.getByText('[笔记] 周末羽毛球场地')).toBeTruthy();
    expect(screen.queryByText('下周六 9 点集合')).toBeNull();
    expect(screen.getByText('chat.pin.count:3')).toBeTruthy();
    // 收起时不在这一行上取消置顶:× 只出现在展开后的逐条里。
    expect(screen.queryByLabelText('chat.pin.unpin')).toBeNull();
  });

  test('expand to list them all, jump from any row, and collapse again', () => {
    const onJump = jest.fn();
    render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);

    fireEvent.press(screen.getByLabelText('chat.pin.expand'));
    expect(screen.getByText('chat.pin.listTitle:3')).toBeTruthy();
    expect(screen.getByText('[笔记] 周末羽毛球场地')).toBeTruthy();
    expect(screen.getByText('下周六 9 点集合')).toBeTruthy();
    expect(screen.getByText('[图片]')).toBeTruthy();
    expect(screen.getAllByLabelText('chat.pin.unpin')).toHaveLength(3);

    fireEvent.press(screen.getByText('[图片]'));
    expect(onJump).toHaveBeenCalledWith('msg-1');

    fireEvent.press(screen.getByLabelText('chat.pin.collapse'));
    expect(screen.queryByText('下周六 9 点集合')).toBeNull();
  });

  test('the expanded state is remembered per conversation', () => {
    const first = render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('chat.pin.expand'));
    first.unmount();

    expect(useChatPreferencesStore.getState().pinsExpandedByConversationID).toEqual({ 'conv-1': true });
    render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
    expect(screen.getByText('下周六 9 点集合')).toBeTruthy();
  });

  test('an admin unpins one row from the expanded list', async () => {
    render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('chat.pin.expand'));
    await act(async () => { fireEvent.press(screen.getAllByLabelText('chat.pin.unpin')[1]); });
    expect(setChatPinnedMessage).toHaveBeenCalledWith('conv-1', 'msg-2', false);
  });

  test('ordinary members can expand but not unpin', () => {
    mockConversation = { ...mockConversation, myRole: 'MEMBER' };
    render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('chat.pin.expand'));
    expect(screen.getByText('[图片]')).toBeTruthy();
    expect(screen.queryByLabelText('chat.pin.unpin')).toBeNull();
  });
});

test.each([
  ['an empty list', []],
  ['an old server without the field', undefined],
])('nothing renders for %s', (_case, pinnedMessages) => {
  mockConversation = { ...mockConversation, pinnedMessages };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.queryByTestId('pinned-message-banner')).toBeNull();
});
