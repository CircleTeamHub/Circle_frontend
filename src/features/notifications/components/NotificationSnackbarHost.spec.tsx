import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { NotificationSnackbarHost } from './NotificationSnackbarHost';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';
import { appSettingsDefaults, useAppSettingsStore } from '@/features/profile/store/use-app-settings-store';
import type { NotificationItem } from '@/types';

// 同一个会话的新消息替换正在显示的横幅:只换内容 —— 不重新进场、不再响一次、
// 不重新计时(否则一个活跃的群就能让横幅一直挂着,别的会话也轮不到)。

const mockNotify = jest.fn();
const mockPush = jest.fn();
let mockActiveConversationId: string | null = null;

let mockSegments: string[] = [];
jest.mock('@/storage', () => ({ mmkvJsonStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));
const mockRouter = { push: mockPush, navigate: jest.fn(), replace: jest.fn() };
let mockPathname = '/messages';
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
  usePathname: () => mockPathname,
  useGlobalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ activeConversationId: mockActiveConversationId }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/top-banner-card', () => ({
  TopBannerCard: ({ children }: { children: React.ReactNode }) => children,
  topBannerHiddenOffset: () => -120,
  topBannerSurface: {},
}));
jest.mock('@/services/api/notifications', () => ({
  markNotificationRead: jest.fn(async () => undefined),
}));
jest.mock('@/theme', () => ({
  Spacing: { sm: 8 },
  useTheme: () => ({ colors: { text: '#000', textSecondary: '#666' } }),
}));
jest.mock('@/features/notifications/hooks/use-notification-feedback', () => ({
  useNotificationFeedback: () => mockNotify,
}));
jest.mock('@/features/discover/store/use-circle-notification-store', () => ({
  circleSoundAllowed: () => true,
  useCircleNotificationStore: { getState: () => ({}) },
}));
jest.mock('@/features/notifications/store/use-notification-center-store', () => ({
  useNotificationCenterStore: { getState: () => ({ markInteractiveReadLocal: jest.fn() }) },
}));
jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: { getState: () => ({}) },
}));
jest.mock('@/utils/client-diagnostics', () => ({ logClientDiagnostic: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

function chat(id: string, summary: string, conversationID = 'group-a') {
  return {
    id,
    title: conversationID,
    summary,
    avatarUrl: null,
    conversationID,
    sourceID: conversationID,
    conversationType: 'group' as const,
  };
}

function signup(id: string, postId: string): NotificationItem {
  return {
    id,
    type: 'CIRCLE_POST_SIGNUP_CREATED',
    content: '报名了你的活动',
    read: true,
    createdAt: '2026-11-10T00:00:00Z',
    fromUser: { id: 'signer', nickname: '小王', avatarUrl: null },
    fromTrace: null,
    fromReply: null,
    fromCircle: null,
    fromCirclePost: { id: postId, excerpt: '周末徒步', firstImage: null },
    fromInvitation: null,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockNotify.mockClear();
  Object.values(mockRouter).forEach((fn) => fn.mockClear());
  mockPathname = '/messages';
  mockParams = {};
  mockActiveConversationId = null;
  mockSegments = [];
  useNotificationSnackbarStore.getState().reset();
  useAppSettingsStore.setState({ settings: { ...appSettingsDefaults } });
});

afterEach(() => {
  jest.useRealTimers();
});

it('changing group reminder preferences clears current and queued group banners', () => {
  render(<NotificationSnackbarHost />);
  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('a1', 'First'));
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('b1', 'Second', 'group-b'));
  });
  expect(screen.getByText('First')).toBeTruthy();
  act(() => useAppSettingsStore.getState().setSetting('groupOnlinePush', false));
  expect(useNotificationSnackbarStore.getState().queue).toHaveLength(0);
  act(() => jest.advanceTimersByTime(500));
  expect(screen.queryByText('First')).toBeNull();
});

it('a newer message from the same conversation only updates the banner on screen', () => {
  render(<NotificationSnackbarHost />);

  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('a1', '第一条'));
  });
  expect(screen.getByText('第一条')).toBeTruthy();
  expect(mockNotify).toHaveBeenCalledTimes(1);

  act(() => {
    jest.advanceTimersByTime(3_000);
  });
  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('a2', '第二条'));
  });
  expect(screen.getByText('第二条')).toBeTruthy();
  expect(mockNotify).toHaveBeenCalledTimes(1);

  // 按第一条出现的时刻收起,不因为换了内容重新计时。
  act(() => {
    jest.advanceTimersByTime(1_000);
  });
  expect(useNotificationSnackbarStore.getState().current).toBeNull();
});

it('a replacement that lands while the previous banner is leaving still enters once', () => {
  render(<NotificationSnackbarHost />);

  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('a1', 'A 的消息'));
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('b1', 'B 第一条', 'group-b'));
  });
  // A 到点收起,开始退场;退场途中 B 来了新消息,替换掉排在队头的 B 横幅。
  act(() => {
    jest.advanceTimersByTime(4_000);
  });
  act(() => {
    jest.advanceTimersByTime(50);
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('b2', 'B 第二条', 'group-b'));
  });
  act(() => {
    jest.advanceTimersByTime(400);
  });

  expect(screen.getByText('B 第二条')).toBeTruthy();
  expect(mockNotify).toHaveBeenCalledTimes(2);

  act(() => {
    jest.advanceTimersByTime(4_000);
  });
  expect(useNotificationSnackbarStore.getState().current).toBeNull();
});

