import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ForwardPickerScreen from './ForwardPickerScreen';
import type { ChatTarget } from '@/features/chat/components/chat-target-picker/types';

const mockPending = { message: { type: 'received', text: 'hello' } };
let mockPendingValue: typeof mockPending | null;
let mockPendingBatch: typeof mockPending[] | null;
let mockPickTargets: ChatTarget[] = [];
const mockClearPending = jest.fn();
const mockSendText = jest.fn();
const mockStartChatSend = jest.fn();
const mockRecord = jest.fn();
const mockResolve = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockShowTopNotice = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  router: { push: (...args: unknown[]) => mockPush(...args), navigate: (...args: unknown[]) => mockNavigate(...args) },
}));
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
    pending: mockPendingValue, pendingBatch: mockPendingBatch, clear: mockClearPending,
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
  resolveChatTargets: async (targets: ChatTarget[]) => {
    const resolved: { target: ChatTarget; conversationId: string }[] = [];
    const failed: { target: ChatTarget; error: unknown }[] = [];
    for (const target of targets) {
      try {
        resolved.push({ target, conversationId: await mockResolve(target) });
      } catch (error) {
        failed.push({ target, error });
      }
    }
    return { resolved, failed };
  },
  chatTargetResolveFailureMessage: () => 'resolve.failed',
}));
jest.mock('@/chat-core/send-errors', () => ({
  getChatSendErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/components/app/top-notice-store', () => ({ showTopNotice: (...args: unknown[]) => mockShowTopNotice(...args) }));
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

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockPendingValue = mockPending;
  mockPendingBatch = null;
  mockPickTargets = [chat('direct-1')];
  mockSendText.mockResolvedValue(undefined);
  mockResolve.mockImplementation((target: ChatTarget) => Promise.resolve(target.conversationId ?? `created-${target.userId}`));
  mockStartChatSend.mockImplementation((send: (onCreate: () => void) => Promise<unknown>) => ({ queued: true, delivered: send(jest.fn()) }));
});

afterEach(() => alertSpy.mockRestore());

type AlertButton = { text: string; onPress?: () => void };
/** 「已发送」弹窗的两个按钮:确定、查看。 */
function sentButtons(): AlertButton[] {
  const call = alertSpy.mock.calls.find(([title]) => title === 'chat.targetPicker.sent');
  if (!call) throw new Error('「已发送」弹窗没有弹出');
  return call[2] as AlertButton[];
}

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

test('confirming says "sent" right away, before the forward has gone out', () => {
  mockStartChatSend.mockImplementation(() => ({ queued: true, delivered: new Promise(() => undefined) }));
  render(<ForwardPickerScreen />);
  pick();
  expect(alertSpy).toHaveBeenCalledWith('chat.targetPicker.sent', undefined, expect.any(Array));
  expect(sentButtons().map((button) => button.text)).toEqual(['common.confirm', 'chat.targetPicker.view']);
  expect(mockBack).not.toHaveBeenCalled();
});

test('a confirmed single target forwards the message and remembers the chat', async () => {
  render(<ForwardPickerScreen />);
  pick();
  await waitFor(() => expect(mockRecord).toHaveBeenCalledWith('me', [expect.objectContaining({ conversationId: 'direct-1' })]));
  expect(mockSendText).toHaveBeenCalledTimes(1);
  expect(mockSendText).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'direct-1', text: 'hello' }));
});

test('"confirm" in the sent dialog clears the pending forward and closes the page', () => {
  render(<ForwardPickerScreen />);
  pick();
  sentButtons()[0].onPress?.();
  expect(mockClearPending).toHaveBeenCalled();
  expect(mockBack).toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});

