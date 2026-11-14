import React from 'react';
// jest.mock 工厂里只能引用 mock 前缀的外部变量。
import { Alert, FlatList, Keyboard, LayoutAnimation, PixelRatio, Pressable as MockPressable, StyleSheet, Text as MockText, View as MockView } from 'react-native';
import { router } from 'expo-router';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import ChatDetailScreen from './ChatDetailScreen';
import {
  loadConversationMessages,
  loadOlderConversationMessages,
  markConversationAsRead,
  sendTextMessage,
  sendQuoteMessage,
} from '@/chat-core/client';
import { clearChatConversationHistory, fetchChatMembers, requestChatHistoryClear } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import { useComposerDraftStore } from '@/chat-core/composer-drafts';
import type { ChatConversationDto, ChatMessageDto } from '@/chat-core/protocol';
import type { ChatMessage } from '@/types';
import i18n from '@/i18n';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { API_URL } from '@/constants/config';
import { createCollection } from '@/services/api/collections';
import { KeyboardAvoidingContainer } from '@/components/ui/keyboard-avoiding-container';

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

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
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
    MaterialCommunityIcons: ({ name }: { name: string }) => createElement(MockText, null, `mci:${name}`),
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
    withAlpha: jest.requireActual('@/theme/tokens').withAlpha,
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
jest.mock('@/features/chat/utils/chat-image-compress', () => mockStubModule());
jest.mock('@/features/chat/utils/chat-video-poster', () => mockStubModule());
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
    ReceivedBubble: ({ message, onAvatarLongPress }: { message: { id?: string; text?: string }; onAvatarLongPress?: () => void }) => {
      mockCountBubbleRender(message.id);
      return <MockView><MockPressable testID={`avatar:${message.id}`} onLongPress={onAvatarLongPress} /><MockText>{`received:${message.text ?? ''}`}</MockText></MockView>;
    },
    ImageBubble: ({ message, onImagePress }: { message: ChatMessage; onImagePress: (message: ChatMessage) => void }) => (
      <MockPressable testID={`photo:${message.id}`} onPress={() => onImagePress(message)} />
    ),
  }),
);
jest.mock('@/components/ui/image-viewer', () => ({
  ImageViewer: (props: object) => <MockView testID="conversation-image-viewer" {...props} />,
}));
jest.mock('@/features/chat/components/emoji-picker', () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <MockPressable accessibilityLabel="pick-emoji" onPress={() => onSelect('😀')} />
  ),
}));
jest.mock('@/features/chat/components/MessageActionMenu', () => ({
  MessageActionMenu: ({ anchor, actions, onDismiss }: { anchor: unknown; actions: { key: string; onPress: () => void }[]; onDismiss: () => void }) => anchor ? <MockView>{actions.map((action) => <MockPressable key={action.key} accessibilityLabel={`message-action-${action.key}`} onPress={() => { onDismiss(); action.onPress(); }} />)}</MockView> : null,
}));
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
    KeyboardAvoidingContainer: ({ children, style, testID }: { children: React.ReactNode; style?: object; testID?: string }) => (
      <MockView style={style} testID={testID}>{children}</MockView>
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

test('a shared pinned group notice appears below the header, opens its detail page and disappears when turned off', async () => {
  const group = { ...standaloneGroup(), notice: '完整群公告第一行\n第二行', noticePinned: true };
  mockParams = { conversationID: GROUP, sourceID: GROUP, title: group.name!, conversationType: 'group', conversationKind: 'group' };
  useChatStore.getState().upsertConversation(group);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    render(<ChatDetailScreen />);
    expect(await screen.findByTestId('group-notice-banner')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: '完整群公告第一行 第二行' }));
    // A page in the same stack, not a dialog.
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(tabs)/messages/group-notice',
      params: { conversationID: GROUP },
    });
    expect(alert).not.toHaveBeenCalled();
    act(() => useChatStore.getState().upsertConversation({ ...group, noticePinned: false }));
    expect(screen.queryByTestId('group-notice-banner')).toBeNull();
  } finally { alert.mockRestore(); }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
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

// 进页不卡:native-stack 要等新页面首次提交完才开始推入动画,首帧里画十几个气泡
// 就等于点下去干等。首帧只有页面壳(页头、列表容器、输入栏),缓存的消息下一帧再交给列表。
test('the first commit is only the page shell; cached bubbles arrive on the next frame', async () => {
  render(<ChatDetailScreen />);

  expect(screen.getByTestId(E2E_TEST_IDS.chatInput)).toBeTruthy();
  expect(screen.getByTestId(E2E_TEST_IDS.chatMessageList)).toBeTruthy();
  expect(screen.queryByText('received:在吗')).toBeNull();
  expect(screen.queryByText('sent:晚上吃什么')).toBeNull();
  expect(await screen.findByText('received:在吗', {}, SETTLE)).toBeTruthy();
  expect(screen.getByText('sent:晚上吃什么')).toBeTruthy();
});

