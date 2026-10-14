import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import type { ChatMessage } from '@/types';
import { useMessageActions, type MessageActionsParams } from './use-message-actions';

const mockRetry = jest.fn();
const mockChat = {
  activeConversationId: 'c1',
  messagesByConversation: { c1: [{ id: 'local-1', d: 'd-1', height: 0, failed: true }] },
};
const mockAuth = { sessionEpoch: 1 };
jest.mock('@/chat-core/client', () => ({ retryFailedChatMessage: (...args: unknown[]) => mockRetry(...args) }));
jest.mock('@/chat-core/store', () => ({ useChatStore: { getState: () => mockChat } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/features/chat/store/use-message-forward-store', () => ({
  useMessageForwardStore: () => jest.fn(),
}));
jest.mock('@/chat-core/socket-manager', () => ({}));
jest.mock('@/chat-core/api', () => ({}));
jest.mock('@/chat-core/send-errors', () => ({ getChatSendErrorMessage: () => '发送失败' }));
jest.mock('@/features/chat/screens/ForwardPickerScreen', () => ({ canForwardMessage: () => false }));

const failed: ChatMessage = { id: 'local-1', type: 'sent', sendStatus: 3, deliveryId: 'd-1' };
let buttons: AlertButton[];
let params: MessageActionsParams;

beforeEach(() => {
  mockRetry.mockReset().mockResolvedValue(undefined);
  mockAuth.sessionEpoch = 1;
  mockChat.activeConversationId = 'c1';
  mockChat.messagesByConversation.c1[0] = { id: 'local-1', d: 'd-1', height: 0, failed: true };
  buttons = [];
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, actions) => { buttons = actions ?? []; });
  params = {
    t: ((key: string) => key) as MessageActionsParams['t'],
    setDraft: jest.fn(), setSendError: jest.fn(), mountedRef: { current: true },
    reuploadPendingMediaRef: { current: jest.fn() }, sourceID: 'peer', conversationID: 'c1',
    conversationBurnEnabled: false, isGroupChat: false, conversationTitle: 'chat',
    setQuoteTarget: jest.fn(), setEditingMessageId: jest.fn(), handleCollectMessage: jest.fn(),
  };
});
afterEach(() => jest.restoreAllMocks());

function confirm() { act(() => { buttons[1].onPress?.(); }); }

test('tap asks for confirmation; cancel sends nothing; confirm reuses delivery id and media uploader', () => {
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.handleRetryMessage(failed));
  expect(mockRetry).not.toHaveBeenCalled();
  expect(buttons[0].style).toBe('cancel');
  act(() => { buttons[0].onPress?.(); });
  expect(mockRetry).not.toHaveBeenCalled();
  confirm();
  expect(mockRetry).toHaveBeenCalledWith('c1', 'd-1', { reuploadMedia: params.reuploadPendingMediaRef.current });
});

test.each(['session', 'conversation', 'unmount', 'confirmed', 'sending', 'deleted'])(
  'confirmation cannot resend after %s changes', (change) => {
    const { result } = renderHook(() => useMessageActions(params));
    act(() => result.current.handleRetryMessage(failed));
    if (change === 'session') mockAuth.sessionEpoch++;
    if (change === 'conversation') mockChat.activeConversationId = 'c2';
    if (change === 'unmount') params.mountedRef.current = false;
    if (change === 'confirmed') mockChat.messagesByConversation.c1[0].height = 5;
    if (change === 'sending') mockChat.messagesByConversation.c1[0].failed = false;
    if (change === 'deleted') mockChat.messagesByConversation.c1 = [];
    confirm();
    expect(mockRetry).not.toHaveBeenCalled();
  },
);

test('retry rejection shows an error and allows a later retry', async () => {
  mockRetry.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.handleRetryMessage(failed));
  confirm();
  await waitFor(() => expect(params.setSendError).toHaveBeenCalledWith('发送失败'));
  act(() => result.current.handleRetryMessage(failed));
  confirm();
  expect(mockRetry).toHaveBeenCalledTimes(2);
});

test('an old session retry rejection cannot change the new session error', async () => {
  let reject!: (error: Error) => void;
  mockRetry.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.handleRetryMessage(failed));
  confirm();
  mockAuth.sessionEpoch++;
  await act(async () => { reject(new Error('offline')); });
  expect(params.setSendError).toHaveBeenCalledTimes(1);
  expect(params.setSendError).toHaveBeenCalledWith(null);
});

test('long press resend uses the same guarded retry path', () => {
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.setActionMenu({ message: failed, x: 0, y: 0 }));
  act(() => result.current.messageActions.find((action) => action.key === 'resend')?.onPress());
  expect(mockRetry).toHaveBeenCalledWith('c1', 'd-1', { reuploadMedia: params.reuploadPendingMediaRef.current });
});
