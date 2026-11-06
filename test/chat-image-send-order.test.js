const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function harness({ kind = 'photo', rejectedAsset, delayFirstVideo = false, assets } = {}) {
  const sent = [], failed = [], uploading = [], pickerOptions = [], editorAssets = [], pendingBatches = [], sendErrors = [];
  // 迷你 hooks 运行时:按调用顺序记住 state/ref,render() 重新执行 hook 就能读到最新状态。
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  let resolveFirst, rejectFirst;
  const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  const scheduler = loadTsModule('src/features/chat/utils/media-upload-scheduler.ts');
  const mediaPolicy = loadTsModule('src/features/chat/utils/chat-media-policy.ts');
  const client = {
    assertMediaSendSessionCurrent() {},
    startMediaSend: (input) => input.source.uri,
    sendImageMessage: async (input) => sent.push(input.key),
    sendVideoMessage: async (input) => sent.push(input.key),
    sendTextMessage: async (input) => { input.onCreate?.(); sent.push(`text:${input.text}`); },
    finishMediaSend() {},
    failMediaSend: (_id, deliveryId) => failed.push(deliveryId),
  };
  const { useMediaSend: createMediaSend } = loadTsModule('src/features/chat/chat-detail/hooks/use-media-send.ts', {
    context: { requestAnimationFrame: (callback) => callback() },
    requireShim: (name) => {
      switch (name) {
        case 'react': return {
          useCallback: (fn) => fn,
          useEffect() {},
          useRef: (value) => {
            const index = refIndex++;
            if (!(index in refs)) refs[index] = { current: value };
            return refs[index];
          },
          useState: (value) => {
            const index = stateIndex++;
            if (!(index in states)) states[index] = value;
            return [states[index], (next) => {
              states[index] = next;
              if (Array.isArray(next)) pendingBatches.push(next);
              else if (next) editorAssets.push(next);
            }];
          },
        };
        case 'react-native': return { Platform: { OS: 'web' }, Alert: { alert() {} } };
        case 'expo-image-picker': return {
          UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
          requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
          requestCameraPermissionsAsync: async () => ({ granted: true }),
          launchCameraAsync: async () => ({ canceled: false, assets: [{ uri: 'camera.jpg', mimeType: 'image/jpeg' }] }),
          launchImageLibraryAsync: async (options) => {
            pickerOptions.push(options);
            return { canceled: false, assets: assets ?? [kind === 'photo' ? 'first.jpg' : 'first.mp4', kind === 'photo' ? 'second.jpg' : 'second.mp4'].map((uri) => ({ uri, mimeType: kind === 'photo' ? 'image/jpeg' : 'video/mp4', type: kind === 'photo' ? 'image' : 'video' })) };
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
        case '@/chat-core/send-handle': return loadTsModule('src/chat-core/send-handle.ts');
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
  const params = {
    t: (key) => key, inFlightRef: { current: false }, setSendError: (message) => sendErrors.push(message), mountedRef: { current: true },
    reuploadPendingMediaRef: { current: null }, sourceID: 'me', conversationID: 'chat',
    isTempChat: false, conversationType: 'single', isGroupChat: false, isPreviewMode: false, uploadAndSendVoice: async () => {},
  };
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    return createMediaSend(params);
  };
  const controls = render();
  /** 从相册选完后停在确认框,点「发送」并附上 caption。 */
  const pickAndConfirm = async (caption = '') => {
    controls.handleMediaSourceSelect('album');
    await until(() => pendingBatches.length === 1);
    render().handleSendPendingMedia(caption);
  };
  return { controls, render, pickAndConfirm, sent, failed, uploading, pickerOptions, editorAssets, pendingBatches, sendErrors, resolveFirst, rejectFirst };
}

async function until(predicate) {
  for (let i = 0; i < 20 && !predicate(); i += 1) await new Promise(setImmediate);
  assert.ok(predicate(), 'media pipeline did not reach the expected state');
}

test('concurrent uploads send in picker order even when the second upload finishes first', async () => {
  const h = harness();
  await h.pickAndConfirm();
  await until(() => h.uploading.length === 2);
  assert.deepEqual(h.sent, []);
  h.resolveFirst();
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['first.jpg', 'second.jpg']);
});

test('a failed earlier upload releases the next image send without hiding its retry bubble', async () => {
  const h = harness();
  await h.pickAndConfirm();
  await until(() => h.uploading.length === 2);
  h.rejectFirst(new Error('offline'));
  await until(() => h.sent.length === 1);
  assert.deepEqual(h.failed, ['first.jpg']);
  assert.deepEqual(h.sent, ['second.jpg']);
});

test('video picking allows a batch and sends every selected video', async () => {
  const h = harness({ kind: 'video' });
  await h.pickAndConfirm();
  assert.equal(h.pickerOptions[0].allowsMultipleSelection, true);
  assert.ok(h.pickerOptions[0].selectionLimit > 1);
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['first.mp4', 'second.mp4']);
  assert.deepEqual(h.editorAssets, []);
});

test('the album picks photos and videos together and sends them in picker order', async () => {
  const h = harness({
    assets: [
      { uri: 'clip.mp4', mimeType: 'video/mp4', type: 'video' },
      { uri: 'photo.jpg', mimeType: 'image/jpeg', type: 'image' },
    ],
  });
  await h.pickAndConfirm();
  assert.equal(JSON.stringify(h.pickerOptions[0].mediaTypes), JSON.stringify(['images', 'videos']));
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['clip.mp4', 'photo.jpg']);
});

test('nothing uploads until the batch is confirmed', async () => {
  const h = harness();
  h.controls.handleMediaSourceSelect('album');
  await until(() => h.pendingBatches.length === 1);
  assert.deepEqual(h.uploading, []);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.pendingBatches[0].map((asset) => asset.uri), ['first.jpg', 'second.jpg']);
});

test('a single picked video skips the photo editor and asks for a caption', async () => {
  const h = harness({ assets: [{ uri: 'only.mp4', mimeType: 'video/mp4', type: 'video' }] });
  h.controls.handleMediaSourceSelect('album');
  await until(() => h.pendingBatches.length === 1);
  assert.deepEqual(h.editorAssets, []);
});

test('the caption is sent after every media item in the batch, even a slow first one', async () => {
  const h = harness();
  await h.pickAndConfirm('看这两张');
  await until(() => h.uploading.length === 2);
  assert.deepEqual(h.sent, []);
  h.resolveFirst();
  await until(() => h.sent.length === 3);
  assert.deepEqual(h.sent, ['first.jpg', 'second.jpg', 'text:看这两张']);
});

test('a failed upload still lets the caption go out after the rest of the batch', async () => {
  const h = harness();
  await h.pickAndConfirm('说明');
  await until(() => h.uploading.length === 2);
  h.rejectFirst(new Error('offline'));
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.failed, ['first.jpg']);
  assert.deepEqual(h.sent, ['second.jpg', 'text:说明']);
});

