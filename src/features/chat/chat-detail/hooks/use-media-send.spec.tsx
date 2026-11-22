import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useMediaSend, type MediaSendParams } from './use-media-send';
import { requestUploadPresign, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { assertMediaSendSessionCurrent, failMediaSend, sendImageMessage, sendVideoMessage } from '@/chat-core/client';
import { uploadChatImageThumbnail } from '@/features/chat/utils/image-thumbnail';
import { uploadChatVideoPoster } from '@/features/chat/utils/chat-video-poster';
import { VIDEO_UPLOAD_TIMEOUT_MS } from '@/features/chat/chat-detail/constants';
import { prepareChatVideoForUpload } from '@/features/chat/utils/chat-video-compress';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { launchImageLibraryFast } from '@/features/profile/image-picker';

jest.mock('@/features/chat/utils/media-error-guard', () => ({ mediaErrorGuard: () => () => true }));
jest.mock('expo-image-picker', () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
  VideoExportPreset: { H264_1280x720: 'h264-720' },
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('@/features/profile/image-picker', () => ({ launchImageLibraryFast: jest.fn() }));
jest.mock('@/services/api/temp-chat', () => ({ assertMyTempChatConversationOpen: jest.fn() }));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(async () => ({ key: 'chat/media', uploadUrl: 'https://upload.test/file', requiredHeaders: { 'If-None-Match': '*' } })),
  resolveUploadContentType: jest.fn(),
  sanitizeUploadFilename: (name: string) => name,
  uploadLocalFileToPresignedUrl: jest.fn(async () => undefined),
}));
jest.mock('@/features/chat/utils/image-thumbnail', () => ({ uploadChatImageThumbnail: jest.fn(async () => null) }));
jest.mock('@/features/chat/utils/chat-image-compress', () => ({
  planChatImageUpload: () => ({ reencode: true }),
  prepareChatImageForUpload: jest.fn(async (asset: object) => asset),
}));
jest.mock('@/features/chat/utils/chat-video-poster', () => ({ uploadChatVideoPoster: jest.fn(async () => null) }));
jest.mock('@/features/chat/utils/chat-video-compress', () => ({
  isChatVideoCompressionAvailable: jest.fn(() => true),
  prepareChatVideoForUpload: jest.fn(),
}));
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
  jest.mocked(prepareChatVideoForUpload).mockImplementation(async (asset, filename, contentType) => ({ asset, filename, contentType }));
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

test('correlates both image and thumbnail transfers with the same media bubble', async () => {
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!({
    deliveryId: 'image-delivery',
    uri: 'file:///image.jpg',
    record: { type: 'image', uploadName: 'image.jpg', contentType: 'image/jpeg', width: 1200, height: 900 },
  } as never));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test/file', 'image/jpeg', 'file:///image.jpg', { 'If-None-Match': '*' }, undefined, { progressKey: 'image-delivery' },
  );
  expect(uploadChatImageThumbnail).toHaveBeenCalledWith('file:///image.jpg', 1200, 'image.jpg', expect.any(Function), 'image-delivery');
  const beforeUpload = jest.mocked(uploadChatImageThumbnail).mock.calls[0][3]!;
  sessionCurrent = false;
  expect(beforeUpload).toThrow('session changed');
  expect(assertMediaSendSessionCurrent).toHaveBeenLastCalledWith('image-delivery');
});

test('preserves video timeout and correlates the poster with the same media bubble', async () => {
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!({
    deliveryId: 'video-delivery',
    uri: 'file:///video.mp4',
    record: { type: 'video', uploadName: 'video.mp4', contentType: 'video/mp4', duration: 42 },
  } as never));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test/file', 'video/mp4', 'file:///video.mp4', { 'If-None-Match': '*' }, VIDEO_UPLOAD_TIMEOUT_MS, { progressKey: 'video-delivery' },
  );
  expect(uploadChatVideoPoster).toHaveBeenCalledWith('file:///video.mp4', 42, 'video.mp4', 'chat', expect.any(Function), 'video-delivery');
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

// 重新选片发成功了，上一次的「视频发送失败」不能还挂着：和文字、语音、长按重发一样，新的一次发送先清掉旧提示。
test.each(['gallery', 'editor'] as const)('a new %s send clears the previous failure banner', async (entry) => {
  const { result } = renderHook(() => useMediaSend(params));
  const asset = { uri: 'file:///next.jpg', width: 1200, height: 900, type: 'image', fileName: 'next.jpg' } as never;
  if (entry === 'gallery') {
    act(() => result.current.setGalleryMode('send'));
    await act(async () => result.current.handleGalleryConfirm([asset], ''));
  } else {
    await act(async () => { await result.current.handleSendEditedPhoto(asset); });
  }
  expect(params.setSendError).toHaveBeenCalledWith(null);
});

const compressedAsset = { uri: 'file:///compressed.mp4', width: 1280, height: 720, duration: 42_000, fileSize: 1_000_000 };
const retryVideo = {
  deliveryId: 'compressed-delivery', uri: 'file:///original.mov',
  record: { type: 'video', uploadName: 'original.mov', contentType: 'video/quicktime', width: 1920, height: 1080, duration: 42, size: 8_000_000 },
};

