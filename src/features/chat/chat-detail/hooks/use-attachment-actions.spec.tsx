import { act, renderHook } from '@testing-library/react-native';
import { sendForwardedMediaMessage, sendTextMessage } from '@/chat-core/client';
import { useAttachmentActions, type AttachmentActionsParams } from './use-attachment-actions';
import type { UserCollection } from '@/services/api/collections';
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/chat-core/client', () => ({ sendCardMessage: jest.fn(), sendVoiceMessage: jest.fn(), sendForwardedMediaMessage: jest.fn(async () => ({})), sendTextMessage: jest.fn(async () => ({})) }));
jest.mock('@/chat-core/send-handle', () => ({ startChatSend: (send: (onCreate: () => void) => Promise<unknown>) => ({ queued: false, delivered: send(() => undefined) }) }));
jest.mock('@/chat-core/send-errors', () => ({ getChatSendErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/features/chat/chat-detail/helpers', () => ({ logChatSendFailure: jest.fn() }));
jest.mock('@/features/chat/utils/note-card-fresh-status', () => ({ withFreshNoteSourceStatus: jest.fn() }));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
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
