import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton, type GestureResponderEvent } from 'react-native';
import type { ChatMessage } from '@/types';
import { useMessageActions, type MessageActionsParams } from './use-message-actions';

const mockRetry = jest.fn();
const mockSaveMedia = jest.fn();
const mockSaveSticker = jest.fn();
jest.mock('@/features/chat/store/use-sticker-store', () => ({ useStickerStore: { getState: () => ({ save: mockSaveSticker }) } }));
const mockForwardBatch = jest.fn();
const mockRemoveMessage = jest.fn();
jest.mock('@/utils/save-image', () => ({ saveMediaToLibrary: (...args: unknown[]) => mockSaveMedia(...args) }));
jest.mock('@/features/chat/utils/sticker-error', () => ({ getStickerErrorMessage: (_error: unknown, _t: unknown, fallback: string) => fallback }));
const mockChat: {
  activeConversationId: string;
  messagesByConversation: Record<string, Record<string, unknown>[]>;
  conversations: { id: string; type?: string; myRole?: string | null; pinnedMessage?: { messageId: string } | null }[];
  removeMessage: jest.Mock;
} = {
  activeConversationId: 'c1',
  messagesByConversation: { c1: [{ id: 'local-1', d: 'd-1', height: 0, failed: true }] },
  conversations: [],
  removeMessage: mockRemoveMessage,
};
const mockAuth = { sessionEpoch: 1 };
jest.mock('@/chat-core/client', () => ({ retryFailedChatMessage: (...args: unknown[]) => mockRetry(...args) }));
jest.mock('@/chat-core/store', () => ({ useChatStore: { getState: () => mockChat } }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/features/chat/store/use-message-forward-store', () => ({
  useMessageForwardStore: (selector: (state: unknown) => unknown) => selector({ setPending: jest.fn(), setPendingBatch: mockForwardBatch }),
}));
jest.mock('@/chat-core/socket-manager', () => ({}));
const mockSetPinned = jest.fn(() => Promise.resolve());
jest.mock('@/chat-core/api', () => ({ setChatPinnedMessage: (...args: unknown[]) => mockSetPinned(...(args as [])) }));
jest.mock('@/chat-core/send-errors', () => ({ getChatSendErrorMessage: () => '发送失败' }));
jest.mock('@/features/chat/screens/ForwardPickerScreen', () => ({ canForwardMessage: () => false }));

const failed: ChatMessage = { id: 'local-1', type: 'sent', sendStatus: 3, deliveryId: 'd-1' };
let buttons: AlertButton[];
let params: MessageActionsParams;