// 首帧消息还没交给列表,空列表量完尺寸就可能触底。那一下不能去翻更早的一页:
// 繁忙的群消息多、记过翻页起点,每次进会话都会白发一次请求、窗口跟着涨一页。
test('the empty first frame does not page older history', async () => {
  useChatStore.setState({ historyFloorByConversation: { [CONVERSATION]: 1 } });
  render(<ChatDetailScreen />);
  const list = screen.UNSAFE_getAllByType(FlatList).find((item) => item.props.testID === E2E_TEST_IDS.chatMessageList)!;
  act(() => {
    list.props.onEndReached?.({ distanceFromEnd: 0 });
  });
  expect(loadOlderConversationMessages).not.toHaveBeenCalled();
  expect(await screen.findByText('received:在吗', {}, SETTLE)).toBeTruthy();
});

// 从搜索结果进来、目标就在缓存里:搜索定位要等消息交给列表之后才滚,
// 对着首帧的空列表 scrollToIndex 会同步抛错(只延后 FlatList 的 data 就会这样)。
test('opening from a search result with cached history mounts cleanly and lands on the message', async () => {
  mockParams = { ...mockParams, searchedMsgID: 'msg-1' };
  render(<ChatDetailScreen />);
  expect(await screen.findByText('received:在吗', {}, SETTLE)).toBeTruthy();
  expect(loadOlderConversationMessages).not.toHaveBeenCalled();
});

// 文字加密已整体删除:老开发数据里残留的 encrypted-text 消息走未知类型的占位文案,
// 不崩、不渲染空白气泡,也不把信封里的密文当正文显示出来。
test('a leftover encrypted-text message renders the unsupported-type placeholder', async () => {
  const encrypted: ChatMessageDto = {
    ...message(3, PEER, ''),
    type: 'encrypted-text',
    content: {
      envelope: {
        conversationId: CONVERSATION,
        senderDeviceId: 'peer-device',
        clientMessageId: 'd-encrypted',
        ciphertext: 'opaque',
      },
      signature: 'proof',
    },
  };
  useChatStore.setState({
    messagesByConversation: {
      [CONVERSATION]: [encrypted, message(2, ME, '晚上吃什么'), message(1, PEER, '在吗')],
      [GROUP]: [],
    },
  });

  render(<ChatDetailScreen />);

  expect(
    await screen.findByText(`received:${i18n.t('im.message.unsupported')}`, {}, SETTLE),
  ).toBeTruthy();
  expect(screen.queryByText(/opaque/)).toBeNull();
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

test('the floating composer leaves scrollable space for the latest message as its height changes', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  const dock = screen.getByTestId('chat-composer-dock');
  expect(dock).toHaveStyle({ position: 'absolute', bottom: 0 });
  for (const height of [114, 180]) {
    fireEvent(dock, 'layout', {
      nativeEvent: { layout: { x: 0, y: 300, width: 390, height } },
    });
    const list = screen.getByTestId(E2E_TEST_IDS.chatMessageList);
    // 倒序列表的 paddingTop 在视觉底部，给输入栏/回复预览留位，但视口仍延伸到屏幕底。
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingTop).toBe(height + 8);
    expect(StyleSheet.flatten(list.props.style).paddingBottom).toBeUndefined();
  }
});

test('the floating header and banners leave room for the oldest message as their height changes', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  const dock = screen.getByTestId('chat-top-dock');
  // 顶栏悬浮在消息上:和输入栏一样是绝对定位,消息区一直铺到屏幕顶。
  expect(dock).toHaveStyle({ position: 'absolute', top: 0 });
  expect(within(dock).getByTestId(E2E_TEST_IDS.chatBack)).toBeTruthy();
  for (const height of [104, 160]) {
    fireEvent(dock, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height } },
    });
    const list = screen.getByTestId(E2E_TEST_IDS.chatMessageList);
    // 倒序列表的 paddingBottom 在视觉顶部(Spacing 桩恒为 8)。
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(height + 8);
  }
});