test('"view" opens the chat it was sent to, including a friend with no chat yet', async () => {
  mockPickTargets = [{ key: 'user:u2', conversationId: null, userId: 'u2', name: '小王', kind: 'direct' }];
  render(<ForwardPickerScreen />);
  pick();
  sentButtons()[1].onPress?.();
  expect(mockBack).toHaveBeenCalled();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(tabs)/messages/chat-detail',
    params: expect.objectContaining({
      conversationID: 'created-u2', sourceID: 'u2', title: '小王', conversationType: 'private',
    }),
  }));
});

test('"view" after sending to a group opens it as a group chat', async () => {
  mockPickTargets = [chat('group-1', 'group')];
  render(<ForwardPickerScreen />);
  pick();
  sentButtons()[1].onPress?.();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(tabs)/messages/chat-detail',
    params: expect.objectContaining({ conversationID: 'group-1', sourceID: 'group-1', conversationType: 'group' }),
  }));
});

test('"view" after sending to several chats goes to the message list', () => {
  mockPickTargets = [chat('direct-1'), chat('group-1', 'group')];
  render(<ForwardPickerScreen />);
  pick();
  sentButtons()[1].onPress?.();
  expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/messages');
  expect(mockPush).not.toHaveBeenCalled();
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
  // 留言等这个聊天的转发内容都送达后才发:每个聊天里都排在最后。
  const sentTo = (conversationId: string) => mockSendText.mock.calls
    .map(([options]) => options)
    .filter((options) => options.conversationId === conversationId)
    .map((options) => options.text);
  expect(sentTo('group-1')).toEqual(['first', 'second', '一起看看']);
  expect(sentTo('created-u2')).toEqual(['first', 'second', '一起看看']);
});

test('a chat that cannot be opened is reported, and the others still get it', async () => {
  mockPickTargets = [chat('direct-1'), { key: 'user:u9', conversationId: null, userId: 'u9', name: '拉黑我的人', kind: 'direct' }];
  mockResolve
    .mockImplementationOnce((target: ChatTarget) => Promise.resolve(target.conversationId))
    .mockImplementationOnce(() => Promise.reject(new Error('CHAT_BLOCKED')));
  render(<ForwardPickerScreen />);
  pick();
  await waitFor(() => expect(mockShowTopNotice).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error', title: 'chat.forward.failed', message: 'resolve.failed' }),
  ));
  await waitFor(() => expect(mockSendText).toHaveBeenCalledTimes(1));
  expect(mockSendText.mock.calls.map(([options]) => options.conversationId)).toEqual(['direct-1']);
  expect(mockRecord).toHaveBeenCalledWith('me', [expect.objectContaining({ conversationId: 'direct-1' })]);
});

test('a forward the client refuses names the chat in a top notice and skips the caption', async () => {
  mockPendingBatch = [{ message: { type: 'received', text: 'first' } }, { message: { type: 'received', text: 'second' } }];
  mockStartChatSend
    .mockImplementationOnce((send: (onCreate: () => void) => Promise<unknown>) => ({ queued: true, delivered: send(jest.fn()) }))
    .mockImplementationOnce(() => ({ queued: false, delivered: Promise.reject(new Error('blocked')) }));
  render(<ForwardPickerScreen />);
  pick('不会发出');
  await waitFor(() => expect(mockShowTopNotice).toHaveBeenCalledWith(expect.objectContaining({
    type: 'error', title: 'chat.forward.failed', message: 'name-direct-1：chat.forward.failedRetry',
  })));
  // 转发没发完时附言也不发,免得对方只收到一句没头没尾的话。
  expect(mockSendText.mock.calls.map(([options]) => options.text)).toEqual(['first']);
  expect(mockRecord).not.toHaveBeenCalled();
});

test('the caption is held back when the forwarded content was rejected', async () => {
  mockStartChatSend.mockImplementationOnce(() => ({ queued: true, delivered: Promise.reject(new Error('rejected')) }));
  render(<ForwardPickerScreen />);
  pick('看看这个');
  await waitFor(() => expect(mockShowTopNotice).toHaveBeenCalled());
  expect(mockStartChatSend).toHaveBeenCalledTimes(1);
});
