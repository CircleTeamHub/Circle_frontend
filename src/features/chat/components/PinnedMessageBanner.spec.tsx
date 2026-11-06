import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PinnedMessageBanner } from './PinnedMessageBanner';
import { setChatPinnedMessage } from '@/chat-core/api';
import type { ChatConversationDto } from '@/chat-core/protocol';

let mockConversation: Partial<ChatConversationDto> | undefined;

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/chat-core/api', () => ({ setChatPinnedMessage: jest.fn(() => Promise.resolve()) }));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: { conversations: unknown[] }) => unknown) =>
    selector({ conversations: mockConversation ? [mockConversation] : [] }),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_e: unknown, fallback: string) => fallback }));

const pinned = { messageId: 'msg-1', height: 8, preview: '周六上午九点集合', pinnedAt: '2026-11-06T00:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  mockConversation = { id: 'conv-1', type: 'GROUP', myRole: 'MEMBER', pinnedMessage: pinned };
});

test('everyone sees the pinned message and tapping it jumps there', () => {
  const onJump = jest.fn();
  render(<PinnedMessageBanner conversationID="conv-1" onJump={onJump} />);
  expect(screen.getByText('周六上午九点集合')).toBeTruthy();
  fireEvent.press(screen.getByText('周六上午九点集合'));
  expect(onJump).toHaveBeenCalledWith('msg-1');
});

test('an ordinary group member cannot unpin from the banner', () => {
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.queryByLabelText('chat.pin.unpin')).toBeNull();
});

test('a group admin can unpin from the banner', async () => {
  mockConversation = { ...mockConversation, myRole: 'ADMIN' };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  await act(async () => { fireEvent.press(screen.getByLabelText('chat.pin.unpin')); });
  expect(setChatPinnedMessage).toHaveBeenCalledWith('conv-1', null);
});

test('nothing renders when no message is pinned', () => {
  mockConversation = { ...mockConversation, pinnedMessage: null };
  render(<PinnedMessageBanner conversationID="conv-1" onJump={jest.fn()} />);
  expect(screen.queryByTestId('pinned-message-banner')).toBeNull();
});