test('seen unread messages do not become unread again when typing shrinks the viewport', async () => {
  mockParams = { ...mockParams, initialUnreadCount: '2', initialReadHeight: '0' };
  useChatStore.setState({
    messagesByConversation: {
      [CONVERSATION]: [message(1, PEER, '第一条'), message(2, PEER, '第二条')],
      [GROUP]: [],
    },
  });
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatUnreadJump, {}, SETTLE);

  // Only the newest message is visible: the unseen start must still be offered.
  await act(async () => screen.UNSAFE_getByType(FlatList).props.onViewableItemsChanged({
    viewableItems: [{ item: { id: 'msg-2' }, isViewable: true, index: 0, key: 'msg-2' }],
    changed: [],
  }));
  expect(screen.getByTestId(E2E_TEST_IDS.chatUnreadJump)).toBeTruthy();

  // The full viewport reveals the unread start, so the prompt clears immediately.
  await act(async () => screen.UNSAFE_getByType(FlatList).props.onViewableItemsChanged({
    viewableItems: [
      { item: { id: 'msg-2' }, isViewable: true, index: 0, key: 'msg-2' },
      { item: { id: 'msg-1' }, isViewable: true, index: 1, key: 'msg-1' },
    ],
    changed: [],
  }));
  expect(screen.queryByTestId(E2E_TEST_IDS.chatUnreadJump)).toBeNull();

  await act(async () => fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.chatInput), '回复'));
  // Opening the keyboard moves the already seen start outside the visible area.
  await act(async () => screen.UNSAFE_getByType(FlatList).props.onViewableItemsChanged({
    viewableItems: [{ item: { id: 'msg-2' }, isViewable: true, index: 0, key: 'msg-2' }],
    changed: [],
  }));
  expect(screen.queryByTestId(E2E_TEST_IDS.chatUnreadJump)).toBeNull();
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

test('message multi-select toggles chat rows and cancel restores the composer', async () => {
  render(<ChatDetailScreen />);
  const received = await screen.findByText('received:在吗', {}, SETTLE);
  fireEvent(received, 'longPress', { nativeEvent: { pageX: 100, pageY: 200 } });
  fireEvent.press(screen.getByLabelText('message-action-multi-select'));
  expect(screen.queryByTestId(E2E_TEST_IDS.chatInput)).toBeNull();
  expect(screen.getByRole('checkbox', { name: '在吗' }).props.accessibilityState.checked).toBe(true);
  const other = screen.getByRole('checkbox', { name: '晚上吃什么' });
  fireEvent.press(other);
  expect(screen.getByRole('checkbox', { name: '晚上吃什么' }).props.accessibilityState.checked).toBe(true);
  for (const name of ['common.save', 'chat.messageActions.forward', 'chat.messageActions.collect', 'common.delete']) {
    expect(screen.getByRole('button', { name })).toBeTruthy();
  }
  expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  fireEvent.press(screen.getByLabelText('common.cancel'));
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput)).toBeTruthy();
});

test('the multi-select favorite action persists each selected message once and restores the composer', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  // The store keeps ascending heights; the timeline reverses them for its inverted list.
  useChatStore.setState({ messagesByConversation: { [CONVERSATION]: [message(1, PEER, '在吗'), message(2, ME, '晚上吃什么')], [GROUP]: [] } });
  const rendered = render(<ChatDetailScreen />);
  try {
    const received = await screen.findByText('received:在吗', {}, SETTLE);
    fireEvent(received, 'longPress', { nativeEvent: { pageX: 100, pageY: 200 } });
    fireEvent.press(screen.getByLabelText('message-action-multi-select'));
    fireEvent.press(screen.getByRole('checkbox', { name: '晚上吃什么' }));
    fireEvent.press(screen.getByRole('button', { name: 'chat.messageActions.collect' }));
    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(2));
    expect(createCollection).toHaveBeenNthCalledWith(1, expect.objectContaining({ sourceID: 'msg-1' }));
    expect(createCollection).toHaveBeenNthCalledWith(2, expect.objectContaining({ sourceID: 'msg-2' }));
    await screen.findByTestId(E2E_TEST_IDS.chatInput);
    expect(alert).toHaveBeenCalledTimes(1);
  } finally { rendered.unmount(); alert.mockRestore(); }
});