beforeEach(() => {
  mockRetry.mockReset().mockResolvedValue(undefined);
  mockSaveMedia.mockReset().mockResolvedValue('saved');
  mockSaveSticker.mockReset().mockResolvedValue(undefined);
  mockForwardBatch.mockReset();
  mockRemoveMessage.mockReset();
  mockAuth.sessionEpoch = 1;
  mockChat.activeConversationId = 'c1';
  mockChat.messagesByConversation.c1[0] = { id: 'local-1', d: 'd-1', height: 0, failed: true };
  mockChat.conversations = [];
  buttons = [];
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, actions) => { buttons = actions ?? []; });
  params = {
    t: ((key: string) => key) as MessageActionsParams['t'],
    setDraft: jest.fn(), setSendError: jest.fn(), mountedRef: { current: true },
    reuploadPendingMediaRef: { current: jest.fn() }, sourceID: 'peer', conversationID: 'c1',
    conversationBurnEnabled: false, isGroupChat: false, conversationTitle: 'chat', scope: 'messages',
    setQuoteTarget: jest.fn(), setEditingMessageId: jest.fn(), handleCollectMessage: jest.fn(),
    messages: [],
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

test('long press captures the screen point for the floating menu without opening an alert', () => {
  const { result } = renderHook(() => useMessageActions(params));
  const message: ChatMessage = { id: 'm1', type: 'received', text: 'hello' };
  act(() => result.current.getMessageLongPressHandler(message)({ nativeEvent: { pageX: 125, pageY: 275 } } as GestureResponderEvent));
  expect(result.current.actionMenu).toEqual({ message, x: 125, y: 275 });
  expect(Alert.alert).not.toHaveBeenCalled();
});

test.each([
  { type: 'image', imageUrl: 'https://media.example.com/photo.jpg' },
  { type: 'video', videoUrl: 'https://media.example.com/video.mp4' },
])('confirmed $type can be saved from its message menu', async (media) => {
  const { result } = renderHook(() => useMessageActions(params));
  const message = { ...media, id: 'confirmed', sendStatus: 2 } as ChatMessage;
  act(() => result.current.setActionMenu({ message, x: 0, y: 0 }));
  const save = result.current.messageActions.find((action) => action.key === 'save');
  expect(save).toBeDefined();
  await act(async () => { save?.onPress(); });
  expect(mockSaveMedia).toHaveBeenCalledWith(
    media.type === 'video' ? media.videoUrl : media.imageUrl,
    media.type === 'video' ? { mimeType: 'video/mp4' } : undefined,
  );
});

test.each([
  { id: 'confirmed', burnDurationSec: 30 },
  { id: 'confirmed', burnExpiresAt: '2030-01-01T00:00:00Z' },
  { id: 'local:pending', sendStatus: 1 },
])('media menu cannot save disappearing or unconfirmed media (%o)', (fields) => {
  const { result } = renderHook(() => useMessageActions(params));
  const message = { type: 'video', videoUrl: 'https://media.example.com/private.mp4', ...fields } as ChatMessage;
  act(() => result.current.setActionMenu({ message, x: 0, y: 0 }));
  expect(result.current.messageActions.find((action) => action.key === 'save')).toBeUndefined();
});

test('save denial produces an actionable permission message', async () => {
  mockSaveMedia.mockResolvedValue('denied');
  const { result } = renderHook(() => useMessageActions(params));
  const message = { id: 'confirmed', type: 'video', videoUrl: 'https://media.example.com/video.mp4' } as ChatMessage;
  act(() => result.current.setActionMenu({ message, x: 0, y: 0 }));
  await act(async () => { result.current.messageActions.find((action) => action.key === 'save')?.onPress(); });
  expect(Alert.alert).toHaveBeenCalledWith('media.saveDeniedTitle', 'media.saveDeniedMessage');
});

test.each(['sent', 'received', 'image', 'video', 'note-card'] as const)('$type menu enters message selection', (type) => {
  const message: ChatMessage = { id: 'm1', type, text: 'hello' };
  params.messages = [message];
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.setActionMenu({ message, x: 0, y: 0 }));
  const select = result.current.messageActions.find((action) => action.key === 'multi-select');
  expect(select).toBeDefined();
  act(() => select?.onPress());
  expect(result.current.selectedMessageIds?.has('m1')).toBe(true);
});

test('selection toggles messages and batch deletion applies local tombstones only after confirmation', () => {
  params.messages = [{ id: 'm1', type: 'sent' }, { id: 'm2', type: 'image' }];
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.setActionMenu({ message: params.messages[0], x: 0, y: 0 }));
  act(() => result.current.messageActions.find((action) => action.key === 'multi-select')?.onPress());
  act(() => result.current.handleToggleSelectedMessage('m2'));
  expect(result.current.selectedMessages.map((message) => message.id)).toEqual(['m1', 'm2']);
  act(() => result.current.handleDeleteSelectedMessages());
  expect(mockRemoveMessage).not.toHaveBeenCalled();
  confirm();
  expect(mockRemoveMessage.mock.calls).toEqual([['c1', 'm1'], ['c1', 'm2']]);
  expect(result.current.selectedMessageIds).toBeNull();
});

test('canceling selection restores ordinary message interaction', () => {
  params.messages = [{ id: 'm1', type: 'sent' }];
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.setActionMenu({ message: params.messages[0], x: 0, y: 0 }));
  act(() => result.current.messageActions.find((action) => action.key === 'multi-select')?.onPress());
  act(() => result.current.handleCancelMessageSelection());
  expect(result.current.selectedMessageIds).toBeNull();
});

