import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { FloatingTabBar, TAB_KEYS } from './floating-tab-bar';
import { useCircleNotificationStore } from '@/features/discover/store/use-circle-notification-store';
import { useSplitPaneStore } from '@/stores/splitPaneStore';
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
let mockVipLevel = 1;
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { vipLevel: number } }) => unknown) =>
    selector({ user: { vipLevel: mockVipLevel } }),
}));
let mockProgramStatus: { enabled: boolean } | null = null;
const mockFetchProgramStatus = jest.fn();
jest.mock('@/stores/membershipProgramStore', () => ({
  useMembershipProgramStore: (
    selector: (state: { status: { enabled: boolean } | null; fetchStatus: () => void }) => unknown,
  ) => selector({ status: mockProgramStatus, fetchStatus: mockFetchProgramStatus }),
}));
let mockSplitLayout = false;
jest.mock('@/hooks/use-desktop-split-layout', () => ({
  ...jest.requireActual('@/hooks/use-desktop-split-layout'),
  useDesktopSplitLayout: () => mockSplitLayout,
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

function tabProps(index = 0): BottomTabBarProps {
  const routes = TAB_KEYS.map((tab) => ({ key: `${tab.name}-key`, name: tab.name }));
  return {
    state: { index, key: 'tabs', routes },
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
  mockSplitLayout = false;
  mockVipLevel = 1;
  mockProgramStatus = null;
  mockFetchProgramStatus.mockClear();
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

it('lights a dot on the explore tab when friends posted new moments', () => {
  renderBar();
  const exploreDot = () =>
    screen.queryAllByTestId(/-update-dot$/).filter((node) => node.props.testID !== DOT);
  expect(exploreDot()).toHaveLength(0);

  act(() => useTabBadgeStore.getState().setMomentsHasUpdate(true));
  expect(exploreDot()).toHaveLength(1);

  act(() => useTabBadgeStore.getState().setMomentsHasUpdate(false));
  expect(exploreDot()).toHaveLength(0);
});

it('stays dark for someone the feed has told to upgrade', () => {
  mockMembershipRequired = true;
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  renderBar();
  expect(screen.queryByTestId(DOT)).toBeNull();
});

describe('level-0 members, whom the feed would send to the upgrade wall', () => {
  beforeEach(() => {
    mockVipLevel = 0;
    useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  });

  it('stays dark once the program is on, before the feed has ever answered', () => {
    mockProgramStatus = { enabled: true };
    renderBar();
    expect(screen.queryByTestId(DOT)).toBeNull();
  });

  it('stays dark and looks the program up while its status is unknown', () => {
    renderBar();
    expect(screen.queryByTestId(DOT)).toBeNull();
    expect(mockFetchProgramStatus).toHaveBeenCalledTimes(1);
  });

  it('lights up while the program is off, because the feed is open to them', () => {
    mockProgramStatus = { enabled: false };
    renderBar();
    expect(screen.getByTestId(DOT)).toBeTruthy();
  });
});

it('never looks the program up for a paying member', () => {
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  renderBar();
  expect(screen.getByTestId(DOT)).toBeTruthy();
  expect(mockFetchProgramStatus).not.toHaveBeenCalled();
});

it('honours the circle notification master switch', () => {
  useCircleNotificationStore.setState({ globalEnabled: false });
  useTabBadgeStore.getState().setCirclePlazaHasUpdate(true);
  renderBar();
  expect(screen.queryByTestId(DOT)).toBeNull();
});

// 原生端各 tab 首页各挂一份 bar：本 tab 没被选中的那几份不跟着未读数重渲染，选中时按最新值补上。
it('an inactive bar ignores badge changes until it is active again', () => {
  const view = render(<FloatingTabBar tabProps={tabProps()} hidden={false} active={false} />);
  act(() => useTabBadgeStore.getState().setCircleUnread(3));
  expect(screen.queryByText('3')).toBeNull();

  view.rerender(<FloatingTabBar tabProps={tabProps()} hidden={false} active />);
  expect(screen.getByText('3')).toBeTruthy();
});

// 桌面分栏下右栏不再给浮动条留底（MessagesScreen splitDetailPane）：消息页的 bar 必须
// 只落在左侧会话列表栏里，否则会盖住内嵌聊天的输入框。
describe('where the web bar docks', () => {
  const originalOS = Platform.OS;
  const contactsIndex = TAB_KEYS.findIndex((tab) => tab.name === 'contacts');
  const wrapperStyle = () => {
    const tree = screen.toJSON();
    if (!tree || Array.isArray(tree)) throw new Error('expected a single tab bar wrapper');
    return StyleSheet.flatten(tree.props.style);
  };

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
    mockSplitLayout = true;
    useSplitPaneStore.getState().setListPaneWidth(300);
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    useSplitPaneStore.getState().resetListPaneWidth();
  });

  it('pins the messages bar to the conversation list pane and follows its width', () => {
    render(<FloatingTabBar tabProps={tabProps(0)} hidden={false} />);
    expect(wrapperStyle()).toMatchObject({ maxWidth: 300, marginHorizontal: 0 });
    act(() => useSplitPaneStore.getState().setListPaneWidth(420));
    expect(wrapperStyle()).toMatchObject({ maxWidth: 420, marginHorizontal: 0 });
  });

  it('centers the bar on the other tabs', () => {
    render(<FloatingTabBar tabProps={tabProps(contactsIndex)} hidden={false} />);
    expect(wrapperStyle()).toMatchObject({ maxWidth: 460, marginHorizontal: 'auto' });
  });

  it('centers the messages bar too when the window is too narrow to split', () => {
    mockSplitLayout = false;
    render(<FloatingTabBar tabProps={tabProps(0)} hidden={false} />);
    expect(wrapperStyle()).toMatchObject({ maxWidth: 460, marginHorizontal: 'auto' });
  });

  it('leaves the native bar full width', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
    render(<FloatingTabBar tabProps={tabProps(0)} hidden={false} />);
    expect(wrapperStyle().maxWidth).toBeUndefined();
    expect(wrapperStyle().marginHorizontal).toBeUndefined();
  });
});
