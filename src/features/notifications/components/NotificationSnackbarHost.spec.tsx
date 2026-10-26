import { act, render, screen } from '@testing-library/react-native';
import { NotificationSnackbarHost } from './NotificationSnackbarHost';
import { useNotificationSnackbarStore } from '@/features/notifications/store/use-notification-snackbar-store';

// 同一个会话的新消息替换正在显示的横幅:只换内容 —— 不重新进场、不再响一次、
// 不重新计时(否则一个活跃的群就能让横幅一直挂着,别的会话也轮不到)。

const mockNotify = jest.fn();

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
    selector({ activeConversationId: null }),
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