function selectMessages(result: { current: ReturnType<typeof useMessageActions> }, messages: ChatMessage[]) {
  act(() => result.current.setActionMenu({ message: messages[0], x: 0, y: 0 }));
  act(() => result.current.messageActions.find((action) => action.key === 'multi-select')?.onPress());
  for (const message of messages.slice(1)) act(() => result.current.handleToggleSelectedMessage(message.id));
}

test('batch saving saves eligible media in message order and reports unsupported items once', async () => {
  params.messages = [
    { id: 'video', type: 'video', videoUrl: 'https://media/video.mp4' },
    { id: 'text', type: 'received', text: 'hello' },
    { id: 'image', type: 'image', imageUrl: 'https://media/photo.jpg' },
    { id: 'private', type: 'image', imageUrl: 'https://media/private.jpg', burnDurationSec: 30 },
    { id: 'local:pending', type: 'image', imageUrl: 'file:///pending.jpg' },
  ];
  const { result } = renderHook(() => useMessageActions(params));
  selectMessages(result, params.messages);
  expect(result.current.canSaveSelectedMessages).toBe(true);
  await act(async () => { await result.current.handleSaveSelectedMessages(); });
  expect(mockSaveMedia.mock.calls).toEqual([
    ['https://media/photo.jpg', undefined], ['https://media/video.mp4', { mimeType: 'video/mp4' }],
  ]);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(Alert.alert).toHaveBeenCalledWith('media.savedTitle', 'chat.selection.saveResult');
  expect(result.current.selectedMessageIds).toBeNull();
});

test('partial batch save keeps failed messages selected and blocks duplicate presses', async () => {
  let finish!: (value: string) => void;
  mockSaveMedia.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce('failed');
  params.messages = [
    { id: 'last', type: 'image', imageUrl: 'https://media/last' },
    { id: 'first', type: 'image', imageUrl: 'https://media/first' },
  ];
  const { result } = renderHook(() => useMessageActions(params));
  selectMessages(result, params.messages);
  let saving!: Promise<void>;
  act(() => { saving = result.current.handleSaveSelectedMessages(); });
  expect(result.current.selectionProgress?.action).toBe('save');
  await act(async () => { await result.current.handleSaveSelectedMessages(); });
  expect(mockSaveMedia).toHaveBeenCalledTimes(1);
  await act(async () => { finish('saved'); await saving; });
  expect([...result.current.selectedMessageIds!]).toEqual(['last']);
  expect(result.current.selectionProgress).toBeNull();
});

test.each(['session', 'conversation', 'revoke', 'blur'] as const)('batch save rechecks the next message after %s changes', async (change) => {
  let finish!: (value: string) => void;
  mockSaveMedia.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  params.messages = [
    { id: 'next', type: 'image', imageUrl: 'https://media/next' },
    { id: 'first', type: 'image', imageUrl: 'https://media/first' },
  ];
  const { result, rerender } = renderHook(() => useMessageActions(params));
  selectMessages(result, params.messages);
  let saving!: Promise<void>;
  act(() => { saving = result.current.handleSaveSelectedMessages(); });
  if (change === 'session') mockAuth.sessionEpoch++;
  if (change === 'blur') mockChat.activeConversationId = '';
  if (change === 'conversation') { params = { ...params, conversationID: 'c2' }; rerender(undefined); }
  if (change === 'revoke') { params = { ...params, messages: [{ id: 'next', type: 'system-notice' }, params.messages[1]] }; rerender(undefined); }
  await act(async () => { finish('saved'); await saving; });
  expect(mockSaveMedia).toHaveBeenCalledTimes(1);
  if (change !== 'revoke') expect(Alert.alert).not.toHaveBeenCalled();
  if (change === 'blur') expect([...result.current.selectedMessageIds!]).toEqual(['next']);
});

