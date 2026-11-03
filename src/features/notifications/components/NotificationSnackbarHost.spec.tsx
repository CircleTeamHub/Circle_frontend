import { act, render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { NotificationSnackbarHost } from './NotificationSnackbarHost';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';

// 同一个会话的新消息替换正在显示的横幅:只换内容 —— 不重新进场、不再响一次、
// 不重新计时(否则一个活跃的群就能让横幅一直挂着,别的会话也轮不到)。

const mockNotify = jest.fn();
let mockActiveConversationId: string | null = null;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useSegments: () => [],
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

beforeEach(() => {
  jest.useFakeTimers();
  mockNotify.mockClear();
  mockActiveConversationId = null;
  useNotificationSnackbarStore.getState().reset();
});

afterEach(() => {
  jest.useRealTimers();
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
