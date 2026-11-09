import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { FloatingTabBar, TAB_KEYS } from './floating-tab-bar';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const identity = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View },
    Easing: { bezier: () => identity, out: identity, inOut: identity, cubic: identity },
    ReduceMotion: { System: 'system' },
    useAnimatedStyle: (factory: () => object) => factory(),
    useSharedValue: (value: number) => ({ value }),
    withSpring: identity,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withTiming: identity,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
let mockMembershipRequired = false;
jest.mock('@/features/discover/store/use-discover-store', () => ({
  useDiscoverStore: (selector: (state: { plazaMembershipRequired: boolean }) => unknown) =>
    selector({ plazaMembershipRequired: mockMembershipRequired }),
}));
jest.mock('@/hooks/use-desktop-split-layout', () => ({
  useDesktopSplitLayout: () => false,
}));
jest.mock('@/storage', () => ({
  mmkvJsonStorage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
}));
jest.mock('expo-glass-effect', () => ({
  GlassView: 'GlassView',
  isGlassEffectAPIAvailable: () => false,
  isLiquidGlassAvailable: () => false,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const DOT = 'circle-plaza-update-dot';

function tabProps(): BottomTabBarProps {
  const routes = TAB_KEYS.map((tab) => ({ key: `${tab.name}-key`, name: tab.name }));
  return {
    state: { index: 0, key: 'tabs', routes },
    descriptors: Object.fromEntries(routes.map((route) => [route.key, { options: {} }])),
    navigation: { emit: jest.fn(() => ({ defaultPrevented: false })), dispatch: jest.fn() },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
}

function renderBar() {
  return render(<FloatingTabBar tabProps={tabProps()} hidden={false} />);
}

beforeEach(() => {
  mockMembershipRequired = false;
  useTabBadgeStore.getState().reset();
  useCircleNotificationStore.setState({ globalEnabled: true });
});

it('shows no dot until there is an update', () => {
  renderBar();
  expect(screen.queryByTestId(DOT)).toBeNull();
});

it('lights the plane dot when the circle post list has an update', () => {
  renderBar();
  act(() => useTabBadgeStore.getState().setCirclePlazaHasUpdate(true));
  expect(screen.getByTestId(DOT)).toBeTruthy();
});

it('drops the dot once the update is consumed', () => {
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  renderBar();
  act(() => useTabBadgeStore.getState().setCirclePlazaHasUpdate(false));
  expect(screen.queryByTestId(DOT)).toBeNull();
});

it('lets a numeric badge take the spot instead of stacking both', () => {
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  useTabBadgeStore.getState().setCircleUnread(2);
  renderBar();
  expect(screen.queryByTestId(DOT)).toBeNull();
  expect(screen.getByText('2')).toBeTruthy();
});

it('stays dark for someone the feed has told to upgrade', () => {
  mockMembershipRequired = true;
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  renderBar();
  expect(screen.queryByTestId(DOT)).toBeNull();
});

it('honours the circle notification master switch', () => {
  useCircleNotificationStore.setState({ globalEnabled: false });
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  renderBar();
  expect(screen.queryByTestId(DOT)).toBeNull();
});
