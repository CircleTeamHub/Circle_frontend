import React from 'react';
// jest.mock 工厂里只能引用 mock 前缀的外部变量。
import { Pressable as MockPressable, Text as MockText, View as MockView } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import ChatDetailScreen from './ChatDetailScreen';
import {
  loadConversationMessages,
  markConversationAsRead,
  sendTextMessage,
} from '@/chat-core/client';
import { fetchChatMembers } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import { useComposerDraftStore } from '@/chat-core/composer-drafts';
import type { ChatConversationDto, ChatMessageDto } from '@/chat-core/protocol';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

/**
 * 聊天详情页的挂载冒烟:页面由二十来个 hooks 和几块组件拼成(见 chat-detail/),
 * 源码断言只能证明代码还在,证明不了它们接起来能跑。这里把真实的页面、真实的
 * chat-core store 挂起来,只替换 I/O(网络、socket、本地库、原生模块)和纯展示的
 * 叶子组件,走一遍「看到历史 → 输入 → 发送 → 开关面板」。
 */

// ── I/O 与原生模块:任意导出都是 jest.fn,需要返回值的单独覆写 ──────────────────
function mockStubModule(overrides: Record<string, unknown> = {}) {
  const fns = new Map<string, jest.Mock>();
  return new Proxy(
    { __esModule: true, ...overrides } as Record<string | symbol, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (!fns.has(prop)) fns.set(prop, jest.fn(() => Promise.resolve(undefined)));
        return fns.get(prop);
      },
    },
  );
}

function mockNullComponents(overrides: Record<string, unknown> = {}) {
  return new Proxy(
    { __esModule: true, ...overrides } as Record<string | symbol, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return () => null;
      },
    },
  );
}

// 翻译函数在真实环境里身份稳定;每次渲染换一个会让依赖 t 的 effect 反复重跑。
function mockT(key: string) {
  return key;
}

const mockTheme = {
  colors: new Proxy({}, { get: () => '#000000' }),
  isDark: false,
  mode: 'light',
  resolvedMode: 'light',
  setMode: () => undefined,
};

// 持久化 store 在模块求值时就会读存储,那时文件里的 const 还没初始化(jest.mock 被提升到
// import 之前),所以内存表挂在 globalThis 上按需创建。
function mockMemory(): Map<string, string> {
  const holder = globalThis as { __chatDetailSpecMemory?: Map<string, string> };
  holder.__chatDetailSpecMemory ??= new Map();
  return holder.__chatDetailSpecMemory;
}

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useLocalSearchParams: () => mockRouteParams(),
    useSegments: () => ['(tabs)', 'messages'],
    useNavigation: () => ({
      addListener: () => () => undefined,
      canGoBack: () => true,
      goBack: jest.fn(),
      setOptions: jest.fn(),
    }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      navigate: jest.fn(),
      canGoBack: () => true,
    },
  };
});
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: mockT, i18n: { language: 'zh' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
// 图标渲染成名字,好按「哪个按钮」去点(表情开关这类按钮没有无障碍标签)。
jest.mock('@expo/vector-icons', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  return {
    Ionicons: ({ name }: { name: string }) => createElement(MockText, null, `icon:${name}`),
  };
});
jest.mock('@/theme', () => {
  const numbers = new Proxy({}, { get: () => 8 });
  const typography = new Proxy({}, { get: () => ({}) });
  return {
    useTheme: () => mockTheme,
    Spacing: numbers,
    Radius: numbers,
    Typography: typography,
  };
});
jest.mock('@/storage', () => ({
  storage: {
    getString: (key: string) => mockMemory().get(key),
    getBoolean: () => undefined,
    getNumber: () => undefined,
    set: (key: string, value: unknown) => mockMemory().set(key, String(value)),
    delete: (key: string) => mockMemory().delete(key),
    remove: (key: string) => mockMemory().delete(key),
    contains: (key: string) => mockMemory().has(key),
    getAllKeys: () => [...mockMemory().keys()],
  },
  mmkvJsonStorage: {
    getItem: (key: string) => mockMemory().get(key) ?? null,
    setItem: (key: string, value: string) => mockMemory().set(key, value),
    removeItem: (key: string) => mockMemory().delete(key),
  },
}));
jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useAuthStore: create(() => ({
      user: { id: '0b8d4a0e-6f35-4c7e-9a52-3d1f0c9e7a11', nickname: '我', avatarUrl: null },
    })),
  };
});

