const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const DEFAULT_CLIENT_STUBS = {
  '@/im/listeners': {
    bindOpenIMListeners: () => () => {},
  },
  '@/im/token-recovery': {
    registerIMLoginExecutor: () => {},
    recoverIMSession: async () => false,
    isIMReloginPending: () => false,
  },
  '@/services/auth/session': {
    registerLogoutHandler: () => () => {},
  },
};

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const mergedStubs = { ...DEFAULT_CLIENT_STUBS, ...stubs };
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in mergedStubs) {
        return mergedStubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

DEFAULT_CLIENT_STUBS['@/im/user-id'] = loadTsModule('src/im/user-id.ts');
DEFAULT_CLIENT_STUBS['@/observability/sentry'] = { reportError: () => {} };
DEFAULT_CLIENT_STUBS['@/services/api/credit-policy'] = {
  assertCanSendMessage: async () => undefined,
  assertLocalCanSendMessage: () => undefined,
};
DEFAULT_CLIENT_STUBS['@/features/chat/utils/voice-forward'] = loadTsModule(
  'src/features/chat/utils/voice-forward.ts',
);

test('app config enables native microphone recording permissions for expo-audio', () => {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'),
  );
  const audioPlugin = appJson.expo.plugins.find((plugin) => {
    return Array.isArray(plugin) && plugin[0] === 'expo-audio';
  });

  assert.ok(audioPlugin);
  // 麦克风权限串与 ios.infoPlist.NSMicrophoneUsageDescription 及 expo-camera 插件保持一致：
  // app 现在既录语音消息也做语音通话，故文案需覆盖两者。
  assert.equal(audioPlugin[1].microphonePermission, '允许风信使用麦克风录制语音消息并进行语音通话。');
  assert.equal(audioPlugin[1].recordAudioAndroid, true);
});

test('app config declares NSMicrophoneUsageDescription so iOS does not hard-crash on mic access', () => {
  // ios/ 被 gitignore，app.json 是 native 配置的唯一真相源。其它隐私串（相机/相册/定位）都走
  // 显式 ios.infoPlist，唯独麦克风只靠 expo-audio 插件选项，没进到二进制 Info.plist —— 于是录音
  // 按钮一触发 requestRecordingPermissions / setAudioMode，iOS TCC 直接杀进程（绕过 JS try/catch）。
  const appJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'),
  );
  const micUsage = appJson.expo?.ios?.infoPlist?.NSMicrophoneUsageDescription;
  assert.equal(typeof micUsage, 'string');
  assert.ok(micUsage.length > 0);
});

