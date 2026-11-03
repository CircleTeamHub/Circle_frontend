import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ForwardPickerScreen from './ForwardPickerScreen';
import type { ChatConversationDto } from '@/chat-core/protocol';

let mockConversations: ChatConversationDto[];
const mockGroupAvatar = jest.fn<null, [unknown]>(() => null);
const mockPending = { message: { type: 'received', text: 'hello' } };
let mockPendingBatch: typeof mockPending[] | null;
const mockSetPendingBatch = jest.fn((items: typeof mockPending[]) => { mockPendingBatch = items; });
const mockClearPending = jest.fn();
const mockSendText = jest.fn();
const mockStartChatSend = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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
jest.mock('@/services/api/utils', () => ({ normalizeMediaUrl: (url: string) => url }));
jest.mock('@/utils/locale', () => ({ getLocalizedDateTimeLocale: () => 'en-US' }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({
  GroupChatAvatar: (props: unknown) => mockGroupAvatar(props),
}));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/keyboard-dismiss', () => ({ keyboardDismissOnDragProps: {} }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/chat/store/use-message-forward-store', () => ({
  useMessageForwardStore: (selector: (state: unknown) => unknown) => selector({ pending: mockPending, pendingBatch: mockPendingBatch, setPendingBatch: mockSetPendingBatch, clear: mockClearPending }),
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) => selector({ conversations: mockConversations }),
}));
jest.mock('@/chat-core/api', () => ({ loadChatConversations: jest.fn() }));
jest.mock('@/chat-core/send-handle', () => ({ startChatSend: (send: (onCreate: () => void) => Promise<unknown>) => mockStartChatSend(send) }));
jest.mock('@/chat-core/client', () => ({
  sendCardMessage: jest.fn(), sendForwardedMediaMessage: jest.fn(),
  sendLocationMessage: jest.fn(), sendTextMessage: (...args: unknown[]) => mockSendText(...args),
}));
jest.mock('@/features/chat/utils/note-card-fresh-status', () => ({ withFreshNoteSourceStatus: jest.fn() }));
jest.mock('@/theme', () => ({
  Radius: { md: 8, lg: 12 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', text: '#111', textSecondary: '#666' } }),
}));

const group = (overrides: Partial<ChatConversationDto> = {}): ChatConversationDto => ({
  id: 'group-1', type: 'GROUP', peer: null, circleId: null, circle: null,
  name: '周末爬山', avatarUrl: 'https://cdn.example/group.jpg',
  lastMessage: null, unreadCount: 0, pinned: false, muted: false, lastMessageAt: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockConversations = [group()];
  mockPendingBatch = null;
  mockSendText.mockResolvedValue(undefined);
  mockStartChatSend.mockImplementation((send: (onCreate: () => void) => Promise<unknown>) => ({ queued: true, delivered: send(jest.fn()) }));
});

test('standalone group forwarding shows and searches its group name and avatar', () => {
  render(<ForwardPickerScreen />);
  expect(screen.getByText('周末爬山')).toBeTruthy();
  expect(mockGroupAvatar).toHaveBeenCalledWith(expect.objectContaining({
    name: '周末爬山', uri: 'https://cdn.example/group.jpg',
  }));
  fireEvent.changeText(screen.getByPlaceholderText('chat.forward.searchPlaceholder'), '爬山');
  expect(screen.getByText('周末爬山')).toBeTruthy();
});

test('forward targets use the same personal group remark as the conversation list', () => {
  mockConversations = [group({ myRemark: '  我的登山队  ' })];
  render(<ForwardPickerScreen />);
  expect(screen.getByText('我的登山队')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('chat.forward.searchPlaceholder'), '登山队');
  expect(screen.getByText('我的登山队')).toBeTruthy();
});

test('an unnamed standalone group uses the group fallback title', () => {
  mockConversations = [group({ name: null })];
  render(<ForwardPickerScreen />);
  expect(screen.getByText('群聊')).toBeTruthy();
});

test('TEMP targets render and search the room title through the shared conversation mapper', () => {
  mockConversations = [group({ type: 'TEMP', name: '旧群名', tempChat: { id: 'room-1', title: '临时接待房' } })];
  render(<ForwardPickerScreen />);
  expect(screen.getByText('临时接待房')).toBeTruthy();
  expect(mockGroupAvatar).toHaveBeenCalledWith(expect.objectContaining({ name: '临时接待房', temporary: true }));
  fireEvent.changeText(screen.getByPlaceholderText('chat.forward.searchPlaceholder'), '接待');
  expect(screen.getByText('临时接待房')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('chat.forward.searchPlaceholder'), '旧群名');
  expect(screen.queryByText('临时接待房')).toBeNull();
});

test('a selected batch forwards each message to the chosen target in order', async () => {
  mockPendingBatch = [{ message: { type: 'received', text: 'first' } }, { message: { type: 'received', text: 'second' } }];
  render(<ForwardPickerScreen />);
  fireEvent.press(screen.getByText('周末爬山'));
  await waitFor(() => expect(mockSendText).toHaveBeenCalledTimes(2));
  expect(mockSendText.mock.calls.map(([options]) => options.text)).toEqual(['first', 'second']);
  expect(mockSendText.mock.calls.every(([options]) => options.conversationId === 'group-1')).toBe(true);
  expect(mockClearPending).toHaveBeenCalled();
});

test('a partial batch failure retains only unsent messages for retry', async () => {
  const first = { message: { type: 'received', text: 'first' } };
  const second = { message: { type: 'received', text: 'second' } };
  mockPendingBatch = [first, second];
  mockStartChatSend.mockImplementationOnce((send: (onCreate: () => void) => Promise<unknown>) => ({ queued: true, delivered: send(jest.fn()) }))
    .mockImplementationOnce(() => ({ queued: false, delivered: Promise.reject(new Error('blocked')) }));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<ForwardPickerScreen />);
  fireEvent.press(screen.getByText('周末爬山'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('chat.forward.failed', 'chat.forward.failedRetry'));
  expect(mockSetPendingBatch).toHaveBeenLastCalledWith([second]);
  expect(mockClearPending).not.toHaveBeenCalled();
  alert.mockRestore();
});
