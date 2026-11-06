const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function harness({ kind = 'photo', rejectedAsset, delayFirstVideo = false, assets } = {}) {
  const sent = [], failed = [], uploading = [], pickerOptions = [], editorAssets = [];
  let resolveFirst, rejectFirst;
  const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  const scheduler = loadTsModule('src/features/chat/utils/media-upload-scheduler.ts');
  const mediaPolicy = loadTsModule('src/features/chat/utils/chat-media-policy.ts');
  const client = {
    assertMediaSendSessionCurrent() {},
    startMediaSend: (input) => input.source.uri,
    sendImageMessage: async (input) => sent.push(input.key),
    sendVideoMessage: async (input) => sent.push(input.key),
    finishMediaSend() {},
    failMediaSend: (_id, deliveryId) => failed.push(deliveryId),
  };
  const { useMediaSend: createMediaSend } = loadTsModule('src/features/chat/chat-detail/hooks/use-media-send.ts', {
    context: { requestAnimationFrame: (callback) => callback() },
    requireShim: (name) => {
      switch (name) {
        case 'react': return { useCallback: (fn) => fn, useEffect() {}, useRef: (value) => ({ current: value }), useState: (value) => [value, (next) => { if (value === null) editorAssets.push(next); }] };
        case 'react-native': return { Platform: { OS: 'web' }, Alert: { alert() {} } };
        case 'expo-image-picker': return {
          UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
          requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
          requestCameraPermissionsAsync: async () => ({ granted: true }),
          launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'camera.jpg', mimeType: 'image/jpeg' }] }),
          launchImageLibraryAsync: async (options) => {
            pickerOptions.push(options);
            return { canceled: false, assets: assets ?? [kind === 'photo' ? 'first.jpg' : 'first.mp4', kind === 'photo' ? 'second.jpg' : 'second.mp4'].map((uri) => ({ uri, mimeType: kind === 'photo' ? 'image/jpeg' : 'video/mp4' })) };
          },
        };
        case '@/features/profile/image-picker': return {
          launchImageLibraryFast: async (picker, options) => ({
            status: 'picked',
            result: await picker.launchImageLibraryAsync(options),
          }),
        };
        case '@/services/api/temp-chat': return { assertMyTempChatConversationOpen: async () => {} };
        case '@/services/api/upload': return {
          requestUploadPresign: async (input) => ({ key: input.filename, uploadUrl: input.filename, requiredHeaders: {} }),
          resolveUploadContentType: ({ mimeType }) => mimeType, sanitizeUploadFilename: (name) => name,
          uploadLocalFileToPresignedUrl: async (url) => { uploading.push(url); if (url === rejectedAsset) throw new Error('offline'); if (url === 'first.jpg' || (delayFirstVideo && url === 'first.mp4')) await first; },
        };
        case '@/features/chat/utils/image-thumbnail': return { uploadChatImageThumbnail: async () => null };
        case '@/features/chat/utils/chat-image-compress': return { prepareChatImageForUpload: async (input) => input };
        case '@/features/chat/utils/chat-video-compress': return { prepareChatVideoForUpload: async (asset, filename, contentType) => ({ asset, filename, contentType }) };
        case '@/features/chat/utils/chat-video-poster': return { uploadChatVideoPoster: async () => null };
        case '@/components/app/top-notice-store': return { hideTopNotice() {}, showTopNotice() {} };
        case '@/chat-core/client': return client;
        case '@/features/chat/chat-detail/helpers': return { logChatSendFailure() {} };
        case '@/chat-core/send-errors': return { getChatSendErrorMessage: (_error, fallback) => fallback };
        case '@/features/chat/utils/chat-media-policy': return mediaPolicy;
        case '@/services/api/credit-policy': return { assertLocalCanSendMessage() {} };
        case '@/features/chat/chat-detail/constants': return { VIDEO_UPLOAD_TIMEOUT_MS: 1000 };
        case '@/features/chat/utils/media-error-guard': return loadTsModule('src/features/chat/utils/media-error-guard.ts', { requireShim: (dependency) => {
          if (dependency === '@/stores/authStore') return { useAuthStore: { getState: () => ({ sessionEpoch: 1 }) } };
          if (dependency === '@/chat-core/store') return { useChatStore: { getState: () => ({ activeConversationId: 'chat' }) } };
          throw new Error('Unexpected guard dependency: ' + dependency);
        } });
        case '@/features/chat/utils/media-upload-scheduler': return scheduler;
        default: throw new Error('Unexpected dependency: ' + name);
      }
    },
  });
  const controls = createMediaSend({
    t: (key) => key, inFlightRef: { current: false }, setSendError() {}, mountedRef: { current: true },
    reuploadPendingMediaRef: { current: null }, sourceID: 'me', conversationID: 'chat',
    isTempChat: false, conversationType: 'single', isGroupChat: false, isPreviewMode: false, uploadAndSendVoice: async () => {},
  });
  return { controls, sent, failed, uploading, pickerOptions, editorAssets, resolveFirst, rejectFirst };
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

