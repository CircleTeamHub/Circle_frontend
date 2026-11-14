import React from 'react';
import { render, screen } from '@testing-library/react-native';
import MomentDetailScreen from './MomentDetailScreen';
import type { MomentPost } from '@/types';

let mockParams: { id: string; targetCommentId?: string } = { id: 'moment-1' };
const mockAuth = { user: { id: 'me' }, sessionEpoch: 1 };
const mockPost: MomentPost = {
  id: 'moment-1',
  content: '周末去爬山',
  images: ['https://cdn.example.com/a.jpg'],
  visibility: 'FRIENDS_ONLY',
  author: { id: 'peer', nickname: '小李', avatarUrl: null, avatarFrameAppearance: null },
  likeCount: 0,
  commentCount: 1,
  isLikedByMe: false,
  likedFriends: [],
  comments: [{
    id: 'comment-1', content: '第一条评论', user: { id: 'friend', nickname: '小王' },
    replyTo: null, createdAt: '2026-11-01T00:00:00Z', ignoredMentionCount: 0,
  }],
  createdAt: '2026-11-01T00:00:00Z',
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)', 'discover'],
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh' } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme/tokens'), useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }) }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/nav-header', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});
jest.mock('@/features/discover/components/moment-media', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MomentMedia: () => <View testID="moment-media" /> };
});
jest.mock('@/features/discover/components/moment-comment-input', () => ({ MomentCommentInput: () => null }));
jest.mock('@/features/discover/components/moment-mention-notice', () => ({ MomentMentionNotice: () => null }));
// 详情接口一直不回:页面上的帖子只能来自动态列表的内存。
jest.mock('@/services/api/moments', () => ({
  fetchMomentById: jest.fn(() => new Promise(() => undefined)),
  addMomentComment: jest.fn(), deleteMomentComment: jest.fn(), setMomentLike: jest.fn(), deleteMoment: jest.fn(),
}));
jest.mock('@/features/discover/store/use-moments-store', () => ({
  useMomentsStore: (selector: (state: unknown) => unknown) => selector({
    moments: [mockPost], toggleLike: jest.fn(), addComment: jest.fn(), removeComment: jest.fn(),
  }),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
    { getState: () => mockAuth },
  ),
}));
jest.mock('@/services/api/client', () => ({ ApiError: class ApiError extends Error {}, isDefinitiveAuthFailure: () => false }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/features/notifications/utils/seen-target', () => ({ markMatchingTargetNotificationsRead: jest.fn(() => Promise.resolve()) }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/storage/page-snapshots', () => ({ readPageSnapshot: () => null }));

beforeEach(() => {
  mockParams = { id: 'moment-1' };
});

// 进页不卡:native-stack 等新页面首次提交完才开始推入动画。帖子图片和评论首帧不画,
// 下一帧再画;中间也不闪「暂无评论」。
test('the post and its comments render on the next frame, not in the first commit', async () => {
  render(<MomentDetailScreen />);

  expect(screen.queryByTestId('moment-media')).toBeNull();
  expect(screen.queryByText('第一条评论')).toBeNull();
  expect(screen.queryByText('moment.noComments')).toBeNull();
  expect(await screen.findByTestId('moment-media')).toBeTruthy();
  expect(screen.getByText('第一条评论')).toBeTruthy();
});

// 从通知点进来要定位到某条评论:定位滚动必须和列表用同一份评论,
// 否则空着的那一帧里 scrollToIndex 会对着空列表同步抛错。
test('jumping to a target comment waits for the comments to be on the list', async () => {
  mockParams = { id: 'moment-1', targetCommentId: 'comment-1' };
  render(<MomentDetailScreen />);

  expect(await screen.findByText('第一条评论')).toBeTruthy();
});