jest.mock('@/chat-core/client', () =>
  mockStubModule({
    hasMoreHistory: jest.fn(() => false),
    markConversationAsRead: jest.fn(),
    resetHistoryCursor: jest.fn(),
  }),
);
jest.mock('@/chat-core/api', () => mockStubModule());
jest.mock('@/chat-core/socket-manager', () =>
  mockStubModule({
    sendChatTyping: jest.fn(),
    queryChatPresence: jest.fn(),
  }),
);
jest.mock('@/chat-core/local-db', () => mockStubModule());
jest.mock('@/chat-core/pending-media', () => mockStubModule());
jest.mock('@/services/api/calls', () => mockStubModule());
jest.mock('@/services/api/collections', () => mockStubModule());
jest.mock('@/services/api/credit-policy', () =>
  mockStubModule({
    getLocalLowCreditDecision: () => null,
    getCreditPolicyMessage: () => '',
    assertLocalCanSendMessage: jest.fn(),
  }),
);
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/services/api/notes', () => mockStubModule());
jest.mock('@/services/api/temp-chat', () => mockStubModule());
jest.mock('@/services/api/upload', () => mockStubModule());
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('@/features/notifications/utils/seen-target', () => mockStubModule());
jest.mock('@/features/chat/utils/image-thumbnail', () => mockStubModule());
jest.mock('@/features/chat/screens/ForwardPickerScreen', () => ({
  canForwardMessage: () => true,
}));
jest.mock('@/features/chat/hooks/use-chat-background-image-source', () => ({
  useChatBackgroundImageSource: () => null,
}));
jest.mock('expo-audio', () => ({
  AudioQuality: { MEDIUM: 64 },
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  RecordingPresets: { HIGH_QUALITY: {} },
  requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  useAudioRecorder: () => mockRecorder,
}));
jest.mock('expo-image-picker', () => mockStubModule());
jest.mock('expo-location', () => mockStubModule());

// ── 纯展示的叶子组件 ─────────────────────────────────────────────────────────
// 气泡按消息 id 记渲染次数:打字、已读回执这类与消息内容无关的变化不该让它们重渲染。
const mockBubbleRenders = new Map<string, number>();
function mockCountBubbleRender(id: string | undefined) {
  const key = id ?? '';
  mockBubbleRenders.set(key, (mockBubbleRenders.get(key) ?? 0) + 1);
}
jest.mock('@/features/chat/components/chat-bubble', () =>
  mockNullComponents({
    SentBubble: ({ message }: { message: { id?: string; text?: string } }) => {
      mockCountBubbleRender(message.id);
      return <MockText>{`sent:${message.text ?? ''}`}</MockText>;
    },
    ReceivedBubble: ({ message }: { message: { id?: string; text?: string } }) => {
      mockCountBubbleRender(message.id);
      return <MockText>{`received:${message.text ?? ''}`}</MockText>;
    },
  }),
);
jest.mock('@/features/chat/components/emoji-picker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <MockPressable accessibilityLabel="pick-emoji" onPress={() => onSelect('😀')} />
  ),
}));
jest.mock('@/features/chat/components/MessageActionMenu', () => mockNullComponents());
jest.mock('@/features/chat/components/media-source-sheet', () => mockNullComponents());
jest.mock('@/features/chat/components/photo-editor-modal', () => mockNullComponents());
jest.mock('@/features/chat/components/voice-recording-overlay', () => mockNullComponents());
jest.mock('@/components/ui/option-picker-sheet', () => mockNullComponents());
jest.mock('@/components/ui/avatar', () => mockNullComponents());
jest.mock('@/components/ui/group-chat-avatar', () => mockNullComponents());
jest.mock('@/components/ui/member-name', () => ({
  MemberName: ({ name }: { name?: string }) => <MockText>{name ?? ''}</MockText>,
}));
jest.mock('@/components/ui/divider', () => mockNullComponents());
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  return {
    KeyboardAvoidingContainer: ({ children, style }: { children: React.ReactNode; style?: object }) => (
      <MockView style={style}>{children}</MockView>
    ),
  };
});