test('when every item in the batch fails the caption is held back and the user is told', async () => {
  const h = harness({ kind: 'video', rejectedAsset: 'first.mp4', assets: [{ uri: 'first.mp4', mimeType: 'video/mp4', type: 'video' }] });
  await h.pickAndConfirm('说明');
  await until(() => h.failed.length === 1);
  await until(() => h.sendErrors.includes('chat.detail.captionNotSent'));
  assert.deepEqual(h.sent, []);
});

test('an empty caption sends no text message', async () => {
  const h = harness({ kind: 'video' });
  await h.pickAndConfirm('');
  await until(() => h.sent.length === 2);
  await new Promise(setImmediate);
  assert.deepEqual(h.sent, ['first.mp4', 'second.mp4']);
});

for (const action of ['album', 'camera']) {
  test(`a ${action === 'album' ? 'picked' : 'captured'} photo waits for editor confirmation before upload`, async () => {
    const h = harness({ assets: [{ uri: 'single.jpg', mimeType: 'image/jpeg' }] });
    h.controls.handleMediaSourceSelect(action);
    await until(() => h.editorAssets.length === 1);
    const selected = h.editorAssets[0];
    assert.equal(selected.uri, action === 'camera' ? 'camera.jpg' : 'single.jpg');
    assert.deepEqual(h.uploading, []);
    assert.deepEqual(h.sent, []);
    await h.render().handleSendEditedPhoto(selected, '配文');
    await until(() => h.sent.length === 2);
    assert.deepEqual(h.sent, [selected.uri, 'text:配文']);
  });
}

test('a failed video upload does not prevent the next selected video from sending', async () => {
  const h = harness({ kind: 'video', rejectedAsset: 'first.mp4' });
  await h.pickAndConfirm();
  await until(() => h.failed.length === 1);
  await until(() => h.sent.length === 1);
  assert.deepEqual(h.failed, ['first.mp4']);
  assert.deepEqual(h.sent, ['second.mp4']);
});

test('video uploads retain picker order when the later upload completes first', async () => {
  const h = harness({ kind: 'video', delayFirstVideo: true });
  await h.pickAndConfirm();
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
        { uri: 'first.mp4', mimeType: 'video/mp4', type: 'video' },
        { uri: 'middle.mp4', mimeType: 'video/mp4', type: 'video', ...middle },
        { uri: 'last.mp4', mimeType: 'video/mp4', type: 'video' },
      ],
    });
    await h.pickAndConfirm();
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
  await h.pickAndConfirm();
  await until(() => h.uploading.includes('last.jpg'));
  await new Promise(setImmediate);
  h.resolveFirst();
  await until(() => h.sent.length === 2);
  assert.deepEqual(h.sent, ['first.jpg', 'last.jpg']);
});