test('the multi-select delete action requires confirmation and removes only the chosen message', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const rendered = render(<ChatDetailScreen />);
  try {
    const received = await screen.findByText('received:在吗', {}, SETTLE);
    fireEvent(received, 'longPress', { nativeEvent: { pageX: 100, pageY: 200 } });
    fireEvent.press(screen.getByLabelText('message-action-multi-select'));
    fireEvent.press(screen.getByRole('button', { name: 'common.delete' }));
    expect(useChatStore.getState().messagesByConversation[CONVERSATION]).toHaveLength(2);
    const actions = alert.mock.calls.at(-1)?.[2];
    act(() => actions?.find((action) => action.style === 'destructive')?.onPress?.());
    expect(useChatStore.getState().messagesByConversation[CONVERSATION].map((item) => item.id)).toEqual(['msg-2']);
    expect(screen.getByTestId(E2E_TEST_IDS.chatInput)).toBeTruthy();
  } finally { rendered.unmount(); alert.mockRestore(); }
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

// 进会话后会重拉最新一页:和手上那份一字不差的消息沿用原对象,已经画好的气泡不重画
// (原来整屏重画一遍,图片还跟着重载,正好撞上用户刚开始滑动)。
test('re-fetching an unchanged page does not re-render the bubbles already on screen', async () => {
  render(<ChatDetailScreen />);
  await screen.findByText('sent:晚上吃什么', {}, SETTLE);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  mockBubbleRenders.clear();

  await act(async () => {
    useChatStore.getState().ingestMessages(CONVERSATION, [message(1, PEER, '在吗'), message(2, ME, '晚上吃什么')]);
  });

  expect(mockBubbleRenders.get('msg-1') ?? 0).toBe(0);
  expect(mockBubbleRenders.get('msg-2') ?? 0).toBe(0);
});

// 用 msg-2:前面的多选删除用例把 msg-1 记成了本机删除(墓碑在模块里,不随用例清),
// 再收 msg-1 会被当成删掉的挡下。
test('a re-fetched message whose content differs still replaces the one on screen', async () => {
  render(<ChatDetailScreen />);
  await screen.findByText('sent:晚上吃什么', {}, SETTLE);

  await act(async () => {
    useChatStore.getState().ingestMessages(CONVERSATION, [message(2, ME, '晚上吃什么呀')]);
  });

  expect(await screen.findByText('sent:晚上吃什么呀', {}, SETTLE)).toBeTruthy();
});

function photoMessage(height: number, senderId = PEER): ChatMessageDto {
  return {
    ...message(height, senderId, ''),
    type: 'image',
    content: { url: `${API_URL}/media/${height}.jpg` },
    burnDurationSec: 30,
    burnExpiresAt: null,
  };
}

test('viewing a newly received gallery photo while scrolled into history reports its read height and expiry closes it', async () => {
  useChatStore.setState({ messagesByConversation: { [CONVERSATION]: [photoMessage(1)] } });
  render(<ChatDetailScreen />);
  await screen.findByTestId('photo:msg-1', {}, SETTLE);
  await act(async () => fireEvent.scroll(screen.getByTestId(E2E_TEST_IDS.chatMessageList), {
    nativeEvent: { contentOffset: { y: 1000, x: 0 }, layoutMeasurement: { height: 600, width: 400 }, contentSize: { height: 2000, width: 400 } },
  }));
  fireEvent.press(screen.getByTestId('photo:msg-1'));
  expect(markConversationAsRead).toHaveBeenLastCalledWith(CONVERSATION, 1);
  jest.mocked(markConversationAsRead).mockClear();

  await act(async () => useChatStore.getState().ingestMessages(CONVERSATION, [
    photoMessage(3), message(4, PEER, 'A newer unseen text'),
  ]));
  expect(markConversationAsRead).not.toHaveBeenCalled();
  act(() => screen.getByTestId('conversation-image-viewer').props.onIndexChange(1));
  expect(markConversationAsRead).toHaveBeenCalledWith(CONVERSATION, 3);
  expect(markConversationAsRead).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('conversation-image-viewer').props.initialIndex).toBe(1);

  await act(async () => {
    useChatStore.getState().ingestMessages(CONVERSATION, [{
      ...photoMessage(3), revision: 5, burnExpiresAt: new Date(Date.now() - 1).toISOString(),
    }]);
    await useChatStore.getState().purgeExpiredBurnMessages({ conversationIds: [CONVERSATION] });
  });
  expect(screen.queryByTestId('conversation-image-viewer')).toBeNull();
});