const mockRecorder = {
  uri: null,
  record: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  prepareToRecordAsync: jest.fn(() => Promise.resolve()),
  getStatus: () => ({ isRecording: false, url: null }),
};

let mockParams: Record<string, string> = {};
function mockRouteParams() {
  return mockParams;
}

// jest-expo 冷启动下首帧很慢,findBy* 的 1s 默认超时会假红。
jest.setTimeout(30_000);
const SETTLE = { timeout: 10_000 };

// 会话 id 必须是 UUID —— 认不出来的 id 会被 resolveChatDetailIdentity 当成没传,页面落到预览态。
const ME = '0b8d4a0e-6f35-4c7e-9a52-3d1f0c9e7a11';
const PEER = '5c2e8f14-9a7b-4d3c-8e61-2f4a9b0c7d22';
const CONVERSATION = '9e41c7a3-2b58-4f06-a1d9-6c3e8b2f5a33';
const OTHER = '7d3f9b25-1c6a-4e8d-b072-4a5c1d3e9f44';
const GROUP = 'a6b2d8c4-3e7f-4a19-8b5d-9f1e2c4a6b55';

function message(
  height: number,
  senderId: string,
  text: string,
): ChatMessageDto {
  return {
    id: `msg-${height}`,
    conversationId: CONVERSATION,
    height,
    revision: height,
    type: 'text',
    content: { text },
    sender: { id: senderId, nickname: senderId === ME ? '我' : '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: new Date(Date.UTC(2026, 8, 16, 8, height)).toISOString(),
  };
}

function directConversation(): ChatConversationDto {
  return {
    id: CONVERSATION,
    type: 'DIRECT',
    peer: { id: PEER, nickname: '对方', avatarUrl: null },
    circleId: null,
    circle: null,
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
    muted: false,
  } as ChatConversationDto;
}

function standaloneGroup(): ChatConversationDto {
  return {
    id: GROUP,
    type: 'GROUP',
    peer: null,
    // 独立群聊:不挂圈子,成员目录直接可用,不经 /circle/:id 的身份查询。
    circleId: null,
    circle: null,
    name: '周末爬山群',
    myRole: 'MEMBER',
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
    muted: false,
  } as ChatConversationDto;
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks 不清 mockImplementation:发送桩的行为不能从上一条用例漏过来。
  jest.mocked(sendTextMessage).mockReset();
  jest.mocked(fetchChatMembers).mockResolvedValue([]);
  mockMemory().clear();
  // 草稿是按用户持久化的:上一条用例没发出去的输入不能漏进下一条。
  useComposerDraftStore.getState().resetForLogout();
  mockParams = {
    conversationID: CONVERSATION,
    sourceID: PEER,
    title: '对方',
    conversationType: 'private',
    conversationKind: 'direct',
  };
  useChatStore.setState({
    currentUserId: ME,
    connected: true,
    appForeground: true,
    conversations: [directConversation(), standaloneGroup()],
    messagesByConversation: {
      [CONVERSATION]: [message(2, ME, '晚上吃什么'), message(1, PEER, '在吗')],
      [GROUP]: [],
    },
    messageWindowByConversation: {},
    historyFloorByConversation: {},
    historyWindowFullByConversation: {},
  });
});

