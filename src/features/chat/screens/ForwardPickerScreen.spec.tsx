import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ForwardPickerScreen from './ForwardPickerScreen';
import type { ChatTarget } from '@/features/chat/components/chat-target-picker/types';

const mockPending = { message: { type: 'received', text: 'hello' } };
let mockPendingValue: typeof mockPending | null;
let mockPendingBatch: typeof mockPending[] | null;
let mockPickTargets: ChatTarget[] = [];
const mockSetPendingBatch = jest.fn((items: typeof mockPending[]) => { mockPendingBatch = items; });
const mockClearPending = jest.fn();
const mockSendText = jest.fn();
const mockStartChatSend = jest.fn();
const mockRecord = jest.fn();
const mockResolve = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key },
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
jest.mock('@/features/chat/store/use-message-forward-store', () => ({
  useMessageForwardStore: (selector: (state: unknown) => unknown) => selector({
    pending: mockPendingValue, pendingBatch: mockPendingBatch, setPendingBatch: mockSetPendingBatch, clear: mockClearPending,
  }),
}));
jest.mock('@/chat-core/send-handle', () => ({ startChatSend: (send: (onCreate: () => void) => Promise<unknown>) => mockStartChatSend(send) }));
jest.mock('@/chat-core/client', () => ({
  sendCardMessage: jest.fn(), sendForwardedMediaMessage: jest.fn(),
  sendLocationMessage: jest.fn(), sendTextMessage: (...args: unknown[]) => mockSendText(...args),
}));
jest.mock('@/chat-core/mappers', () => ({ getChatMessagePreview: () => '' }));
jest.mock('@/theme', () => ({
  Spacing: { lg: 16 },
  Typography: { small: {} },
  useTheme: () => ({ colors: { background: '#fff', textSecondary: '#666' } }),
}));
jest.mock('@/features/chat/components/chat-target-picker/resolve-chat-target', () => ({
  resolveChatTargetConversationId: (target: ChatTarget) => mockResolve(target),
}));
jest.mock('@/features/chat/components/chat-target-picker/use-recent-forward-targets-store', () => ({
  useRecentForwardTargetsStore: (selector: (state: { record: jest.Mock }) => unknown) => selector({ record: mockRecord }),
}));
jest.mock('@/features/chat/components/chat-target-picker/ChatTargetPicker', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    ChatTargetPicker: ({ onConfirm }: { onConfirm: (targets: ChatTarget[]) => void }) => (
      <Pressable onPress={() => onConfirm(mockPickTargets)}><Text>picker.pick</Text></Pressable>
    ),
  };
});
jest.mock('@/features/chat/components/send-confirm-dialog', () => {
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native');
  const { useState } = jest.requireActual('react');
  return {
    SendConfirmDialog: ({ visible, title, children, placeholder, onCancel, onConfirm }: {
      visible: boolean; title: string; children?: React.ReactNode; placeholder: string;
      onCancel: () => void; onConfirm: (caption: string) => void;
    }) => {
      const [caption, setCaption] = useState('');
      if (!visible) return null;
      return (
        <View>
          <Text>{title}</Text>
          {children}
          <TextInput placeholder={placeholder} value={caption} onChangeText={setCaption} />
          <Pressable onPress={onCancel}><Text>dialog.cancel</Text></Pressable>
          <Pressable onPress={() => onConfirm(caption.trim())}><Text>dialog.send</Text></Pressable>
        </View>
      );
    },
  };
});

const chat = (id: string, kind: ChatTarget['kind'] = 'direct'): ChatTarget => ({
  key: id, conversationId: id, userId: null, name: `name-${id}`, kind,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPendingValue = mockPending;
  mockPendingBatch = null;
  mockPickTargets = [chat('direct-1')];
  mockSendText.mockResolvedValue(undefined);
  mockResolve.mockImplementation((target: ChatTarget) => Promise.resolve(target.conversationId ?? `created-${target.userId}`));
  mockStartChatSend.mockImplementation((send: (onCreate: () => void) => Promise<unknown>) => ({ queued: true, delivered: send(jest.fn()) }));
});

