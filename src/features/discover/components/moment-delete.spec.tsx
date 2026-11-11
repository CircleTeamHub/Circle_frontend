import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { MomentsFeed } from './moments-feed';
import { useMomentsStore } from '@/features/discover/store/use-moments-store';
import { deleteMoment } from '@/services/api/moments';
import type { MomentPost } from '@/types';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useSegments: () => ['(tabs)', 'discover'],
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('@/components/app/desktop-centered-column', () => ({ useContentColumnWidth: () => 390 }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/member-name', () => ({ MemberName: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/services/api/moments', () => ({ deleteMoment: jest.fn() }));
jest.mock('@/stores/authStore', () => {
  const auth = { user: { id: 'me' }, isAuthenticated: true, sessionEpoch: 1 };
  return { useAuthStore: Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth }) };
});
jest.mock('@/storage/encrypted-init', () => ({ getEncryptedInstance: () => undefined }));
jest.mock('@/storage/page-snapshots', () => ({ getPageSnapshotRevision: () => 1 }));
jest.mock('@/theme', () => ({
  Radius: { sm: 8 }, Spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  Typography: { body: {}, bodyRegular: {}, caption: {}, small: {} },
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('./moment-media', () => ({ MomentMedia: () => null }));
jest.mock('./moment-comment-input', () => ({ MomentCommentInput: () => null }));

const deleteRequest = jest.mocked(deleteMoment);
const mockAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

function post(id: string, authorId: string, content: string): MomentPost {
  return {
    id, content, createdAt: '2026-11-10T00:00:00Z',
    author: { id: authorId, nickname: authorId, avatarUrl: null, avatarFrameAppearance: null },
    images: [], comments: [], likedFriends: [], likeCount: 0, commentCount: 0,
    visibility: 'PUBLIC', isLikedByMe: false,
  };
}

beforeEach(() => {
  mockAlert.mockClear();
  deleteRequest.mockReset();
  useMomentsStore.getState().reset();
  useMomentsStore.setState({ moments: [post('own', 'me', 'My post'), post('other', 'friend', 'Friend post')] });
});

afterAll(() => mockAlert.mockRestore());

test('the feed only offers deletion on my post and removes it after confirmation', async () => {
  deleteRequest.mockResolvedValueOnce();
  render(<MomentsFeed />);

  fireEvent.press(screen.getByRole('button', { name: 'moment.deleteTitle' }));
  expect(deleteRequest).not.toHaveBeenCalled();
  expect(screen.getByText('My post')).toBeTruthy();

  const confirm = mockAlert.mock.calls[0][2]?.find((button) => button.style === 'destructive');
  expect(confirm).toBeDefined();
  await act(async () => { await confirm?.onPress?.(); });

  expect(deleteRequest).toHaveBeenCalledWith('own');
  expect(screen.queryByText('My post')).toBeNull();
  expect(screen.getByText('Friend post')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'moment.deleteTitle' })).toBeNull();
});

test('a failed delete keeps the post visible and shows an error', async () => {
  deleteRequest.mockRejectedValueOnce(new Error('offline'));
  render(<MomentsFeed />);

  fireEvent.press(screen.getByRole('button', { name: 'moment.deleteTitle' }));
  const confirm = mockAlert.mock.calls[0][2]?.find((button) => button.style === 'destructive');
  await act(async () => { await confirm?.onPress?.(); });

  expect(screen.getByText('My post')).toBeTruthy();
  expect(mockAlert).toHaveBeenLastCalledWith('moment.deleteFailedTitle', 'moment.deleteFailedMessage');
});
