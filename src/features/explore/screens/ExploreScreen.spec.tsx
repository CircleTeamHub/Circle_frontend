import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ExploreScreen from './ExploreScreen';
import { E2E_TEST_IDS } from '@/testing/e2e-test-ids';

const mockRouter = { push: jest.fn() };
let mockMomentsUnread = 0;

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

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
    mockMomentsUnread = 0;
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

  it('opens moments and the assistant inside the explore stack', () => {
    render(<ExploreScreen />);

    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreMomentsEntry));
    fireEvent.press(screen.getByTestId(E2E_TEST_IDS.exploreAssistantEntry));

    expect(mockRouter.push.mock.calls).toEqual([
      ['/(tabs)/explore/moments'],
      ['/(tabs)/explore/assistant'],
    ]);
  });

  it('badges the moments tile with the moments bell unread count', () => {
    mockMomentsUnread = 3;
    render(<ExploreScreen />);

    const moments = screen.getByTestId(E2E_TEST_IDS.exploreMomentsEntry);
    expect(moments).toHaveTextContent(/3/);
    expect(moments.props.accessibilityLabel).toBe('discover.moments unread:3');
  });
});
