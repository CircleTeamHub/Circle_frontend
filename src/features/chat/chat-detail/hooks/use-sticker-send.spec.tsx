import { act, renderHook } from '@testing-library/react-native';
import { useStickerSend, type StickerSendParams } from './use-sticker-send';

const mockPrepare = jest.fn();
const mockSend = jest.fn();
const mockAuth = { sessionEpoch: 1 };
jest.mock('@/services/api/stickers', () => ({ prepareStickerMessage: (...args: unknown[]) => mockPrepare(...args) }));
jest.mock('@/chat-core/client', () => ({ sendImageMessage: (...args: unknown[]) => mockSend(...args) }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('@/services/api/temp-chat', () => ({ assertMyTempChatConversationOpen: jest.fn() }));
jest.mock('@/features/chat/utils/sticker-error', () => ({ getStickerErrorMessage: (_error: unknown, _t: unknown, fallback: string) => fallback }));

let params: StickerSendParams;
beforeEach(() => {
  mockPrepare.mockReset().mockResolvedValue({ key: 'chat/alice/copy.png', width: 40, height: 50 });
  mockSend.mockReset().mockResolvedValue(undefined); mockAuth.sessionEpoch = 1;
  params = { conversationID: 'c1', sourceID: 'peer', isPreviewMode: false, composerLocked: false, isTempChat: false, inFlightRef: { current: false }, mountedRef: { current: true }, setSendError: jest.fn(), t: ((key: string) => key) as StickerSendParams['t'] };
});

test('sends the server-prepared key through existing persistent image transport', async () => {
  const { result } = renderHook(() => useStickerSend(params));
  await act(async () => result.current.handleSendSticker({ id: 's1' } as never));
  expect(mockPrepare).toHaveBeenCalledWith('s1');
  expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'c1', key: 'chat/alice/copy.png', width: 40, height: 50 }));
  expect(params.inFlightRef.current).toBe(false);
});

test.each(['account', 'unmount', 'failure'])('does not send prepared image after %s', async (change) => {
  mockPrepare.mockImplementation(async () => {
    if (change === 'account') mockAuth.sessionEpoch++;
    if (change === 'unmount') params.mountedRef.current = false;
    if (change === 'failure') throw new Error('copy failed');
    return { key: 'chat/alice/copy.png' };
  });
  const { result } = renderHook(() => useStickerSend(params));
  await act(async () => result.current.handleSendSticker({ id: 's1' } as never));
  expect(mockSend).not.toHaveBeenCalled();
  if (change === 'failure') expect(params.setSendError).toHaveBeenCalledWith('chat.stickers.sendFailed');
});

test.each(['composerLocked', 'isPreviewMode'])('does not prepare media when %s', async (flag) => {
  params = { ...params, [flag]: true };
  const { result } = renderHook(() => useStickerSend(params));
  await act(async () => result.current.handleSendSticker({ id: 's1' } as never));
  expect(mockPrepare).not.toHaveBeenCalled();
});
