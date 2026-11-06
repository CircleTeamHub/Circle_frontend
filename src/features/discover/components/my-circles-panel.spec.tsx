import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MyCirclesPanel } from './my-circles-panel';

const circle = (id: string, name: string) => ({ id, name, avatarUrl: null });

let mockCircles: Record<string, unknown>;
jest.mock('@/features/discover/store/use-circles-store', () => ({
  useCirclesStore: (selector: (state: unknown) => unknown) => selector(mockCircles),
  // 快照回灌由 store 自己负责;这里直接给 mockCircles。
  useHydrateCirclesSnapshot: () => {},
}));
jest.mock('@/features/discover/store/use-discover-filter-store', () => ({
  useDiscoverFilterStore: (selector: (state: unknown) => unknown) =>
    selector({ appliedCircleIds: [], appliedCities: [], clearAppliedFilter: jest.fn() }),
}));
jest.mock('@/storage', () => ({
  storage: { getString: jest.fn(), set: jest.fn() },
}));
jest.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: jest.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  // 每次聚焦都后台刷新「我的圈子」。
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(callback, [callback]);
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/circle-avatar', () => ({ CircleAvatar: () => null }));

beforeEach(() => {
  // 已创建的圈子同时也在「已加入」里,「管理圈子」是前两者的子集。
  const owned = circle('c-owned', '自己建的圈');
  mockCircles = {
    joinedCircles: [circle('c-joined', '加入的圈'), owned],
    createdCircles: [owned],
    managedCircles: [owned],
    appliedCircles: [circle('c-applied', '申请中的圈')],
    myCirclesLoading: false,
    myCirclesError: null,
    fetchMyCircles: jest.fn(),
  };
});

test('tabs read 全部 / 已加入 / 已创建 / 管理圈子 / 我的申请, opening on 全部', () => {
  render(<MyCirclesPanel />);
  const labels = [
    'common.all',
    'discover.joined',
    'discover.myCreated',
    'discover.myManaged',
    'discover.myApplied',
  ];
  for (const label of labels) expect(screen.getByText(label)).toBeTruthy();

  // 「全部」是三个来源的并集,同一个圈子只出现一次。
  expect(screen.getAllByText('加入的圈')).toHaveLength(1);
  expect(screen.getAllByText('自己建的圈')).toHaveLength(1);
  expect(screen.getAllByText('申请中的圈')).toHaveLength(1);
});

test('the other tabs still show only their own circles', () => {
  render(<MyCirclesPanel />);
  fireEvent.press(screen.getByText('discover.myApplied'));
  expect(screen.getByText('申请中的圈')).toBeTruthy();
  expect(screen.queryByText('加入的圈')).toBeNull();
});

// 超过 30 秒再进,store 后台刷新时 myCirclesLoading=true;已有列表不能被转圈整块盖掉。
test('a background refresh keeps the cached list on screen', () => {
  mockCircles = { ...mockCircles, myCirclesLoading: true };
  render(<MyCirclesPanel />);
  expect(screen.getByText('加入的圈')).toBeTruthy();
});