test('video picking allows a batch and sends every selected video', async () => {
  const h = harness({ kind: 'video' });
  h.controls.handleMediaSourceSelect('video');
  await until(() => h.pickerOptions.length > 0);
  assert.equal(h.pickerOptions[0].allowsMultipleSelection, true);
  assert.ok(h.pickerOptions[0].selectionLimit > 1);
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['first.mp4', 'second.mp4']);
  assert.deepEqual(h.editorAssets, []);
});

for (const action of ['photo', 'camera']) {
  test(`a ${action === 'photo' ? 'picked' : 'captured'} photo waits for editor confirmation before upload`, async () => {
    const h = harness({ assets: [{ uri: 'single.jpg', mimeType: 'image/jpeg' }] });
    h.controls.handleMediaSourceSelect(action);
    await until(() => h.editorAssets.length === 1);
    const selected = h.editorAssets[0];
    assert.equal(selected.uri, action === 'camera' ? 'camera.jpg' : 'single.jpg');
    assert.deepEqual(h.uploading, []);
    assert.deepEqual(h.sent, []);
    await h.controls.handleSendEditedPhoto(selected);
    await until(() => h.sent.length === 1);
    assert.deepEqual(h.sent, [selected.uri]);
  });
}

test('a failed video upload does not prevent the next selected video from sending', async () => {
  const h = harness({ kind: 'video', rejectedAsset: 'first.mp4' });
  h.controls.handleMediaSourceSelect('video');
  await until(() => h.failed.length === 1);
  await until(() => h.sent.length === 1);
  assert.deepEqual(h.failed, ['first.mp4']);
  assert.deepEqual(h.sent, ['second.mp4']);
});

test('video uploads retain picker order when the later upload completes first', async () => {
  const h = harness({ kind: 'video', delayFirstVideo: true });
  h.controls.handleMediaSourceSelect('video');
  await until(() => h.uploading.length === 2);
  assert.deepEqual(h.sent, []);
  h.resolveFirst();
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['first.mp4', 'second.mp4']);
});

for (const [reason, middle] of [
  ['size', { fileSize: 100 * 1024 * 1024 + 1 }],
  ['duration', { duration: 10 * 60 * 1000 + 1 }],
  ['type', { mimeType: 'application/octet-stream' }],
  ['upload failure', {}],
]) {
  test(`rejecting the middle video for ${reason} preserves the first-to-last send order`, async () => {
    const h = harness({
      kind: 'video', delayFirstVideo: true,
      rejectedAsset: reason === 'upload failure' ? 'middle.mp4' : undefined,
      assets: [
        { uri: 'first.mp4', mimeType: 'video/mp4' },
        { uri: 'middle.mp4', mimeType: 'video/mp4', ...middle },
        { uri: 'last.mp4', mimeType: 'video/mp4' },
      ],
    });
    h.controls.handleMediaSourceSelect('video');
    await until(() => h.uploading.includes('last.mp4'));
    await new Promise(setImmediate);
    h.resolveFirst();
    await until(() => h.sent.length === 2);
    assert.deepEqual(h.sent, ['first.mp4', 'last.mp4']);
  });
}

test('an upload failure in the middle photo preserves the first-to-last send order', async () => {
  const h = harness({
    rejectedAsset: 'middle.jpg',
    assets: ['first.jpg', 'middle.jpg', 'last.jpg'].map((uri) => ({ uri, mimeType: 'image/jpeg' })),
  });
  h.controls.handleMediaSourceSelect('photo');
  await until(() => h.uploading.includes('last.jpg'));
  await new Promise(setImmediate);
  h.resolveFirst();
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['first.jpg', 'last.jpg']);
});
