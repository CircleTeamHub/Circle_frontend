import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useMediaSend, type MediaSendParams } from './use-media-send';
import { requestUploadPresign, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { assertMediaSendSessionCurrent, sendImageMessage, sendVideoMessage } from '@/chat-core/client';
import { uploadChatImageThumbnail } from '@/features/chat/utils/image-thumbnail';
import { uploadChatVideoPoster } from '@/features/chat/utils/chat-video-poster';
import { VIDEO_UPLOAD_TIMEOUT_MS } from '@/features/chat/chat-detail/constants';

jest.mock('@/features/chat/utils/media-error-guard', () => ({ mediaErrorGuard: () => () => true }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/features/profile/image-picker', () => ({ launchImageLibraryFast: jest.fn() }));
jest.mock('@/services/api/temp-chat', () => ({ assertMyTempChatConversationOpen: jest.fn() }));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(async () => ({ key: 'chat/media', uploadUrl: 'https://upload.test/file', requiredHeaders: { 'If-None-Match': '*' } })),
  resolveUploadContentType: jest.fn(),
  sanitizeUploadFilename: (name: string) => name,
  uploadLocalFileToPresignedUrl: jest.fn(async () => undefined),
}));
jest.mock('@/features/chat/utils/image-thumbnail', () => ({ uploadChatImageThumbnail: jest.fn(async () => null) }));
jest.mock('@/features/chat/utils/chat-image-compress', () => ({ prepareChatImageForUpload: jest.fn(async (asset: object) => asset) }));
jest.mock('@/features/chat/utils/chat-video-poster', () => ({ uploadChatVideoPoster: jest.fn(async () => null) }));
jest.mock('@/components/app/top-notice-store', () => ({ hideTopNotice: jest.fn(), showTopNotice: jest.fn() }));
jest.mock('@/chat-core/client', () => ({
  assertMediaSendSessionCurrent: jest.fn(),
  failMediaSend: jest.fn(),
  finishMediaSend: jest.fn(),
  sendImageMessage: jest.fn(async () => undefined),
  sendVideoMessage: jest.fn(async () => undefined),
  startMediaSend: jest.fn(),
}));
jest.mock('@/features/chat/chat-detail/helpers', () => ({ logChatSendFailure: jest.fn() }));
jest.mock('@/chat-core/send-errors', () => ({ getChatSendErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/services/api/credit-policy', () => ({ assertLocalCanSendMessage: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

let params: MediaSendParams;
let sessionCurrent = true;
beforeEach(() => {
  jest.clearAllMocks();
  sessionCurrent = true;
  jest.mocked(assertMediaSendSessionCurrent).mockImplementation(() => {
    if (!sessionCurrent) throw new Error('session changed');
  });
  params = {
    t: ((key: string) => key) as MediaSendParams['t'],
    inFlightRef: { current: false },
    setSendError: jest.fn(),
    mountedRef: { current: true },
    reuploadPendingMediaRef: { current: null },
    sourceID: 'peer',
    conversationID: 'conversation',
    isTempChat: false,
    conversationType: 'single',
    isGroupChat: false,
    isPreviewMode: false,
    uploadAndSendVoice: jest.fn(),
  };
});

test('correlates the main image transfer while keeping its thumbnail independent', async () => {
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!({
    deliveryId: 'image-delivery',
    uri: 'file:///image.jpg',
    record: { type: 'image', uploadName: 'image.jpg', contentType: 'image/jpeg', width: 1200, height: 900 },
  } as never));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test/file', 'image/jpeg', 'file:///image.jpg', { 'If-None-Match': '*' }, undefined, { progressKey: 'image-delivery' },
  );
  expect(uploadChatImageThumbnail).toHaveBeenCalledWith('file:///image.jpg', 1200, 'image.jpg', expect.any(Function));
  const beforeUpload = jest.mocked(uploadChatImageThumbnail).mock.calls[0][3]!;
  sessionCurrent = false;
  expect(beforeUpload).toThrow('session changed');
  expect(assertMediaSendSessionCurrent).toHaveBeenLastCalledWith('image-delivery');
});

test('preserves video timeout and main transfer identity while keeping its poster independent', async () => {
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!({
    deliveryId: 'video-delivery',
    uri: 'file:///video.mp4',
    record: { type: 'video', uploadName: 'video.mp4', contentType: 'video/mp4', duration: 42 },
  } as never));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test/file', 'video/mp4', 'file:///video.mp4', { 'If-None-Match': '*' }, VIDEO_UPLOAD_TIMEOUT_MS, { progressKey: 'video-delivery' },
  );
  expect(uploadChatVideoPoster).toHaveBeenCalledWith('file:///video.mp4', 42, 'video.mp4', 'chat', expect.any(Function));
  const beforeUpload = jest.mocked(uploadChatVideoPoster).mock.calls[0][4]!;
  sessionCurrent = false;
  expect(beforeUpload).toThrow('session changed');
  expect(assertMediaSendSessionCurrent).toHaveBeenLastCalledWith('video-delivery');
});

test.each(['image', 'video'] as const)('does not start the %s transfer when the session changes during primary presign', async (type) => {
  let releasePresign!: () => void;
  const presignWait = new Promise<void>((resolve) => { releasePresign = resolve; });
  jest.mocked(requestUploadPresign).mockImplementationOnce(async () => {
    await presignWait;
    return { key: 'chat/media', uploadUrl: 'https://upload.test/file', requiredHeaders: {} } as never;
  });
  renderHook(() => useMediaSend(params));
  await act(async () => {
    const sending = params.reuploadPendingMediaRef.current!({
      deliveryId: `${type}-delivery`,
      uri: `file:///${type}`,
      record: { type, uploadName: type, contentType: `${type}/test` },
    } as never);
    await waitFor(() => expect(requestUploadPresign).toHaveBeenCalledTimes(1));
    sessionCurrent = false;
    releasePresign();
    await sending;
  });
  expect(uploadLocalFileToPresignedUrl).not.toHaveBeenCalled();
  expect(uploadChatImageThumbnail).not.toHaveBeenCalled();
  expect(uploadChatVideoPoster).not.toHaveBeenCalled();
  expect(sendImageMessage).not.toHaveBeenCalled();
  expect(sendVideoMessage).not.toHaveBeenCalled();
});

test.each(['image', 'video'] as const)('does not prepare the %s derivative when the session changes during primary transfer', async (type) => {
  let finishTransfer!: () => void;
  const transferWait = new Promise<void>((resolve) => { finishTransfer = resolve; });
  jest.mocked(uploadLocalFileToPresignedUrl).mockImplementationOnce(async () => { await transferWait; return undefined; });
  renderHook(() => useMediaSend(params));
  await act(async () => {
    const sending = params.reuploadPendingMediaRef.current!({
      deliveryId: `${type}-delivery`,
      uri: `file:///${type}`,
      record: { type, uploadName: type, contentType: `${type}/test` },
    } as never);
    await waitFor(() => expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(1));
    sessionCurrent = false;
    finishTransfer();
    await sending;
  });
  expect(uploadChatImageThumbnail).not.toHaveBeenCalled();
  expect(uploadChatVideoPoster).not.toHaveBeenCalled();
  expect(sendImageMessage).not.toHaveBeenCalled();
  expect(sendVideoMessage).not.toHaveBeenCalled();
});
