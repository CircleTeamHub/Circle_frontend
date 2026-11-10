import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CirclePostsScreen from './CirclePostsScreen';

const mockFetchPlazaFeed = jest.fn();
jest.mock('@/services/api/plaza', () => ({
  fetchPlazaFeed: (...args: unknown[]) => mockFetchPlazaFeed(...args),
  plazaMutatedSince: () => false,
}));
jest.mock('@/services/api/client', () => {
  class ApiError extends Error {
    errorCode: string;
    constructor(code: string) {
      super(code);
      this.errorCode = code;
    }
  }
  return { ApiError };
});
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.requireActual<typeof import('react')>('react').useEffect,
  useLocalSearchParams: () => ({ id: 'circle-1', name: '徒步圈' }),
  useRouter: () => ({ push: jest.fn() }),
  // 从消息 tab 的圈子详情进来。
  useSegments: () => ['(tabs)', 'messages', 'circle', '[id]', 'posts'],
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/storage', () => ({ storage: { getString: jest.fn(), set: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
jest.mock('@/components/ui/nav-header', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});
jest.mock('@/features/discover/components/plaza-post-card', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PlazaPostCard: ({
      post,
      onDeleted,
      scope,
    }: {
      post: { id: string; content: string };
      onDeleted?: (id: string) => void;
      scope?: string;
    }) => (
      <Pressable onPress={() => onDeleted?.(post.id)}>
        <Text>{`${post.content} @${scope}`}</Text>
      </Pressable>
    ),
  };
});

const post = (id: string) => ({ id, content: `帖子 ${id}` });

beforeEach(() => mockFetchPlazaFeed.mockReset());

test('lists this circle’s posts and pages on with the cursor', async () => {
  mockFetchPlazaFeed.mockImplementation(async ({ cursor }: { cursor?: string }) =>
    cursor === 'c-2'
      ? { items: [post('p2')], hasMore: false, nextCursor: null }
      : { items: [post('p1')], hasMore: true, nextCursor: 'c-2' },
  );
  render(<CirclePostsScreen />);

  expect(await screen.findByText('帖子 p1 @messages')).toBeTruthy();
  expect(screen.getByText('徒步圈')).toBeTruthy();
  expect(mockFetchPlazaFeed).toHaveBeenLastCalledWith(
    expect.objectContaining({ circleId: 'circle-1' }),
  );

  await act(async () => {
    fireEvent(screen.getByTestId('circle-posts-list'), 'onEndReached');
  });
  expect(await screen.findByText('帖子 p2 @messages')).toBeTruthy();
  expect(mockFetchPlazaFeed).toHaveBeenLastCalledWith(
    expect.objectContaining({ circleId: 'circle-1', cursor: 'c-2' }),
  );
});

test('a deleted post leaves the list', async () => {
  mockFetchPlazaFeed.mockResolvedValue({ items: [post('p1')], hasMore: false });
  render(<CirclePostsScreen />);
  fireEvent.press(await screen.findByText('帖子 p1 @messages'));
  await waitFor(() => expect(screen.queryByText('帖子 p1 @messages')).toBeNull());
});

test('non-members of the plaza membership see the upgrade prompt', async () => {
  const { ApiError } = jest.requireMock('@/services/api/client') as {
    ApiError: new (code: string) => Error;
  };
  mockFetchPlazaFeed.mockRejectedValue(new ApiError('PLAZA_MEMBERSHIP_REQUIRED'));
  render(<CirclePostsScreen />);
  expect(await screen.findByText('升级会员查看圈子动态')).toBeTruthy();
});

// 翻页失败时列表里已经有帖子,ListEmpty 不会出现;不给提示的话 FlatList 也不会再触发
// onEndReached,翻页就此卡死。
test('a failed next page offers a retry that resumes from the same cursor', async () => {
  let failNext = true;
  mockFetchPlazaFeed.mockImplementation(async ({ cursor }: { cursor?: string }) => {
    if (cursor !== 'c-2') return { items: [post('p1')], hasMore: true, nextCursor: 'c-2' };
    if (failNext) {
      failNext = false;
      throw new Error('network');
    }
    return { items: [post('p2')], hasMore: false, nextCursor: null };
  });
  render(<CirclePostsScreen />);
  await screen.findByText('帖子 p1 @messages');

  await act(async () => {
    fireEvent(screen.getByTestId('circle-posts-list'), 'onEndReached');
  });
  fireEvent.press(await screen.findByText('帖子加载失败，点击重试'));
  expect(await screen.findByText('帖子 p2 @messages')).toBeTruthy();
  expect(mockFetchPlazaFeed).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: 'c-2' }),
  );
});
