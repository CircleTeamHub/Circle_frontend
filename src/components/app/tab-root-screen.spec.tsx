import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTabBarBridgeStore } from '@/stores/tabBarBridgeStore';
import { TabRootScreen } from './tab-root-screen';

const mockBarRenders: { index: number; active: boolean | undefined }[] = [];
jest.mock('@/components/app/floating-tab-bar', () => ({
  FloatingTabBar: ({ tabProps, active }: { tabProps: BottomTabBarProps; active?: boolean }) => {
    mockBarRenders.push({ index: tabProps.state.index, active });
    return null;
  },
}));

// 本页所在的 tab：选中与否随导航状态变，并发 focus / blur。
let mockTabFocused = true;
const mockTabListeners = new Set<() => void>();
const mockTabScreen = {
  isFocused: () => mockTabFocused,
  addListener: (_type: 'focus' | 'blur', listener: () => void) => {
    mockTabListeners.add(listener);
    return () => mockTabListeners.delete(listener);
  },
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: () => mockTabScreen }),
}));

const OWNER = Symbol('bridge');
const MESSAGES = 0;
const EXPLORE = 3;

function publish(index: number, badgeVersion = 0) {
  act(() => {
    useTabBarBridgeStore.getState().publish(OWNER, {
      state: { index, routes: [], key: `tabs-${badgeVersion}` },
    } as unknown as BottomTabBarProps);
  });
}

function setTabFocused(focused: boolean) {
  mockTabFocused = focused;
  act(() => mockTabListeners.forEach((listener) => listener()));
}

beforeEach(() => {
  mockBarRenders.length = 0;
  mockTabFocused = true;
  mockTabListeners.clear();
  useTabBarBridgeStore.setState({ tabProps: null, owner: null });
});

// 导航器不冻结看不见的页面：各 tab 首页的 bar 都挂着，未读数一变 bridge 就重新发布。
test('a tab bar out of sight skips re-renders, and its first frame back is already current', () => {
  render(<TabRootScreen><Text>messages</Text></TabRootScreen>);
  publish(MESSAGES);
  expect(mockBarRenders.at(-1)).toEqual({ index: MESSAGES, active: true });

  // 切到探索：本份 bar 在同一次发布里画成「探索选中、不活跃」，之后的发布都跳过。
  mockTabFocused = false;
  publish(EXPLORE);
  expect(mockBarRenders.at(-1)).toEqual({ index: EXPLORE, active: false });
  const rendersWhileAway = mockBarRenders.length;
  publish(EXPLORE, 1);
  publish(EXPLORE, 2);
  expect(mockBarRenders).toHaveLength(rendersWhileAway);

  // 切回来：发布的那次同步更新里就是「消息选中、活跃」，不等 focus 事件。
  mockTabFocused = true;
  publish(MESSAGES, 3);
  expect(mockBarRenders.at(-1)).toEqual({ index: MESSAGES, active: true });
});

test('coming back from a page over all tabs reactivates the bar without a new publish', () => {
  render(<TabRootScreen><Text>messages</Text></TabRootScreen>);
  publish(MESSAGES);
  setTabFocused(false);
  expect(mockBarRenders.at(-1)).toEqual({ index: MESSAGES, active: false });

  setTabFocused(true);
  expect(mockBarRenders.at(-1)).toEqual({ index: MESSAGES, active: true });
});