test.each(['background', 'other-chat', 'signed-out', 'other-user', 'unfocused', 'sent'])(
  'gallery paging does not report a read for %s', async (state) => {
    useChatStore.setState({ messagesByConversation: { [CONVERSATION]: [
      photoMessage(1), photoMessage(3, state === 'sent' ? ME : PEER),
    ] } });
    const view = render(<ChatDetailScreen />);
    await screen.findByTestId('photo:msg-1', {}, SETTLE);
    await act(async () => fireEvent.scroll(screen.getByTestId(E2E_TEST_IDS.chatMessageList), {
      nativeEvent: { contentOffset: { y: 1000, x: 0 }, layoutMeasurement: { height: 600, width: 400 }, contentSize: { height: 2000, width: 400 } },
    }));
    fireEvent.press(screen.getByTestId('photo:msg-1'));
    // Retain the callback to cover an event queued before focus/account changes.
    const onIndexChange = screen.getByTestId('conversation-image-viewer').props.onIndexChange;
    await act(async () => {
      if (state === 'background') useChatStore.setState({ appForeground: false });
      if (state === 'other-chat') useChatStore.setState({ activeConversationId: OTHER });
      if (state === 'signed-out') useChatStore.setState({ currentUserId: null });
      if (state === 'other-user') useChatStore.setState({ currentUserId: OTHER });
      if (state === 'unfocused') { mockFocused = false; view.rerender(<ChatDetailScreen />); }
    });
    jest.mocked(markConversationAsRead).mockClear();
    act(() => {
      if (state === 'unfocused') screen.getByTestId('conversation-image-viewer').props.onIndexChange(1);
      else onIndexChange(1);
    });
    expect(markConversationAsRead).not.toHaveBeenCalled();
  },
);

test('wrapped chat drafts expand into a full-screen editor and keep edits when collapsed', async () => {
  render(<ChatDetailScreen />);
  const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  expect(input).toHaveProp('submitBehavior', 'newline');
  const expand = 'chat.detail.expandComposer';
  const lineHeight = 24 * PixelRatio.getFontScale();
  fireEvent.changeText(input, '你好');
  fireEvent(input, 'layout', { nativeEvent: { layout: { width: 120, height: 24 + lineHeight } } });
  expect(screen.queryByRole('button', { name: expand })).toBeNull();

  const wrapped = '这段草稿超过一行时，可以打开全屏编辑器继续编辑。';
  fireEvent.changeText(input, wrapped);
  fireEvent(input, 'layout', { nativeEvent: { layout: { width: 120, height: 24 + 2 * lineHeight } } });
  fireEvent.press(screen.getByRole('button', { name: expand }));

  const expandedInput = screen.getByTestId('chat-expanded-input');
  expect(expandedInput).toHaveProp('value', wrapped);
  fireEvent.changeText(expandedInput, wrapped + '\\n第二段');
  fireEvent.press(screen.getByRole('button', { name: 'chat.detail.collapseComposer' }));
  expect(screen.queryByTestId('chat-expanded-input')).toBeNull();
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput)).toHaveProp('value', wrapped + '\\n第二段');

  fireEvent.changeText(input, '短草稿');
  fireEvent(input, 'layout', { nativeEvent: { layout: { width: 120, height: 24 + lineHeight } } });
  expect(screen.queryByRole('button', { name: expand })).toBeNull();
});

test.each(['inline', 'expanded'] as const)(
  'sending from the %s composer posts trimmed text and clears the draft',
  async (mode) => {
    render(<ChatDetailScreen />);
    const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);

    fireEvent.changeText(input, '  你好呀  ');
    expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('  你好呀  ');

    let sendButtonId: string = E2E_TEST_IDS.chatSend;
    if (mode === 'expanded') {
      fireEvent(input, 'layout', {
        nativeEvent: { layout: { width: 100, height: 24 + 2 * 24 * PixelRatio.getFontScale() } },
      });
      fireEvent.press(screen.getByRole('button', { name: 'chat.detail.expandComposer' }));
      fireEvent.changeText(screen.getByTestId('chat-expanded-input'), '  你好呀  ');
      sendButtonId = 'chat-expanded-send';
    }
    await act(async () => {
      fireEvent.press(screen.getByTestId(sendButtonId));
    });
    expect(screen.queryByTestId('chat-expanded-input')).toBeNull();

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
  },
);

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

test('the attachment button stays available with a draft and the emoji button inserts into it', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);

  expect(screen.queryByText('chat.attachments.location')).toBeNull();
  fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.chatInput), '你好');
  expect(screen.getByText('icon:mic-outline')).toBeTruthy();
  fireEvent(screen.getByTestId(E2E_TEST_IDS.chatInput), 'selectionChange', {
    nativeEvent: { selection: { start: 2, end: 2 } },
  });
  await act(async () => {
    fireEvent.press(screen.getByLabelText('chat.detail.attachmentPanelLabel'));
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
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('你好😀');
  expect(sendTextMessage).not.toHaveBeenCalled();
});