function pick(caption = '') {
  fireEvent.press(screen.getByText('picker.pick'));
  if (caption) {
    fireEvent.changeText(screen.getByPlaceholderText('chat.forward.captionPlaceholder'), caption);
  }
  fireEvent.press(screen.getByText('dialog.send'));
}

test('without a pending message the page shows the empty state', () => {
  mockPendingValue = null;
  render(<ForwardPickerScreen />);
  expect(screen.getByText('chat.forward.empty')).toBeTruthy();
  expect(screen.queryByText('picker.pick')).toBeNull();
});

test('picking a chat asks for confirmation before anything is sent', () => {
  render(<ForwardPickerScreen />);
  fireEvent.press(screen.getByText('picker.pick'));
  expect(screen.getByText('chat.forward.sendTo')).toBeTruthy();
  expect(mockStartChatSend).not.toHaveBeenCalled();
});

test('cancelling the confirmation forwards nothing and keeps the pending message', () => {
  render(<ForwardPickerScreen />);
  fireEvent.press(screen.getByText('picker.pick'));
  fireEvent.press(screen.getByText('dialog.cancel'));
  expect(mockStartChatSend).not.toHaveBeenCalled();
  expect(mockClearPending).not.toHaveBeenCalled();
});

test('a confirmed single target forwards the message and remembers the chat', async () => {
  render(<ForwardPickerScreen />);
  pick();
  await waitFor(() => expect(mockClearPending).toHaveBeenCalled());
  expect(mockSendText).toHaveBeenCalledTimes(1);
  expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'direct-1', text: 'hello' }));
  expect(mockRecord).toHaveBeenCalledWith('me', [expect.objectContaining({ conversationId: 'direct-1' })]);
});

test('several targets each get every message, then the caption', async () => {
  mockPendingBatch = [{ message: { type: 'received', text: 'first' } }, { message: { type: 'received', text: 'second' } }];
  mockPickTargets = [chat('group-1', 'group'), { key: 'user:u2', conversationId: null, userId: 'u2', name: '小王', kind: 'direct' }];
  render(<ForwardPickerScreen />);
  fireEvent.press(screen.getByText('picker.pick'));
  expect(screen.getByText('chat.forward.sendToMany')).toBeTruthy();
  expect(screen.getByText('chat.forward.batchPreview')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('chat.forward.captionPlaceholder'), '  一起看看  ');
  fireEvent.press(screen.getByText('dialog.send'));
  await waitFor(() => expect(mockSendText).toHaveBeenCalledTimes(6));
  expect(mockSendText.mock.calls.map(([options]) => `${options.conversationId}:${options.text}`)).toEqual([
    'group-1:first', 'group-1:second', 'group-1:一起看看',
    'created-u2:first', 'created-u2:second', 'created-u2:一起看看',
  ]);
  expect(mockClearPending).toHaveBeenCalled();
});

test('a partial batch failure to one chat retains only the unsent messages for retry', async () => {
  const first = { message: { type: 'received', text: 'first' } };
  const second = { message: { type: 'received', text: 'second' } };
  mockPendingBatch = [first, second];
  mockStartChatSend.mockImplementationOnce((send: (onCreate: () => void) => Promise<unknown>) => ({ queued: true, delivered: send(jest.fn()) }))
    .mockImplementationOnce(() => ({ queued: false, delivered: Promise.reject(new Error('blocked')) }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    render(<ForwardPickerScreen />);
    pick('不会发出');
    await waitFor(() => expect(alert).toHaveBeenCalledWith('chat.forward.failed', 'chat.forward.failedRetry'));
    expect(mockSetPendingBatch).toHaveBeenLastCalledWith([second]);
    expect(mockClearPending).not.toHaveBeenCalled();
    // 转发没发完时附言也不发,免得对方只收到一句没头没尾的话。
    expect(mockSendText.mock.calls.map(([options]) => options.text)).toEqual(['first']);
  } finally { alert.mockRestore(); }
});

test('a chat that cannot be opened reports failure without sending', async () => {
  mockResolve.mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    render(<ForwardPickerScreen />);
    pick();
    await waitFor(() => expect(alert).toHaveBeenCalledWith('chat.forward.failed', 'chat.forward.failedRetry'));
    expect(mockStartChatSend).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});
