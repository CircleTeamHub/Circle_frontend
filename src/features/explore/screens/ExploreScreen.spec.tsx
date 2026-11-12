import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ExploreScreen from './ExploreScreen';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';
import { fetchAssistantBootstrap } from '@/services/api/assistant';

const mockRouter = { push: jest.fn() };
let mockMomentsUnread = 0;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  // Focus effects run once on mount (the assistant prefetch). The screen never regains
  // focus afterwards, so a navigation lock taken in a test stays held.
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => effect(), [effect]);
  },
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { sessionEpoch: number }) => number) => selector({ sessionEpoch: 1 }),
}));

const mockMergeConversationSnapshot = jest.fn();
jest.mock('@/chat-core/store', () => ({
  useChatStore: { getState: () => ({ mergeConversationSnapshot: mockMergeConversationSnapshot }) },
}));
jest.mock('@/services/api/assistant', () => ({ fetchAssistantBootstrap: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const bootstrap = (subscribed: boolean) => ({
  capabilities: { infoSubscriptions: true },
  subscriptions: subscribed
    ? [{ enabled: true, sourceTypes: ['PLAZA_POST'], circleId: 'c1' }]
    : [],
  conversation: { id: 'support-1' },
  assistant: { key: 'circle-assistant', displayName: 'AI小助手' },
  contextCircle: null,
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'tabs.unreadCount' ? `unread:${options?.count ?? 0}` : key,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// 真实 token 与浅色色板，只替换掉会牵出原生存储的 ThemeProvider。
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({
    colors: jest.requireActual('@/theme/colors').lightColors,
    resolvedMode: 'light',
  }),
}));

jest.mock('@/stores/tabBadgeStore', () => ({
  useTabBadgeStore: (selector: (state: { momentsUnread: number }) => number) =>
    selector({ momentsUnread: mockMomentsUnread }),
}));

describe('ExploreScreen', () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockMergeConversationSnapshot.mockClear();
    // Tests that do not care about the assistant leave the mount prefetch pending.
    jest.mocked(fetchAssistantBootstrap).mockReset().mockReturnValue(new Promise(() => {}));
    mockMomentsUnread = 0;
  });

  it('asks where the assistant leads as soon as the page shows, then opens it on tap without waiting', async () => {
    jest.mocked(fetchAssistantBootstrap).mockResolvedValueOnce(bootstrap(true) as never);
    render(<ExploreScreen />);
    expect(fetchAssistantBootstrap).toHaveBeenCalledTimes(1);
    await act(async () => {});

    // No await between the tap and the push: the answer is already in hand.
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry));
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/(tabs)/explore/chat-detail' }),
    );
    expect(fetchAssistantBootstrap).toHaveBeenCalledTimes(1);
  });

  it('falls back to the subscription wizard when the prefetch failed', async () => {
    jest.mocked(fetchAssistantBootstrap).mockRejectedValueOnce(new Error('offline'));
    render(<ExploreScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry));
    });
    expect(mockRouter.push.mock.calls).toEqual([['/(tabs)/explore/assistant']]);
  });

  it('shows the moments tile before the assistant tile, names only', () => {
    render(<ExploreScreen />);

    const moments = screen.getByTestId(E2E_TEST_IDS.exploreMomentsEntry);
    const assistant = screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry);
    expect(moments).toHaveTextContent('discover.moments');
    expect(assistant).toHaveTextContent('assistant.name');
    const tiles = screen.getAllByRole('button');
    expect(tiles.indexOf(moments)).toBeLessThan(tiles.indexOf(assistant));
  });

  it('opens moments inside the explore stack', () => {
    render(<ExploreScreen />);
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreMomentsEntry));
    expect(mockRouter.push.mock.calls).toEqual([['/(tabs)/explore/moments']]);
  });

  it('goes straight to the assistant chat in one hop when a subscription exists', async () => {
    jest.mocked(fetchAssistantBootstrap).mockResolvedValueOnce(bootstrap(true) as never);
    render(<ExploreScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry));
    });
    // One push to the chat itself: no wizard page that then replaces itself.
    expect(mockRouter.push.mock.calls).toEqual([[{
      pathname: '/(tabs)/explore/chat-detail',
      params: {
        sourceID: 'support-1',
        conversationType: 'private',
        title: 'AI小助手',
        conversationID: 'support-1',
        conversationKind: 'support',
        assistantKey: 'circle-assistant',
      },
    }]]);
    expect(mockMergeConversationSnapshot).toHaveBeenCalledWith({ id: 'support-1' });
  });

  it('opens the subscription wizard when there is nothing to chat about yet', async () => {
    jest.mocked(fetchAssistantBootstrap).mockResolvedValueOnce(bootstrap(false) as never);
    render(<ExploreScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry));
    });
    expect(mockRouter.push.mock.calls).toEqual([['/(tabs)/explore/assistant']]);
  });

  it('a double tap on the assistant tile opens it once', async () => {
    jest.mocked(fetchAssistantBootstrap).mockResolvedValue(bootstrap(true) as never);
    render(<ExploreScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry));
      fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry));
    });
    expect(fetchAssistantBootstrap).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('badges the moments tile with the moments bell unread count', () => {
    mockMomentsUnread = 3;
    render(<ExploreScreen />);

    const moments = screen.getByTestId(E2E_TEST_IDS.exploreMomentsEntry);
    expect(moments).toHaveTextContent(/3/);
    expect(moments.props.accessibilityLabel).toBe('discover.moments unread:3');
  });
});