test.each(['emoji', 'attachment'])('opening the %s panel animates layout without fading newly mounted views', async (panel) => {
  const animate = jest.spyOn(LayoutAnimation, 'configureNext');
  try {
    render(<ChatDetailScreen />);
    await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
    animate.mockClear();
    await act(async () => fireEvent.press(screen.getByLabelText(`chat.detail.${panel}PanelLabel`)));
    expect(animate).toHaveBeenCalledWith({
      duration: 300,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
  } finally {
    animate.mockRestore();
  }
});

test.each(['emoji', 'attachment'])('%s panels replace keyboard avoidance while the native keyboard is still closing', async (panel) => {
  const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  try {
    render(<ChatDetailScreen />);
    const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
    expect(screen.UNSAFE_getByType(KeyboardAvoidingContainer).props.enabled).toBe(true);
    await act(async () => fireEvent.press(screen.getByLabelText(`chat.detail.${panel}PanelLabel`)));
    expect(dismiss).toHaveBeenCalled();
    // Dismissal is asynchronous: no keyboard hide event has arrived yet.
    expect(Keyboard.isVisible()).toBe(true);
    expect(screen.UNSAFE_getByType(KeyboardAvoidingContainer).props.enabled).toBe(false);
    fireEvent(input, 'focus');
    expect(screen.UNSAFE_getByType(KeyboardAvoidingContainer).props.enabled).toBe(true);
  } finally {
    visible.mockRestore();
    dismiss.mockRestore();
  }
});

// 键盘收起是原生侧立刻开始的,面板要等这次渲染提交后才出现。先收键盘的话,键盘滑走后
// 输入栏下面会空一截,面板过几帧才补上来 —— 也就是点表情 / 「+」时闪的那一下。
test.each(['emoji', 'attachment'])('the %s panel is already on screen when the keyboard starts closing', async (panel) => {
  const panelShown = () => panel === 'emoji'
    ? screen.queryByLabelText('pick-emoji') !== null
    : screen.queryByText('chat.attachments.location') !== null;
  const shownAtDismiss: boolean[] = [];
  let pressed = false;
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {
    if (pressed) shownAtDismiss.push(panelShown());
  });
  try {
    render(<ChatDetailScreen />);
    await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
    pressed = true;
    await act(async () => fireEvent.press(screen.getByLabelText(`chat.detail.${panel}PanelLabel`)));
    expect(panelShown()).toBe(true);
    expect(shownAtDismiss).toEqual([true]);
  } finally {
    dismiss.mockRestore();
  }
});

// 面板是新挂上的,不带过渡、直接出现在最终位置;消息区和输入栏还在往上收。面板若画在
// 上面,输入栏会先被盖住、再从面板后面钻出来。
test.each(['emoji', 'attachment'])('the %s panel is drawn beneath the chat body so it never covers the rising composer', async (panel) => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  await act(async () => fireEvent.press(screen.getByLabelText(`chat.detail.${panel}PanelLabel`)));
  expect(StyleSheet.flatten(screen.getByTestId(`chat-${panel}-panel`).props.style).zIndex).toBe(-1);
});

// 回归:容器只有背景色时 Fabric 会把它的子视图拍平到外层,按 zIndex 排序后面板落到容器
// 背景下面,整块面板被盖住,看着是黑的。容器必须自成层叠上下文。
test('the chat container keeps the panels above its own background', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  expect(StyleSheet.flatten(screen.getByTestId(E2E_TEST_IDS.chatScreen).props.style).isolation).toBe('isolate');
});

