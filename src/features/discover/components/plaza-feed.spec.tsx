import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { FlatList, RefreshControl } from 'react-native';
import { PlazaFeed } from './plaza-feed';

interface MockDiscoverState {
  plazaPosts: { id: string }[];
  plazaLoading: boolean;
  plazaRefreshing: boolean;
  plazaMembershipRequired: boolean;
  plazaHasMore: boolean;
  plazaLoaded: boolean;
  selectedCircleId: string | null;
  selectedCity: string | null;
  fetchPlazaPosts: jest.Mock;
  setPlazaFilter: jest.Mock;
  hydrate: jest.Mock;
}

let mockDiscover: MockDiscoverState;
const mockListeners = new Set<() => void>();
function setDiscover(patch: Partial<MockDiscoverState>) {
  mockDiscover = { ...mockDiscover, ...patch };
  mockListeners.forEach((listener) => listener());
}

jest.mock('@/features/discover/store/use-discover-store', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const useDiscoverStore = (selector: (state: MockDiscoverState) => unknown) =>
    selector(
      useSyncExternalStore(
        (listener: () => void) => {
          mockListeners.add(listener);
          return () => mockListeners.delete(listener);
        },
        () => mockDiscover,
      ),
    );
  useDiscoverStore.getState = () => mockDiscover;
  return { useDiscoverStore };
});
jest.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }));
jest.mock('@/features/discover/store/use-circles-store', () => {
  const state = {
    joinedCircles: [{ id: 'c1', name: '奢侈品交流' }],
    createdCircles: [],
    myCirclesError: null,
    fetchMyCircles: jest.fn(),
  };
  return {
    useCirclesStore: (selector: (s: typeof state) => unknown) => selector(state),
    useHydrateCirclesSnapshot: () => undefined,
  };
});
jest.mock('@/features/discover/store/use-discover-filter-store', () => {
  const state = { appliedCircleIds: [], appliedCities: [] };
  return { useDiscoverFilterStore: (selector: (s: typeof state) => unknown) => selector(state) };
});
jest.mock('@/features/discover/store/use-circle-shortcut-order-store', () => {
  const state = { orderIds: [], setOrderIds: jest.fn(), resetOrder: jest.fn() };
  return { useCircleShortcutOrderStore: (selector: (s: typeof state) => unknown) => selector(state) };
});
jest.mock('@/stores/authStore', () => {
  const state = { sessionEpoch: 1, user: { id: 'me', vipLevel: 1 } };
  return { useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) };
});
jest.mock('@/services/api/membership', () => ({
  fetchMembershipProgramStatus: () => Promise.resolve({ enabled: false }),
}));
jest.mock('@/hooks/use-focus-reload-gate', () => ({
  useFocusReloadGate: () => ({ shouldSkip: () => false, markLoaded: () => undefined }),
}));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]),
  };
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock('@/features/discover/components/plaza-post-card', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { PlazaPostCard: ({ post }: { post: { id: string } }) => <Text>{`post ${post.id}`}</Text> };
});
jest.mock('@/features/discover/components/circle-filter-bar', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { CircleFilterBar: () => <View testID="circle-filter-bar" /> };
});
jest.mock('@/features/discover/components/circle-shortcut-order-sheet', () => ({
  CircleShortcutOrderSheet: () => null,
}));

beforeEach(() => {
  mockListeners.clear();
  mockDiscover = {
    plazaPosts: [{ id: 'p1' }],
    plazaLoading: false,
    plazaRefreshing: false,
    plazaMembershipRequired: false,
    plazaHasMore: false,
    plazaLoaded: true,
    selectedCircleId: null,
    selectedCity: null,
    fetchPlazaPosts: jest.fn(),
    setPlazaFilter: jest.fn(),
    hydrate: jest.fn(),
  };
});

async function renderFeed() {
  render(<PlazaFeed />);
  // 让会员计划查询落地,列表才可交互。
  await act(async () => {
    await Promise.resolve();
  });
}

const refreshControl = () => screen.UNSAFE_getByType(RefreshControl);

// 切圈子时后台刷新不能借用下拉刷新控件:它一转,iOS 会把整个列表(连同顶部的圈子 tag)往下推。
test('switching circles refreshes in the background without the pull-to-refresh spinner', async () => {
  await renderFeed();
  act(() => setDiscover({ selectedCircleId: 'c1', plazaRefreshing: true }));
  expect(refreshControl().props.refreshing).toBe(false);
});

test('a real pull shows the spinner until that refresh finishes', async () => {
  await renderFeed();
  act(() => {
    refreshControl().props.onRefresh();
    setDiscover({ plazaRefreshing: true });
  });
  expect(mockDiscover.fetchPlazaPosts).toHaveBeenCalledWith(true);
  expect(refreshControl().props.refreshing).toBe(true);
  act(() => setDiscover({ plazaRefreshing: false }));
  expect(refreshControl().props.refreshing).toBe(false);
});

// 圈子 tag 固定在列表上方:不随下拉、刷新或滚动移动。
test('the circle tags sit above the list, not inside it', async () => {
  await renderFeed();
  expect(screen.UNSAFE_getByType(FlatList).props.ListHeaderComponent).toBeFalsy();
  expect(screen.getByTestId('circle-filter-bar')).toBeTruthy();
});

test('a circle with nothing cached yet shows a spinner in the content area', async () => {
  await renderFeed();
  act(() => setDiscover({ selectedCircleId: 'c1', plazaPosts: [], plazaLoading: true, plazaLoaded: false }));
  expect(screen.getByTestId('plaza-content-loading')).toBeTruthy();
});