test('batch collection awaits each result, skips protected messages and retains failures', async () => {
  params.messages = [
    { id: 'failed', type: 'received', text: 'later' },
    { id: 'protected', type: 'received', text: 'secret', burnDurationSec: 10 },
    { id: 'first', type: 'received', text: 'first' },
  ];
  jest.mocked(params.handleCollectMessage).mockResolvedValueOnce('collected').mockResolvedValueOnce('failed');
  const { result } = renderHook(() => useMessageActions(params));
  selectMessages(result, params.messages);
  expect(result.current.canCollectSelectedMessages).toBe(true);
  await act(async () => { await result.current.handleCollectSelectedMessages(); });
  expect(params.handleCollectMessage).toHaveBeenNthCalledWith(1, params.messages[2], { silent: true });
  expect(params.handleCollectMessage).toHaveBeenNthCalledWith(2, params.messages[0], { silent: true });
  expect([...result.current.selectedMessageIds!]).toEqual(['failed']);
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

test('denied album permission stops the batch and preserves unsaved selection', async () => {
  mockSaveMedia.mockResolvedValueOnce('denied');
  params.messages = [{ id: 'one', type: 'image', imageUrl: 'https://media/one' }, { id: 'two', type: 'image', imageUrl: 'https://media/two' }];
  const { result } = renderHook(() => useMessageActions(params));
  selectMessages(result, params.messages);
  await act(async () => { await result.current.handleSaveSelectedMessages(); });
  expect(mockSaveMedia).toHaveBeenCalledTimes(1);
  expect(result.current.selectedMessageIds?.size).toBe(2);
  expect(Alert.alert).toHaveBeenCalledWith('media.saveDeniedTitle', 'media.saveDeniedMessage');
});

test('an entirely skipped batch does not claim a successful collection', async () => {
  params.messages = [{ id: 'note', type: 'note-card' }];
  jest.mocked(params.handleCollectMessage).mockResolvedValue('skipped');
  const { result } = renderHook(() => useMessageActions(params));
  selectMessages(result, params.messages);
  await act(async () => { await result.current.handleCollectSelectedMessages(); });
  expect(Alert.alert).toHaveBeenCalledWith('chat.selection.noEligible', 'chat.selection.collectResult');
});

test('save-as-sticker uses only the confirmed message ID and shows success', async () => {
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.setActionMenu({ message: { id: 'confirmed', type: 'image', imageUrl: 'https://media.test/signed' }, x: 0, y: 0 }));
  const action = result.current.messageActions.find((item) => item.key === 'save-sticker');
  expect(action).toBeDefined();
  await act(async () => { action?.onPress(); });
  expect(mockSaveSticker).toHaveBeenCalledWith({ messageId: 'confirmed' });
  expect(Alert.alert).toHaveBeenCalledWith('chat.stickers.saved');
});

test.each([{ burnDurationSec: 30 }, { burnExpiresAt: '2030-01-01' }, { id: 'local:pending' }])('save-as-sticker is absent for ephemeral/unconfirmed media %o', (fields) => {
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.setActionMenu({ message: { id: 'confirmed', type: 'image', imageUrl: 'https://media.test/private', ...fields }, x: 0, y: 0 }));
  expect(result.current.messageActions.find((item) => item.key === 'save-sticker')).toBeUndefined();
});

test('save-as-sticker errors or account changes cannot claim success', async () => {
  let finish!: () => void;
  mockSaveSticker.mockImplementation(() => new Promise<void>((done) => { finish = done; }));
  const { result } = renderHook(() => useMessageActions(params));
  act(() => result.current.setActionMenu({ message: { id: 'confirmed', type: 'image', imageUrl: 'https://media.test/signed' }, x: 0, y: 0 }));
  act(() => result.current.messageActions.find((item) => item.key === 'save-sticker')?.onPress());
  expect(mockSaveSticker).toHaveBeenCalled();
  mockAuth.sessionEpoch++;
  await act(async () => { finish(); });
  expect(Alert.alert).not.toHaveBeenCalled();
});