// 半屏里避让键盘的是外层半屏容器。面板打开要和外层撤掉键盘留白落在同一次渲染里,
// 否则面板会先塞进被键盘压矮的半屏、把聊天区挤扁,下一帧才弹回来。
test('in the sheet, opening a panel tells the sheet before the panel renders so both land in one commit', async () => {
  const panelShownAtNotice: [boolean, boolean][] = [];
  let pressed = false;
  const onPanelOpenChange = jest.fn((open: boolean) => {
    if (pressed) panelShownAtNotice.push([open, screen.queryByLabelText('pick-emoji') !== null]);
  });
  render(<ChatDetailScreen sheet={{ onClose: jest.fn(), onExpand: jest.fn(), onPanelOpenChange }} />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  pressed = true;
  await act(async () => fireEvent.press(screen.getByLabelText('chat.detail.emojiPanelLabel')));
  expect(screen.queryByLabelText('pick-emoji')).not.toBeNull();
  expect(panelShownAtNotice[0]).toEqual([true, false]);
  onPanelOpenChange.mockClear();
  await act(async () => fireEvent(screen.getByTestId(E2E_TEST_IDS.chatInput), 'focus'));
  expect(screen.queryByLabelText('pick-emoji')).toBeNull();
  expect(onPanelOpenChange).toHaveBeenLastCalledWith(false);
});

test.each([
  // sourceID:选择结果只交给打开选择页的这个聊天。
  ['notes', 'share-picker', { type: 'note', sourceID: PEER }],
  ['friendCard', 'share-picker', { type: 'friend', sourceID: PEER }],
  ['favorites', 'share-picker', { type: 'favorite', sourceID: PEER, conversationID: CONVERSATION }],
  ['quickReply', 'share-picker', { type: 'quick-reply', sourceID: PEER }],
  ['transfer', 'transfer-composer', { recipientId: PEER, recipientName: '对方', recipientAvatar: '' }],
  ['mediaHub', null, null],
] as const)('opening the %s tool does not apply a global layout animation to the destination', async (label, route, params) => {
  const animate = jest.spyOn(LayoutAnimation, 'configureNext');
  try {
    render(<ChatDetailScreen />);
    await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
    await act(async () => fireEvent.press(screen.getByLabelText('chat.detail.attachmentPanelLabel')));
    animate.mockClear();
    await act(async () => fireEvent.press(screen.getByText(`chat.attachments.${label}`)));
    expect(animate).not.toHaveBeenCalled();
    expect(screen.queryByText('chat.attachments.notes')).toBeNull();
    if (route) {
      expect(router.push).toHaveBeenCalledWith({ pathname: `/(tabs)/messages/${route}`, params });
    }
  } finally {
    animate.mockRestore();
  }
});

test('the input keeps only the send button; the shortcut row below holds every other tool', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  const send = () => screen.getByTestId(E2E_TEST_IDS.chatSend);
  expect(send()).toBeDisabled();
  fireEvent.changeText(screen.getByTestId(E2E_TEST_IDS.chatInput), '你好');
  expect(send()).toBeEnabled();

  const composerIcons = [
    'icon:arrow-up',
    'icon:mic-outline',
    'icon:image-outline',
    'icon:document-text-outline',
    'icon:location-outline',
    'mci:chat-remove-outline',
    'icon:happy-outline',
    'icon:add-circle-outline',
  ];
  const order = screen
    .getAllByText(/^(icon|mci):/)
    .map((node) => String(node.props.children))
    .filter((name) => composerIcons.includes(name));
  expect(order).toEqual(composerIcons);
});

test('the notes shortcut opens the note picker straight from the composer', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  await act(async () => fireEvent.press(screen.getByLabelText('chat.attachments.notes')));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/messages/share-picker',
    params: { type: 'note', sourceID: PEER },
  });
});

test('the one clear shortcut also covers two-way clear through its dialog', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(clearChatConversationHistory).mockResolvedValueOnce(42);
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  // Only one clear entry in the shortcut row; two-way clear is a tick box in its dialog.
  expect(screen.queryByLabelText('chat.clearHistoryBothSides')).toBeNull();

  await act(async () => fireEvent.press(screen.getByLabelText('chat.clearHistory')));
  fireEvent.press(screen.getByRole('checkbox', { name: 'chat.clearHistoryBothSides' }));
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'common.confirm' })));
  await waitFor(() => expect(requestChatHistoryClear).toHaveBeenCalledWith(CONVERSATION, 42), SETTLE);
  expect(clearChatConversationHistory).toHaveBeenCalledWith(CONVERSATION, { forEveryone: false });
  expect(alert).toHaveBeenCalledWith('chat.clearHistoryRequestSent');
  alert.mockRestore();
});

test('the clear-history shortcut opens the same unticked dialog as chat info in a direct chat', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  await act(async () => fireEvent.press(screen.getByLabelText('chat.clearHistory')));
  expect(screen.getByRole('checkbox', { name: 'chat.clearHistoryBothSides' })).not.toBeChecked();
  expect(clearChatConversationHistory).not.toHaveBeenCalled();
});

test('the clear-history shortcut lets a group member clear only their own copy', async () => {
  mockParams = { conversationID: GROUP, sourceID: GROUP, title: 'Group', conversationType: 'group', conversationKind: 'group' };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  await act(async () => fireEvent.press(screen.getByLabelText('chat.clearHistory')));

  const [title, message, buttons] = alert.mock.calls.at(-1)!;
  expect([title, message]).toEqual(['chat.clearHistory', 'chat.clearHistoryConfirm']);
  // Not the owner: no "delete for everyone" option.
  expect(buttons!.map((button) => button.text)).toEqual(['common.cancel', 'chat.clearHistory']);
  await act(async () => { buttons![1].onPress!(); });
  expect(clearChatConversationHistory).toHaveBeenCalledWith(GROUP, { forEveryone: false });
  alert.mockRestore();
});