test('uploads the prepared MP4 and sends its metadata while preserving the original local preview', async () => {
  const cleanup = jest.fn(async () => undefined);
  jest.mocked(prepareChatVideoForUpload).mockResolvedValueOnce({ asset: compressedAsset, filename: 'original.mp4', contentType: 'video/mp4', cleanup });
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!(retryVideo as never));
  expect(requestUploadPresign).toHaveBeenCalledWith(expect.objectContaining({ filename: 'original.mp4', contentType: 'video/mp4', fileUri: compressedAsset.uri }));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith('https://upload.test/file', 'video/mp4', compressedAsset.uri, expect.any(Object), VIDEO_UPLOAD_TIMEOUT_MS, { progressKey: retryVideo.deliveryId });
  expect(uploadChatVideoPoster).toHaveBeenCalledWith(compressedAsset.uri, 42, 'original.mp4', 'chat', expect.any(Function), retryVideo.deliveryId);
  expect(sendVideoMessage).toHaveBeenCalledWith(expect.objectContaining({ localUri: retryVideo.uri, width: 1280, height: 720, size: 1_000_000, duration: 42 }));
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('rechecks the session after compression and cleans the output without starting an upload', async () => {
  const cleanup = jest.fn(async () => undefined);
  jest.mocked(prepareChatVideoForUpload).mockImplementationOnce(async () => {
    sessionCurrent = false;
    return { asset: compressedAsset, filename: 'original.mp4', contentType: 'video/mp4', cleanup };
  });
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!(retryVideo as never));
  expect(requestUploadPresign).not.toHaveBeenCalled();
  expect(uploadLocalFileToPresignedUrl).not.toHaveBeenCalled();
  expect(sendVideoMessage).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('a video still over the limit after compression fails before upload with a specific message', async () => {
  const cleanup = jest.fn(async () => undefined);
  const oversized = { ...compressedAsset, fileSize: 100 * 1024 * 1024 + 1 };
  jest.mocked(prepareChatVideoForUpload).mockResolvedValueOnce({ asset: oversized, filename: 'original.mp4', contentType: 'video/mp4', cleanup });
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!(retryVideo as never));
  expect(requestUploadPresign).not.toHaveBeenCalled();
  expect(uploadLocalFileToPresignedUrl).not.toHaveBeenCalled();
  expect(sendVideoMessage).not.toHaveBeenCalled();
  expect(failMediaSend).toHaveBeenCalledWith('conversation', retryVideo.deliveryId);
  expect(params.setSendError).toHaveBeenCalledWith('chat.detail.videoTooLarge');
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('cleans compressed output when the transfer fails', async () => {
  const cleanup = jest.fn(async () => undefined);
  jest.mocked(prepareChatVideoForUpload).mockResolvedValueOnce({ asset: compressedAsset, filename: 'original.mp4', contentType: 'video/mp4', cleanup });
  jest.mocked(uploadLocalFileToPresignedUrl).mockRejectedValueOnce(new Error('offline'));
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!(retryVideo as never));
  expect(sendVideoMessage).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('reuses uploaded keys and compressed metadata after a socket acknowledgement failure', async () => {
  const cleanup = jest.fn(async () => undefined);
  jest.mocked(prepareChatVideoForUpload).mockResolvedValueOnce({ asset: compressedAsset, filename: 'original.mp4', contentType: 'video/mp4', cleanup });
  jest.mocked(sendVideoMessage).mockRejectedValueOnce(new Error('ack timeout'));
  renderHook(() => useMediaSend(params));
  await act(async () => params.reuploadPendingMediaRef.current!(retryVideo as never));
  await act(async () => params.reuploadPendingMediaRef.current!(retryVideo as never));
  expect(prepareChatVideoForUpload).toHaveBeenCalledTimes(1);
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(1);
  expect(sendVideoMessage).toHaveBeenCalledTimes(2);
  expect(sendVideoMessage).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1280, height: 720, size: 1_000_000, duration: 42 }));
  expect(cleanup).toHaveBeenCalledTimes(1);
});

describe('media source sheet on web', () => {
  // 浏览器只在点击的同一调用栈里放行文件选择框(Safari 最严):中间隔一帧或先 await 一次
  // 权限请求,选择框就被静默拦掉。网页也没有相册权限,应用内相册只会显示「需要相册权限」。
  test('album opens the system file picker within the tap, not the in-app gallery', () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      jest.mocked(launchImageLibraryFast).mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useMediaSend(params));
      act(() => result.current.handleMediaSourceSelect('album'));
      expect(launchImageLibraryFast).toHaveBeenCalledWith(ImagePicker, expect.objectContaining({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
      }));
      expect(result.current.galleryMode).toBeNull();
    } finally {
      restore.restore();
    }
  });

  test('camera opens the capture picker within the tap, without awaiting a permission request', () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      const { result } = renderHook(() => useMediaSend(params));
      act(() => result.current.handleMediaSourceSelect('camera'));
      expect(ImagePicker.launchCameraAsync).toHaveBeenCalledTimes(1);
      expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
    } finally {
      restore.restore();
    }
  });
});
