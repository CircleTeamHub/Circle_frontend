import { act, renderHook } from '@testing-library/react-native';
import { sendCardMessage, sendForwardedMediaMessage, sendTextMessage } from '@/chat-core/client';
import { issueQrToken } from '@/services/api/qr';
import { useAttachmentActions, type AttachmentActionsParams } from './use-attachment-actions';
import type { UserCollection } from '@/services/api/collections';
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useSegments: () => ['(tabs)', 'messages', 'chat-detail'] }));
jest.mock('@/chat-core/client', () => ({ sendCardMessage: jest.fn(), sendVoiceMessage: jest.fn(), sendForwardedMediaMessage: jest.fn(async () => ({})), sendTextMessage: jest.fn(async () => ({})) }));
jest.mock('@/chat-core/send-handle', () => ({ startChatSend: (send: (onCreate: () => void) => Promise<unknown>) => ({ queued: false, delivered: send(() => undefined) }) }));
jest.mock('@/chat-core/send-errors', () => ({ getChatSendErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/features/chat/chat-detail/helpers', () => ({ logChatSendFailure: jest.fn() }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/services/api/qr', () => ({ issueQrToken: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => `api:${fallback}` }));
beforeEach(() => jest.clearAllMocks());
test('selecting a saved image sends media from its original message and never sends the placeholder', async () => {
 const sendDraftAsText = jest.fn();
 const params = { t: (key: string) => key, inFlightRef: { current: false }, mountedRef: { current: true }, sourceID: 'peer', conversationID: 'destination', conversationType: 'single', isPreviewMode: false, sendDraftAsText, setSendError: jest.fn() } as unknown as AttachmentActionsParams;
 const { result } = renderHook(() => useAttachmentActions(params));
 await act(async () => { await result.current.handlePickFavorite({ title: '[图片]', summary: '[图片]', sourceID: 'saved-image', payload: { kind: 'openim-message', messageID: 'saved-image', messageType: 'image' } } as UserCollection); });
 expect(sendForwardedMediaMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'destination', sourceMessageId: 'saved-image', type: 'image' }));
 expect(sendDraftAsText).not.toHaveBeenCalled();
 expect(sendTextMessage).not.toHaveBeenCalled();
});

test.each([false, true])('additional text follows the real saved image only when the primary send succeeds (rejected=%s)', async (rejected) => {
  const setSendError = jest.fn();
  const params = { t: (key: string) => key, inFlightRef: { current: false }, mountedRef: { current: true }, sourceID: 'peer', conversationID: 'destination', conversationType: 'single', isPreviewMode: false, sendDraftAsText: jest.fn(), setSendError } as unknown as AttachmentActionsParams;
  if (rejected) jest.mocked(sendForwardedMediaMessage).mockRejectedValueOnce(new Error('local rejection'));
  const { result } = renderHook(() => useAttachmentActions(params));
  const item = { title: '[图片]', summary: '[图片]', sourceID: 'saved-image', payload: { kind: 'openim-message', messageID: 'saved-image', messageType: 'image' } } as UserCollection;
  await act(async () => { await result.current.handlePickFavorite(item, '看一下😀'); });
  if (rejected) {
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(setSendError).toHaveBeenCalled();
  } else {
    expect(sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'destination', text: '看一下😀' }));
    expect(jest.mocked(sendForwardedMediaMessage).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(sendTextMessage).mock.invocationCallOrder[0]);
  }
});

describe('group card', () => {
  const group = { conversationId: 'g1', name: '周末羽毛球', avatarUrl: null };
  const build = () => {
    const setSendError = jest.fn();
    const params = { t: (key: string) => key, inFlightRef: { current: false }, mountedRef: { current: true }, sourceID: 'peer', conversationID: 'destination', conversationType: 'single', isPreviewMode: false, sendDraftAsText: jest.fn(), setSendError } as unknown as AttachmentActionsParams;
    return { params, setSendError };
  };

  test('issues a fresh group token and sends it as a group qr card', async () => {
    jest.mocked(issueQrToken).mockResolvedValue({ token: 'tok-1', type: 'GROUP', expiresAt: null });
    jest.mocked(sendCardMessage).mockResolvedValue({} as never);
    const { params, setSendError } = build();
    const { result } = renderHook(() => useAttachmentActions(params));

    await act(async () => { await result.current.handlePickGroupCard(group); });

    expect(issueQrToken).toHaveBeenCalledWith({ type: 'GROUP', targetId: 'g1' });
    expect(sendCardMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'destination',
      type: 'qr-card',
      payload: { token: 'tok-1', qrType: 'group', name: '周末羽毛球', avatarUrl: null },
    }));
    expect(setSendError).not.toHaveBeenCalledWith(expect.any(String));
    expect(params.inFlightRef.current).toBe(false);
  });

  test('a refused token (e.g. QR join turned off) surfaces the API message and sends nothing', async () => {
    jest.mocked(issueQrToken).mockRejectedValue(new Error('CHAT_GROUP_QR_JOIN_DISABLED'));
    const { params, setSendError } = build();
    const { result } = renderHook(() => useAttachmentActions(params));

    await act(async () => { await result.current.handlePickGroupCard(group); });

    expect(sendCardMessage).not.toHaveBeenCalled();
    expect(setSendError).toHaveBeenCalledWith('api:chat.detail.cardSendFailed');
    expect(params.inFlightRef.current).toBe(false);
  });
});
