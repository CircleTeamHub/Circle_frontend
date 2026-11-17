import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PlazaPostCard } from '@/features/discover/components/plaza-post-card';
import { fetchPlazaPost } from '@/services/api/plaza';
import PlazaPostDetailScreen from './PlazaPostDetailScreen';

let mockSegments: string[] = ['(tabs)', 'messages', 'plaza-post-detail'];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'p1' }),
  useSegments: () => mockSegments,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@/features/discover/components/plaza-post-card', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PlazaPostCard: jest.fn(({ post, scope }: { post: { id: string }; scope?: string }) => (
      <Text>{`帖子 ${post.id} @${scope ?? 'default'}`}</Text>
    )),
  };
});
jest.mock('@/services/api/plaza', () => ({ fetchPlazaPost: jest.fn() }));
jest.mock('@/services/api/circles', () => ({ joinCircle: jest.fn() }));
jest.mock('@/services/api/client', () => ({ ApiError: class ApiError extends Error {} }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_e: unknown, fallback: string) => fallback }));

const post = { id: 'p1', content: 'hi' };

beforeEach(() => {
  jest.mocked(PlazaPostCard).mockClear();
  jest.mocked(fetchPlazaPost).mockResolvedValue(post as never);
});

// 聊天里点分享的帖子卡片进来是在消息栈:卡片上的头像、报名进私聊都要留在消息栈,
// 否则会跳进圈子 tab,返回回不到这条帖子(返回永远回上一层)。
test.each([
  [['(tabs)', 'messages', 'plaza-post-detail'], 'messages'],
  [['(tabs)', 'discover', 'plaza-post-detail'], 'discover'],
  [['(tabs)', 'explore', 'plaza-post-detail'], 'explore'],
])('the post card keeps navigation in the stack it was opened from (%j)', async (segments, scope) => {
  mockSegments = segments;
  render(<PlazaPostDetailScreen />);
  expect(await screen.findByText(`帖子 p1 @${scope}`)).toBeTruthy();
});
