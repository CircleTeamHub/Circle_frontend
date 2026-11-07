import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MomentsFeed } from './moments-feed';
import { useMomentsStore } from '@/features/discover/store/use-moments-store';
import { setMomentLike } from '@/services/api/moments';
import type { MomentPost } from '@/types';

const mockAuth = { user: null, isAuthenticated: false, sessionEpoch: 1 };

jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (select: (state: typeof mockAuth) => unknown) => select(mockAuth),
    { getState: () => mockAuth },
  ),
}));
jest.mock('@/storage/encrypted-init', () => ({ getEncryptedInstance: () => null }));
jest.mock('@/storage/page-snapshots', () => ({
  getPageSnapshotRevision: () => 0,
  readPageSnapshot: () => null,
  writePageSnapshot: () => {},
}));
jest.mock('expo-router', () => ({
  useFocusEffect: () => {},
  useRouter: () => ({ push: jest.fn() }),
  useSegments: () => ['(tabs)', 'discover'],
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme', () => ({ Spacing: {}, Typography: {}, useTheme: () => ({ colors: {} }) }));
jest.mock('@/services/api/moments', () => ({
  setMomentLike: jest.fn(),
  addMomentComment: jest.fn(),
  fetchNewMomentsCount: jest.fn(),
  fetchMomentsFeed: jest.fn(),
  momentsMutatedSince: () => false,
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('./moment-comment-input', () => ({ MomentCommentInput: () => null }));
jest.mock('./moment-mention-notice', () => ({ MomentMentionNotice: () => null }));
jest.mock('./moment-card', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MomentCard: ({ post, onLike }: { post: MomentPost; onLike: (id: string) => void }) => (
      <Pressable accessibilityLabel={`like-${post.id}`} onPress={() => onLike(post.id)}>
        <Text>{`${post.id}:${post.isLikedByMe ? 'liked' : 'not-liked'}:${post.likeCount}`}</Text>
      </Pressable>
    ),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function showMoment(id: string, isLikedByMe: boolean, likeCount: number) {
  useMomentsStore.setState({
    moments: [{ id, isLikedByMe, likeCount, comments: [] } as unknown as MomentPost],
    loading: false,
    hasMore: false,
    fetchError: false,
  });
  render(<MomentsFeed />);
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('rapid taps send one PUT and the card settles on the server state', async () => {
  const request = deferred<{ liked: boolean; likeCount: number }>();
  jest.mocked(setMomentLike).mockReturnValue(request.promise);
  showMoment('m1', false, 5);

  fireEvent.press(screen.getByLabelText('like-m1'));
  fireEvent.press(screen.getByLabelText('like-m1'));
  fireEvent.press(screen.getByLabelText('like-m1'));

  expect(setMomentLike).toHaveBeenCalledTimes(1);
  expect(setMomentLike).toHaveBeenCalledWith('m1', true);
  expect(screen.getByText('m1:liked:6')).toBeTruthy();

  await act(async () => request.resolve({ liked: true, likeCount: 9 }));
  expect(screen.getByText('m1:liked:9')).toBeTruthy();
});

test('a failed like rolls the card back and the next tap tries again', async () => {
  const request = deferred<{ liked: boolean; likeCount: number }>();
  jest.mocked(setMomentLike).mockReturnValueOnce(request.promise);
  showMoment('m2', true, 4);

  fireEvent.press(screen.getByLabelText('like-m2'));
  expect(screen.getByText('m2:not-liked:3')).toBeTruthy();
  await act(async () => request.reject(new Error('timeout')));
  expect(screen.getByText('m2:liked:4')).toBeTruthy();

  jest.mocked(setMomentLike).mockResolvedValueOnce({ liked: false, likeCount: 3 });
  fireEvent.press(screen.getByLabelText('like-m2'));
  await waitFor(() => expect(screen.getByText('m2:not-liked:3')).toBeTruthy());
  expect(jest.mocked(setMomentLike).mock.calls).toEqual([['m2', false], ['m2', false]]);
});
