import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import UserMomentsScreen from './UserMomentsScreen';
import { fetchUserProfile } from '@/services/api/profile';
import { evictUserProfileCache, writeUserProfileCache } from '@/features/user/profile-cache';
import { ApiError } from '@/services/api/client';
const mockAuth = { sessionEpoch: 42, user: { id: 'owner', cover: 'own-cover', avatarUrl: 'own-avatar', nickname: 'Owner' } };
let mockId = 'friend';
const mockT = (key: string) => key;
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { createAnimatedComponent: (component: unknown) => component }, useSharedValue: (value: number) => ({ value }), useAnimatedScrollHandler: () => jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (s: typeof mockAuth) => unknown) => select(mockAuth), { getState: () => mockAuth }) }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockId }), useSegments: () => [], useRouter: () => ({ push: jest.fn() }),
  // 回到相册时按 momentsMutatedSince 补刷一次。
  useFocusEffect: (callback: () => void) => { const { useEffect } = jest.requireActual('react'); useEffect(callback, [callback]); },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
// 本页直接从 @/services/api/client 取失败判别,它会把 @/i18n 带进来。
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }), initReactI18next: { type: '3rdParty', init: () => {} } }));
// 资料缓存在原生端只在加密库就绪后才工作;给它一个内存 MMKV。
jest.mock('@/storage/encrypted-init', () => {
  const instance = jest.requireActual('react-native-mmkv').createMMKV({ id: 'spec' });
  return { getEncryptedInstance: () => instance, initEncryptedStorage: async () => instance };
});
jest.mock('@/theme', () => ({ Spacing: {}, Typography: {}, useTheme: () => ({ colors: {} }) }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/features/discover/hooks/use-user-moments', () => ({ useUserMoments: () => ({ moments: [], loading: false, refreshing: false, hasMore: false }) }));
jest.mock('@/features/discover/hooks/use-change-cover', () => ({ useChangeCover: () => ({ changeCover: jest.fn() }) }));
jest.mock('@/features/discover/components/moment-album-row', () => ({ MomentAlbumRow: () => null }));
jest.mock('@/features/discover/components/moment-album-header', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MomentAlbumHeader: ({ coverUrl, avatarUrl, nickname }: { coverUrl?: string; avatarUrl?: string; nickname: string }) => <Text>{[coverUrl, avatarUrl, nickname].join('|')}</Text> };
});
jest.mock('@/services/api/profile', () => ({ fetchUserProfile: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
beforeEach(() => { mockAuth.sessionEpoch = 42; mockId = 'friend'; evictUserProfileCache(42, 'friend'); jest.mocked(fetchUserProfile).mockReset(); });
test('reentering an album immediately retains the last fetched avatar and cover', async () => {
  jest.mocked(fetchUserProfile).mockResolvedValueOnce({ id: 'friend', nickname: 'Friend', avatarUrl: 'avatar', cover: 'cover' } as Awaited<ReturnType<typeof fetchUserProfile>>);
  const first = render(<UserMomentsScreen />);
  await screen.findByText('cover|avatar|Friend');
  first.unmount();
  jest.mocked(fetchUserProfile).mockReturnValue(new Promise(() => {}));
  render(<UserMomentsScreen />);
  expect(screen.getByText('cover|avatar|Friend')).toBeTruthy();
  expect(fetchUserProfile).toHaveBeenCalledTimes(1);
});
test('own album starts with the selected cover already in auth state', () => {
  mockId = 'owner';
  jest.mocked(fetchUserProfile).mockReturnValue(new Promise(() => {}));
  render(<UserMomentsScreen />);
  expect(screen.getByText('own-cover|own-avatar|Owner')).toBeTruthy();
});

jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_err: unknown, fallback: string) => fallback }));

test('an account switch never reuses the previous album identity', () => {
  writeUserProfileCache(42, 'friend', { album: { at: Date.now(), value: { id: 'friend', nickname: 'Private', avatarUrl: 'private-avatar', cover: 'private-cover', signature: '' } } });
  mockAuth.sessionEpoch = 43;
  jest.mocked(fetchUserProfile).mockReturnValue(new Promise(() => {}));
  render(<UserMomentsScreen />);
  expect(screen.queryByText('private-cover|private-avatar|Private')).toBeNull();
});
test('a refreshed profile denial removes the cached album identity', async () => {
  writeUserProfileCache(42, 'friend', { album: { at: 1, value: { id: 'friend', nickname: 'Private', avatarUrl: 'private-avatar', cover: 'private-cover', signature: '' } } });
  let rejectRequest: (error: Error) => void = () => {};
  jest.mocked(fetchUserProfile).mockReturnValue(new Promise((_resolve, reject) => { rejectRequest = reject; }));
  render(<UserMomentsScreen />);
  expect(screen.getByText('private-cover|private-avatar|Private')).toBeTruthy();
  // 只有服务端明确拒绝(401/403/404)才清掉身份;断网等瞬时失败沿用缓存。
  await act(async () => { rejectRequest(new ApiError('forbidden', { status: 403 })); });
  expect(screen.queryByText('private-cover|private-avatar|Private')).toBeNull();
});
