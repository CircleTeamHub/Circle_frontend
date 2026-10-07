const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function harness() {
  const sent = [], failed = [], uploading = [];
  let resolveFirst, rejectFirst;
  const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  const scheduler = loadTsModule('src/features/chat/utils/media-upload-scheduler.ts');
  const client = {
    assertMediaSendSessionCurrent() {},
    startMediaSend: (input) => input.source.uri,
    sendImageMessage: async (input) => sent.push(input.key),
    sendVideoMessage: async () => {},
    finishMediaSend() {},
    failMediaSend: (_id, deliveryId) => failed.push(deliveryId),
  };
  const { useMediaSend } = loadTsModule('src/features/chat/chat-detail/hooks/use-media-send.ts', {
    context: { requestAnimationFrame: (callback) => callback() },
    requireShim: (name) => {
      switch (name) {
        case 'react': return { useCallback: (fn) => fn, useEffect() {}, useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] };
        case 'react-native': return { Platform: { OS: 'web' }, Alert: { alert() {} } };
        case 'expo-image-picker': return {
          UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
          requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
          launchImageLibraryAsync: async () => ({ canceled: false, assets: ['first.jpg', 'second.jpg'].map((uri) => ({ uri, mimeType: 'image/jpeg' })) }),
        };
        case '@/services/api/temp-chat': return { assertMyTempChatConversationOpen: async () => {} };
        case '@/services/api/upload': return {
          requestUploadPresign: async (input) => ({ key: input.filename, uploadUrl: input.filename, requiredHeaders: {} }),
          resolveUploadContentType: () => 'image/jpeg', sanitizeUploadFilename: (name) => name,
          uploadLocalFileToPresignedUrl: async (url) => { uploading.push(url); if (url === 'first.jpg') await first; },
        };
        case '@/features/chat/utils/image-thumbnail': return { uploadChatImageThumbnail: async () => null };
        case '@/features/chat/utils/chat-image-compress': return { prepareChatImageForUpload: async (input) => input };
        case '@/features/chat/utils/chat-video-poster': return { uploadChatVideoPoster: async () => null };
        case '@/components/app/top-notice-store': return { hideTopNotice() {}, showTopNotice() {} };
        case '@/chat-core/client': return client;
        case '@/features/chat/chat-detail/helpers': return { logChatSendFailure() {} };
        case '@/chat-core/send-errors': return { getChatSendErrorMessage: (_error, fallback) => fallback };
        case '@/features/chat/utils/chat-media-policy': return { isChatImageTooLarge: () => false, isChatVideoTooLarge: () => false, isChatVideoTooLong: () => false };
        case '@/services/api/credit-policy': return { assertLocalCanSendMessage() {} };
        case '@/features/chat/chat-detail/constants': return { VIDEO_UPLOAD_TIMEOUT_MS: 1000 };
        case '@/features/chat/utils/media-upload-scheduler': return scheduler;
        default: throw new Error('Unexpected dependency: ' + name);
      }
    },
  });
  const controls = useMediaSend({
    t: (key) => key, inFlightRef: { current: false }, setSendError() {}, mountedRef: { current: true },
    reuploadPendingMediaRef: { current: null }, sourceID: 'me', conversationID: 'chat',
    isTempChat: false, conversationType: 'single', isGroupChat: false, isPreviewMode: false, uploadAndSendVoice: async () => {},
  });
  return { controls, sent, failed, uploading, resolveFirst, rejectFirst };
}

async function until(predicate) {
  for (let i = 0; i < 20 && !predicate(); i += 1) await new Promise(setImmediate);
  assert.ok(predicate(), 'media pipeline did not reach the expected state');
}

test('concurrent uploads send in picker order even when the second upload finishes first', async () => {
  const h = harness();
  h.controls.handleMediaSourceSelect('photo');
  await until(() => h.uploading.length === 2);
  assert.deepEqual(h.sent, []);
  h.resolveFirst();
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['first.jpg', 'second.jpg']);
});

test('a failed earlier upload releases the next image send without hiding its retry bubble', async () => {
  const h = harness();
  h.controls.handleMediaSourceSelect('photo');
  await until(() => h.uploading.length === 2);
  h.rejectFirst(new Error('offline'));
  await until(() => h.sent.length === 1);
  assert.deepEqual(h.failed, ['first.jpg']);
  assert.deepEqual(h.sent, ['second.jpg']);
});
