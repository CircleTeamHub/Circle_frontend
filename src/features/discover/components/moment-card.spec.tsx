import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MomentCard } from './moment-card';
import { Spacing } from '@/theme';
import type { MomentPost } from '@/types';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/member-name', () => ({ MemberName: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('./moment-media', () => ({ MomentMedia: () => null }));

const post: MomentPost = {
  id: 'm1',
  content: 'Hello',
  createdAt: '2026-11-10T00:00:00Z',
  author: { id: 'me', nickname: 'me', avatarUrl: null, avatarFrameAppearance: null },
  images: [],
  comments: [],
  likedFriends: [],
  likeCount: 12,
  commentCount: 34,
  visibility: 'PUBLIC',
  isLikedByMe: false,
};

// jest 跑的是原生平台：网页为补 hitSlop 放大的 44×44 按钮和收窄的间距不能带进 iOS/Android，
// 否则两位数的点赞/评论数会贴到下一个图标上。
test('native moment actions keep the designed spacing and icon-sized buttons', () => {
  render(
    <MomentCard post={post} scope="discover" onLike={jest.fn()} onPress={jest.fn()} onDelete={jest.fn()} />,
  );
  expect(StyleSheet.flatten(screen.getByTestId('moment-card-actions').props.style).gap).toBe(Spacing.lg);
  const remove = StyleSheet.flatten(screen.getByRole('button', { name: 'moment.deleteTitle' }).props.style);
  expect(remove.minWidth).toBeUndefined();
  expect(remove.minHeight).toBeUndefined();
});