test('the white emoji button switches from voice mode back to an editable draft', async () => {
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  await act(async () => fireEvent.press(screen.getByText('icon:mic-outline')));
  expect(screen.queryByTestId(E2E_TEST_IDS.chatInput)).toBeNull();
  expect(screen.getByText('chat.detail.voiceHoldToTalk')).toBeTruthy();

  await act(async () => fireEvent.press(screen.getByText('icon:happy-outline')));
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput)).toBeTruthy();
  expect(await screen.findByLabelText('pick-emoji', {}, SETTLE)).toBeTruthy();
});

test('touching the message area dismisses the keyboard and input panels without consuming message actions', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  render(<ChatDetailScreen />);
  await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  await act(async () => fireEvent.press(screen.getByText('icon:happy-outline')));
  expect(await screen.findByLabelText('pick-emoji', {}, SETTLE)).toBeTruthy();
  dismiss.mockClear();
  await act(async () => fireEvent(screen.getByTestId(E2E_TEST_IDS.chatMessageList), 'touchStart'));
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('pick-emoji')).toBeNull();
  dismiss.mockRestore();
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


test('long pressing a group sender avatar inserts their group name at the cursor and quoted replies keep the mention', async () => {
  mockParams = { conversationID: GROUP, sourceID: GROUP, title: 'Group', conversationType: 'group', conversationKind: 'group' };
  jest.mocked(fetchChatMembers).mockResolvedValue([{ userId: PEER, nickname: 'Peer', alias: '小方' }] as Awaited<ReturnType<typeof fetchChatMembers>>);
  useChatStore.setState({ messagesByConversation: { [GROUP]: [{ ...message(1, PEER, 'hello'), conversationId: GROUP }] } });
  render(<ChatDetailScreen />);
  const input = await screen.findByTestId(E2E_TEST_IDS.chatInput, {}, SETTLE);
  await waitFor(() => expect(fetchChatMembers).toHaveBeenCalledWith(GROUP), SETTLE);
  fireEvent.changeText(input, '前后');
  fireEvent(screen.getByTestId(E2E_TEST_IDS.chatInput), 'selectionChange', { nativeEvent: { selection: { start: 1, end: 1 } } });
  fireEvent(screen.getByTestId('avatar:msg-1'), 'longPress', { nativeEvent: { pageX: 50, pageY: 200 } });
  expect(screen.getByTestId(E2E_TEST_IDS.chatInput).props.value).toBe('前@小方 后');
  fireEvent(screen.getByText('received:hello'), 'longPress', { nativeEvent: { pageX: 50, pageY: 200 } });
  fireEvent.press(await screen.findByLabelText('message-action-quote', {}, SETTLE));
  await act(async () => fireEvent.press(screen.getByTestId(E2E_TEST_IDS.chatSend)));
  expect(sendQuoteMessage).toHaveBeenCalledWith(expect.objectContaining({
    conversationId: GROUP, text: '前@小方 后', replyToId: 'msg-1',
    mentions: [{ userId: PEER, nickname: '小方' }], atAll: false,
  }));
});

test.each(['direct', 'muted'])('avatar mentions are unavailable in a %s chat', async (kind) => {
  if (kind === 'muted') {
    mockParams = { conversationID: GROUP, sourceID: GROUP, conversationType: 'group', conversationKind: 'group' };
    useChatStore.setState({ conversations: [{ ...standaloneGroup(), muteAll: true }], messagesByConversation: { [GROUP]: [{ ...message(1, PEER, 'hello'), conversationId: GROUP }] } });
  }
  render(<ChatDetailScreen />);
  const avatar = await screen.findByTestId('avatar:msg-1', {}, SETTLE);
  expect(avatar.props.onLongPress).toBeUndefined();
});

test('scrolling back in history shows a button that returns to the latest message', async () => {
  const scroll = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
  const view = render(<ChatDetailScreen />);
  try {
    await screen.findByText('received:在吗', {}, SETTLE);
    expect(screen.queryByTestId('chat-jump-to-latest')).toBeNull();
    fireEvent.scroll(screen.getByTestId(E2E_TEST_IDS.chatMessageList), {
      nativeEvent: { contentOffset: { x: 0, y: 800 }, contentSize: { width: 390, height: 2000 }, layoutMeasurement: { width: 390, height: 600 } },
    });
    fireEvent.press(screen.getByTestId('chat-jump-to-latest'));
    expect(scroll).toHaveBeenCalledWith({ offset: 0, animated: true });
    expect(screen.queryByTestId('chat-jump-to-latest')).toBeNull();
  } finally { view.unmount(); scroll.mockRestore(); }
});