test('sendVoiceMessage creates an OpenIM sound message from a local recording path', async () => {
  const sdkCalls = [];
  const { sendVoiceMessage } = loadTsModule('src/im/client.ts', {
    '@/im/media-uri': loadTsModule('src/im/media-uri.ts'),
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createSoundMessageFromFullPath: async (params) => {
          sdkCalls.push(['createSoundMessageFromFullPath', params]);
          return { clientMsgID: 'voice-1' };
        },
        sendMessage: async (params) => {
          sdkCalls.push(['sendMessage', params]);
          return params.message;
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
      LIMITS: { TRANSFER_MAX_AMOUNT: 99999 },
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: true,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
          setMessages: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  await sendVoiceMessage({
    sourceID: 'user-2',
    sessionType: 1,
    soundPath: 'file:///tmp/recording.m4a',
    duration: 3,
  });

  assert.deepEqual(normalize(sdkCalls), [
    [
      'createSoundMessageFromFullPath',
      {
        soundPath: '/tmp/recording.m4a',
        duration: 3,
      },
    ],
    [
      'sendMessage',
      {
        recvID: 'user2',
        groupID: '',
        message: { clientMsgID: 'voice-1' },
        offlinePushInfo: {
          title: '新消息',
          desc: '[语音]',
          ex: '',
          iOSPushSound: 'default',
          iOSBadgeCount: true,
        },
      },
    ],
  ]);
});

test('sendVoiceMessageByUrl creates an OpenIM sound message from a remote URL', async () => {
  const sdkCalls = [];
  const { sendVoiceMessageByUrl } = loadTsModule('src/im/client.ts', {
    '@/im/media-uri': loadTsModule('src/im/media-uri.ts'),
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createSoundMessageByURL: async (params) => {
          sdkCalls.push(['createSoundMessageByURL', params]);
          return { clientMsgID: 'voice-url-1' };
        },
        sendMessage: async (params) => {
          sdkCalls.push(['sendMessage', params]);
          return params.message;
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: {
        DocumentDirectoryPath: '/tmp',
        mkdir: async () => undefined,
      },
    },
    'react-native': {
      Platform: { OS: 'ios' },
    },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
      LIMITS: { TRANSFER_MAX_AMOUNT: 99999 },
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: true,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
          setMessages: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: {
        getState: () => ({
          setMessagesUnread: () => undefined,
        }),
      },
    },
  });

  await sendVoiceMessageByUrl({
    sourceID: 'user-2',
    sessionType: 1,
    sourceUrl: 'https://cdn.example.com/voice.m4a',
    soundPath: '',
    duration: 4,
    dataSize: 1024,
    soundType: 'm4a',
  });

  assert.deepEqual(normalize(sdkCalls), [
    [
      'createSoundMessageByURL',
      {
        uuid: '',
        soundPath: '',
        sourceUrl: 'https://cdn.example.com/voice.m4a',
        dataSize: 1024,
        duration: 4,
        soundType: 'm4a',
      },
    ],
    [
      'sendMessage',
      {
        recvID: 'user2',
        groupID: '',
        message: { clientMsgID: 'voice-url-1' },
        offlinePushInfo: {
          title: '新消息',
          desc: '[语音]',
          ex: '',
          iOSPushSound: 'default',
          iOSBadgeCount: true,
        },
      },
    ],
  ]);
});

function loadClientWithSoundStubs(sdkCalls) {
  return loadTsModule('src/im/client.ts', {
    '@/im/media-uri': loadTsModule('src/im/media-uri.ts'),
    '@openim/rn-client-sdk': {
      __esModule: true,
      default: {
        initSDK: async () => undefined,
        createSoundMessageByURL: async (params) => {
          sdkCalls.push(['createSoundMessageByURL', params]);
          return { clientMsgID: 'voice-url' };
        },
        createSoundMessageFromFullPath: async (params) => {
          sdkCalls.push(['createSoundMessageFromFullPath', params]);
          return { clientMsgID: 'voice-path' };
        },
        sendMessage: async (params) => {
          sdkCalls.push(['sendMessage', params.message]);
          return params.message;
        },
      },
      LogLevel: { Info: 0 },
      SessionType: { Single: 1, Group: 2 },
      ViewType: { History: 0 },
    },
    'react-native-fs': {
      __esModule: true,
      default: { DocumentDirectoryPath: '/tmp', mkdir: async () => undefined },
    },
    'react-native': { Platform: { OS: 'ios' } },
    '@/constants/config': {
      OPENIM_API_URL: 'https://im.example.com',
      OPENIM_WS_URL: 'wss://im.example.com',
      OPENIM_LOG_LEVEL: 0,
      LIMITS: { TRANSFER_MAX_AMOUNT: 99999 },
    },
    '@/stores/imStore': {
      useIMStore: {
        getState: () => ({
          connected: true,
          setError: () => undefined,
          setInitialized: () => undefined,
          setCurrentUserID: () => undefined,
          setConnecting: () => undefined,
          reset: () => undefined,
          setConversations: () => undefined,
          mergeConversations: () => undefined,
          setMessages: () => undefined,
        }),
      },
    },
    '@/stores/tabBadgeStore': {
      useTabBadgeStore: { getState: () => ({ setMessagesUnread: () => undefined }) },
    },
  });
}

test('sendVoiceMessageFromSource prefers the remote url so it never re-uploads', async () => {
  const sdkCalls = [];
  const { sendVoiceMessageFromSource } = loadClientWithSoundStubs(sdkCalls);

  await sendVoiceMessageFromSource({
    sourceID: 'user-2',
    sessionType: 1,
    sourceUrl: 'https://cdn.example.com/voice.m4a',
    soundPath: '/tmp/voice.m4a',
    duration: 4,
  });

  assert.equal(sdkCalls[0][0], 'createSoundMessageByURL');
  assert.equal(sdkCalls[0][1].sourceUrl, 'https://cdn.example.com/voice.m4a');
});

test('sendVoiceMessageFromSource throws (no silent no-op) when nothing is playable', async () => {
  const sdkCalls = [];
  const { sendVoiceMessageFromSource } = loadClientWithSoundStubs(sdkCalls);

  await assert.rejects(
    sendVoiceMessageFromSource({ sourceID: 'user-2', sessionType: 1, duration: 4 }),
    /可播放地址/,
  );
  assert.equal(sdkCalls.length, 0);
});

test('OpenIM voice messages map to a dedicated ChatMessage voice bubble model', () => {
  const voiceSendTime = new Date(2024, 0, 2, 12, 0, 0).getTime();
  const { mapMessageItemToChatMessage } = loadTsModule('src/im/mappers.ts', {
    '@openim/rn-client-sdk': {
      MessageType: {
        TextMessage: 101,
        PictureMessage: 102,
        VoiceMessage: 103,
        VideoMessage: 104,
        FileMessage: 105,
        CardMessage: 108,
        LocationMessage: 109,
        CustomMessage: 110,
        TypingMessage: 113,
      },
      SessionType: { Single: 1, Group: 2 },
    },
    '@/im/client': {
      NOTE_CARD_EXTENSION: 'note-card-v1',
      TRANSFER_CARD_EXTENSION: 'transfer-card-v1',
      fromImUserId: (userID) => userID,
    },
    '@/services/api/utils': {
      normalizeMediaUrl: (url) => url,
    },
    '@/i18n': {
      __esModule: true,
      default: {
        language: 'zh',
        t: (_key, options) => options.defaultValue,
      },
    },
    '@/utils/locale': {
      getLocalizedDateTimeLocale: (lng) =>
        lng && lng.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US',
    },
  });

  const mapped = mapMessageItemToChatMessage(
    {
      clientMsgID: 'voice-1',
      sendID: 'peer-1',
      senderNickname: 'Peer',
      contentType: 103,
      sendTime: voiceSendTime,
      status: 2,
      isRead: false,
      content: '',
      soundElem: {
        uuid: 'sound-1',
        soundPath: '',
        sourceUrl: 'https://cdn.example.com/voice.m4a',
        dataSize: 1024,
        duration: 4,
      },
    },
    'me',
  );

  assert.deepEqual(normalize(mapped), {
    id: 'voice-1',
    type: 'voice',
    time: '1/2',
    senderID: 'peer-1',
    outgoing: false,
    senderName: 'Peer',
    voiceUrl: 'https://cdn.example.com/voice.m4a',
    voicePath: '',
    voiceDuration: 4,
    voiceSize: 1024,
  });
});

test('chat voice bubble and screen wiring replace the mic placeholder alert', () => {
  const typeSource = fs.readFileSync(
    path.join(process.cwd(), 'src/types/index.ts'),
    'utf8',
  );
  const bubbleSource = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/chat/components/bubbles/voice-bubble.tsx',
    ),
    'utf8',
  );
  const screenSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  assert.match(typeSource, /'voice'/);
  assert.match(typeSource, /voiceDuration\?: number/);
  assert.match(typeSource, /voiceUrl\?: string/);
  assert.match(bubbleSource, /export const VoiceBubble/);
  assert.match(bubbleSource, /useAudioPlayer/);
  assert.match(bubbleSource, /setAudioModeAsync/);
  assert.match(bubbleSource, /player\.addListener\('playbackStatusUpdate'/);
  assert.doesNotMatch(bubbleSource, /useAudioPlayerStatus/);
  // 播放前切回 Playback 外放（否则录音留下的 PlayAndRecord 走听筒像没声音），
  // 且 play() 不被 seekTo 的失败挡住（首播未加载完时 seekTo 可能抛错）。
  assert.match(
    bubbleSource,
    /await setAudioModeAsync\(\{\s*allowsRecording:\s*false,\s*playsInSilentMode:\s*true,\s*\}\);[\s\S]*player\.play\(\);/,
  );
  assert.match(bubbleSource, /play-circle/);
  assert.match(bubbleSource, /pause-circle/);
  // 微信式播放进度条：填充宽度随 currentTime / 时长变化。
  assert.match(bubbleSource, /progressFill/);
  assert.match(bubbleSource, /width: `\$\{progress \* 100\}%`/);
  // 播完复位，避免停在结尾再点无反应。
  assert.match(bubbleSource, /status\.didJustFinish/);
  assert.match(screenSource, /useAudioRecorder\(RecordingPresets\.LOW_QUALITY/);
  assert.match(screenSource, /requestRecordingPermissionsAsync/);
  assert.match(screenSource, /setAudioModeAsync\(\{ allowsRecording: true, playsInSilentMode: true \}\)/);
  assert.match(screenSource, /sendVoiceMessage/);
  // 微信式按住说话：按住开始录音、松手发送、滑到左侧取消（PanResponder 驱动）。
  assert.match(screenSource, /startHoldRecording/);
  assert.match(screenSource, /finishHoldRecording/);
  assert.match(screenSource, /voicePanResponder/);
  // 微信式全屏录音浮层：录音时渲染，cancelArmed/elapsedSeconds 驱动取消态与波形。
  assert.match(screenSource, /VoiceRecordingOverlay/);
  assert.match(screenSource, /case 'voice'/);
  assert.doesNotMatch(screenSource, /该功能即将上线/);

  const overlaySource = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/chat/components/voice-recording-overlay.tsx',
    ),
    'utf8',
  );
  assert.match(overlaySource, /export const VoiceRecordingOverlay/);
  assert.match(overlaySource, /pointerEvents="none"/);
  assert.match(overlaySource, /cancelArmed/);
});