// 点横幅进会话、再返回:横幅退场途中它的会话成了当前会话,宿主不再渲染这条横幅。真机上
// 退场是原生驱动的动画,视图一卸下动画就被打断,完成回调拿不到 finished —— 原来就停在
// 「等退场播完再换下一条」,返回列表后这条旧横幅以半截位置重新冒出来、再也不收(实机截图)。
it('a banner whose conversation is opened mid-exit does not come back after leaving it', () => {
  const timing = jest
    .spyOn(Animated, 'timing')
    // 模拟原生驱动:动画被打断后完成回调不会以「播完」到达。
    .mockImplementation(() => ({ start: () => undefined, stop: () => undefined, reset: () => undefined }));
  try {
    const view = render(<NotificationSnackbarHost />);
    act(() => {
      useNotificationSnackbarStore.getState().enqueueChatMessage(chat('a1', 'A 的图片', 'conv-a'));
    });
    expect(screen.getByText('A 的图片')).toBeTruthy();

    // 点横幅:先出队、开始退场,再跳进 A 的会话。
    act(() => {
      useNotificationSnackbarStore.getState().dismissCurrent();
    });
    mockActiveConversationId = 'conv-a';
    view.rerender(<NotificationSnackbarHost />);
    expect(screen.queryByText('A 的图片')).toBeNull();

    // 返回消息列表:旧横幅不能再出现。
    mockActiveConversationId = null;
    view.rerender(<NotificationSnackbarHost />);
    expect(screen.queryByText('A 的图片')).toBeNull();
  } finally {
    timing.mockRestore();
  }
});

// 人已经在消息列表,半屏要留住的「手上的页面」不存在,直接进完整聊天。
it('on the conversation list a chat banner opens the full chat, not the half sheet', () => {
  mockSegments = ['(tabs)', 'messages'];
  render(<NotificationSnackbarHost />);
  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('m1', '在吗'));
  });
  fireEvent.press(screen.getByLabelText('group-a. 在吗'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(tabs)/messages/chat-detail',
    params: expect.objectContaining({ conversationID: 'group-a', sourceID: 'group-a', searchedMsgID: 'm1' }),
  });
});

// 设置里关掉半窗后,哪个页面点横幅都直接进完整聊天。
it.each([
  ['another page', ['(tabs)', 'notes']],
  ['another conversation', ['(tabs)', 'messages', 'chat-detail']],
])('with the half sheet turned off, a chat banner on %s opens the full chat', (_name, segments) => {
  mockSegments = segments;
  useAppSettingsStore.setState({ settings: { ...appSettingsDefaults, quickChatSheet: false } });
  render(<NotificationSnackbarHost />);
  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('m1', '在吗'));
  });
  fireEvent.press(screen.getByLabelText('group-a. 在吗'));
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/(tabs)/messages/chat-detail' }));
});

// 正在和别人聊时同样在消息 tab 里,但手上的对话不能被顶掉。
it('inside another conversation a chat banner still opens the half sheet', () => {
  mockSegments = ['(tabs)', 'messages', 'chat-detail'];
  render(<NotificationSnackbarHost />);
  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('m1', '在吗'));
  });
  fireEvent.press(screen.getByLabelText('group-a. 在吗'));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/quick-chat' }));
});

it('tapping a chat banner opens the half-screen quick chat on top of the current page', () => {
  mockSegments = ['(tabs)', 'notes'];
  render(<NotificationSnackbarHost />);
  act(() => {
    useNotificationSnackbarStore.getState().enqueueChatMessage(chat('m1', '在吗'));
  });
  fireEvent.press(screen.getByLabelText('group-a. 在吗'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/quick-chat',
    params: expect.objectContaining({ conversationID: 'group-a', sourceID: 'group-a', searchedMsgID: 'm1' }),
  });
});

// 报名列表开着时又来一条同一帖子的报名横幅:点进去不能再压一层报名列表,
// 否则返回时还是这一页(实机反馈)。换成别的帖子仍然正常进新的一页。
it.each([
  ['the post already open', 'post-1', 'replace', 'push'],
  ['another post', 'post-2', 'push', 'replace'],
] as const)('a signup banner for %s does not stack a duplicate page', (_label, postId, used, unused) => {
  mockSegments = ['(tabs)', 'messages', 'post-signups'];
  mockPathname = '/messages/post-signups';
  mockParams = { postId: 'post-1', title: '周末徒步' };
  render(<NotificationSnackbarHost />);
  act(() => {
    useNotificationSnackbarStore.getState().enqueueNotification(signup('n1', postId));
  });

  fireEvent.press(screen.getByRole('button'));

  expect(mockRouter[used]).toHaveBeenCalledWith({
    pathname: '/(tabs)/messages/post-signups',
    params: { postId, title: '周末徒步' },
  });
  expect(mockRouter[unused]).not.toHaveBeenCalled();
});