test('mounts a direct chat, shows the cached history and loads the focused conversation', async () => {
  render(<ChatDetailScreen />);

  expect(await screen.findByText('received:在吗', {}, SETTLE)).toBeTruthy();
  expect(screen.getByText('sent:晚上吃什么')).toBeTruthy();
  expect(screen.getByTestId(E2E_TEST_IDS.chatMessageList)).toBeTruthy();
  await waitFor(
    () => expect(loadConversationMessages).toHaveBeenCalledWith(CONVERSATION),
    SETTLE,
  );
  await waitFor(() => expect(markConversationAsRead).toHaveBeenCalled(), SETTLE);
});

test('a conversation scrolled up to the memory ceiling points to history search', async () => {
  useChatStore.setState({
    historyWindowFullByConversation: { [CONVERSATION]: true },
  });
  render(<ChatDetailScreen />);
  expect(
    await screen.findByText('chat.detail.historyWindowFull', {}, SETTLE),
  ).toBeTruthy();
});

test('leaving a deeply scrolled conversation hands its memory back', async () => {
  const deep = Array.from({ length: 450 }, (_, index) =>
    message(index + 1, index % 2 === 0 ? PEER : ME, `第${index + 1}条`),
  );
  useChatStore.setState({
    messagesByConversation: { [CONVERSATION]: deep, [GROUP]: [] },
    messageWindowByConversation: { [CONVERSATION]: 450 },
  });
  const view = render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatMessageList, {}, SETTLE);

  view.unmount();

  const state = useChatStore.getState();
  const kept = state.messagesByConversation[CONVERSATION];
  expect(kept).toHaveLength(200);
  expect(kept[0].height).toBe(251);
  expect(state.historyFloorByConversation[CONVERSATION]).toBe(251);
});

test('typing in the composer does not re-render the message bubbles', async () => {
  render(<ChatDetailScreen />);
  await screen.findByText('received:在吗', {}, SETTLE);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  mockBubbleRenders.clear();

  for (const text of ['晚', '晚上', '晚上见']) {
    fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.chatInput), text);
  }

  expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('晚上见');
  // 原来每敲一个字,列表里挂着的每个气泡都重渲染一遍。
  expect(Object.fromEntries(mockBubbleRenders)).toEqual({});
});

test('a read receipt re-renders only the message whose status changed', async () => {
  render(<ChatDetailScreen />);
  await screen.findByText('sent:晚上吃什么', {}, SETTLE);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  mockBubbleRenders.clear();

  await act(async () => {
    useChatStore.getState().applyRead(CONVERSATION, PEER, 2);
  });

  // 对方读到了第 2 条(我发的):只有它的「已读」变了。原来水位一变整份映射缓存作废,
  // 所有气泡(包括对方发的那条)都换成新对象重渲染。
  expect(mockBubbleRenders.get('msg-2') ?? 0).toBeGreaterThan(0);
  expect(mockBubbleRenders.get('msg-1') ?? 0).toBe(0);
});

test('a new incoming message renders only its own bubble', async () => {
  render(<ChatDetailScreen />);
  await screen.findByText('sent:晚上吃什么', {}, SETTLE);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  mockBubbleRenders.clear();

  await act(async () => {
    useChatStore.getState().ingestMessages(CONVERSATION, [message(3, PEER, '七点吧')]);
  });

  expect(await screen.findByText('received:七点吧', {}, SETTLE)).toBeTruthy();
  expect(mockBubbleRenders.get('msg-1') ?? 0).toBe(0);
  expect(mockBubbleRenders.get('msg-2') ?? 0).toBe(0);
});

test('typing then pressing send posts the trimmed text and clears the composer', async () => {
  render(<ChatDetailScreen />);
  const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);

  fireEvent.changeText(input, '  你好呀  ');
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('  你好呀  ');

  await act(async () => {
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatSend));
  });

  await waitFor(
    () =>
      expect(sendTextMessage).toHaveBeenCalledWith({
        conversationId: CONVERSATION,
        text: '你好呀',
        onCreate: expect.any(Function),
      }),
    SETTLE,
  );
  await waitFor(
    () => expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe(''),
    SETTLE,
  );
});