describe('revoke entry', () => {
  const hourAgo = () => new Date(Date.now() - 60 * 60_000).toISOString();
  const others: ChatMessage = { id: 'm-others', type: 'received', text: 'hi', sendStatus: 2 };
  const arrange = (myRole: string | null, dto: Record<string, unknown> = {}) => {
    mockChat.conversations = [{ id: 'c1', myRole }];
    mockChat.messagesByConversation.c1 = [
      { id: 'm-others', height: 9, createdAt: hourAgo(), sender: { id: 'u2' }, ...dto },
    ];
  };
  const hasRevoke = () => {
    const { result } = renderHook(() => useMessageActions({ ...params, isGroupChat: true }));
    act(() => result.current.setActionMenu({ message: others, x: 0, y: 0 }));
    return result.current.messageActions.some((action) => action.key === 'revoke');
  };

  test.each(['OWNER', 'ADMIN'])('a group %s can revoke anyone else\'s message past the window', (role) => {
    arrange(role);
    expect(hasRevoke()).toBe(true);
  });

  test('a plain member cannot revoke other people\'s messages', () => {
    arrange('MEMBER');
    expect(hasRevoke()).toBe(false);
  });

  test('system notices have no author and stay unrevokable for managers too', () => {
    arrange('OWNER', { sender: null });
    expect(hasRevoke()).toBe(false);
  });

  test('already revoked messages offer no second revoke', () => {
    arrange('OWNER', { revokedAt: hourAgo() });
    expect(hasRevoke()).toBe(false);
  });
});

describe('pinning from the long-press menu', () => {
  const message: ChatMessage = { id: 'm1', type: 'image', sendStatus: 2 } as ChatMessage;
  const menuKeys = (current: ReturnType<typeof useMessageActions>) =>
    current.messageActions.map((action) => action.key);

  beforeEach(() => mockSetPinned.mockClear());

  test('either side of a private chat can pin any message, including images', async () => {
    mockChat.conversations = [{ id: 'c1', type: 'DIRECT', myRole: null, pinnedMessage: null }];
    const { result } = renderHook(() => useMessageActions(params));
    act(() => result.current.setActionMenu({ message, x: 0, y: 0 }));
    const pin = result.current.messageActions.find((action) => action.key === 'pin');
    expect(pin).toBeDefined();
    await act(async () => { pin?.onPress(); });
    expect(mockSetPinned).toHaveBeenCalledWith('c1', 'm1');
  });

  test('the pinned message offers unpin instead', async () => {
    mockChat.conversations = [{ id: 'c1', type: 'DIRECT', myRole: null, pinnedMessage: { messageId: 'm1' } }];
    const { result } = renderHook(() => useMessageActions(params));
    act(() => result.current.setActionMenu({ message, x: 0, y: 0 }));
    expect(menuKeys(result.current)).not.toContain('pin');
    await act(async () => { result.current.messageActions.find((action) => action.key === 'unpin')?.onPress(); });
    expect(mockSetPinned).toHaveBeenCalledWith('c1', null);
  });

  test('ordinary group members get no pin entry; admins do', () => {
    mockChat.conversations = [{ id: 'c1', type: 'GROUP', myRole: 'MEMBER', pinnedMessage: null }];
    const member = renderHook(() => useMessageActions({ ...params, isGroupChat: true }));
    act(() => member.result.current.setActionMenu({ message, x: 0, y: 0 }));
    expect(menuKeys(member.result.current)).not.toContain('pin');

    mockChat.conversations = [{ id: 'c1', type: 'GROUP', myRole: 'ADMIN', pinnedMessage: null }];
    const admin = renderHook(() => useMessageActions({ ...params, isGroupChat: true }));
    act(() => admin.result.current.setActionMenu({ message, x: 0, y: 0 }));
    expect(menuKeys(admin.result.current)).toContain('pin');
  });

  test.each([
    { id: 'local:pending', type: 'sent', sendStatus: 1 },
    { id: 'm2', type: 'call-record' },
    { id: 'm3', type: 'system-notice' },
    { id: 'm4', type: 'sent', sendStatus: 2, burnDurationSec: 30 },
  ])('cannot pin %o', (fields) => {
    mockChat.conversations = [{ id: 'c1', type: 'DIRECT', myRole: null, pinnedMessage: null }];
    const { result } = renderHook(() => useMessageActions(params));
    act(() => result.current.setActionMenu({ message: fields as ChatMessage, x: 0, y: 0 }));
    expect(menuKeys(result.current)).not.toContain('pin');
  });
});