test('a message still waiting for the server does not hold the composer', async () => {
  // 断线时消息在发送队列里等重连:上屏(onCreate)之后输入框就该清空、能接着发下一条。
  jest.mocked(sendTextMessage).mockImplementation(({ onCreate }) => {
    onCreate?.({} as ChatMessageDto);
    return new Promise<ChatMessageDto>(() => {});
  });
  render(<ChatDetailScreen />);
  const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);

  fireEvent.changeText(input, '第一条');
  await act(async () => {
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatSend));
  });
  await waitFor(
    () => expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe(''),
    SETTLE,
  );

  fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.chatInput), '第二条');
  await act(async () => {
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatSend));
  });
  await waitFor(() => expect(sendTextMessage).toHaveBeenCalledTimes(2), SETTLE);
  expect(jest.mocked(sendTextMessage).mock.calls[1][0].text).toBe('第二条');
});

test('a send refused before it reaches the screen keeps the draft', async () => {
  // 本地门禁拦下:什么都没上屏,草稿不能丢。
  jest
    .mocked(sendTextMessage)
    .mockImplementation(() => Promise.reject(new Error('LOW_CREDIT_SCORE')));
  render(<ChatDetailScreen />);
  const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);

  fireEvent.changeText(input, '留着我');
  await act(async () => {
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatSend));
  });
  await waitFor(() => expect(sendTextMessage).toHaveBeenCalledTimes(1), SETTLE);
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('留着我');
});

test('the empty-composer action opens the attachment panel, and the emoji panel inserts into the draft', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);

  expect(screen.queryByText('chat.attachments.location')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatSend));
  });
  expect(await screen.findByText('chat.attachments.location', {}, SETTLE)).toBeTruthy();

  expect(screen.queryByLabelText('pick-emoji')).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByText('icon:happy-outline'));
  });
  const pick = await screen.findByLabelText('pick-emoji', {}, SETTLE);
  // 表情面板和附件面板互斥。
  expect(screen.queryByText('chat.attachments.location')).toBeNull();

  await act(async () => {
    fireEvent.press(pick);
  });
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('😀');
});

test('in a group, typing @ lists members, picking one inserts the mention and the send carries it', async () => {
  mockParams = {
    conversationID: GROUP,
    sourceID: GROUP,
    title: '周末爬山群',
    conversationType: 'group',
    conversationKind: 'group',
  };
  jest.mocked(fetchChatMembers).mockResolvedValue([
    { userId: ME, nickname: '我' },
    { userId: PEER, nickname: '方方', alias: '小方' },
    { userId: OTHER, nickname: '小李' },
  ] as Awaited<ReturnType<typeof fetchChatMembers>>);
  render(<ChatDetailScreen />);
  const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);

  // 真机上输入之后紧跟一次光标事件;选人时按光标位置替换 @ 片段,测试里要手动补上。
  fireEvent.changeText(input, '@');
  fireEvent(screen.getByTestId(E2E_TEST_IDS.chatInput), 'selectionChange', {
    nativeEvent: { selection: { start: 1, end: 1 } },
  });
  // 候选用群昵称,不含自己。
  const candidate = await screen.findByText('小方', {}, SETTLE);
  expect(screen.getByText('小李')).toBeTruthy();
  expect(screen.queryByText('方方')).toBeNull();
  expect(fetchChatMembers).toHaveBeenCalledWith(GROUP);

  await act(async () => {
    fireEvent.press(candidate);
  });
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('@小方 ');
  expect(screen.queryByText('小李')).toBeNull();

  fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.chatInput), '@小方 周六几点出发');
  await act(async () => {
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatSend));
  });

  await waitFor(
    () =>
      expect(sendTextMessage).toHaveBeenCalledWith({
        conversationId: GROUP,
        text: '@小方 周六几点出发',
        mentions: [{ userId: PEER, nickname: '小方' }],
        atAll: false,
        onCreate: expect.any(Function),
      }),
    SETTLE,
  );
});
