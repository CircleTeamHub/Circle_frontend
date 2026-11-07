import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import { PlazaPostCard } from './plaza-post-card';
import type { CirclePlazaPost } from '@/types';

let mockUserId = 'me';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) =>
      (options?.defaultValue ?? key).replace('{{count}}', String(options?.count ?? '')),
  }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }) }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: { id: mockUserId } }),
}));
jest.mock('@/features/discover/store/use-discover-store', () => ({
  useDiscoverStore: (selector: (s: { removePlazaPost: jest.Mock }) => unknown) =>
    selector({ removePlazaPost: jest.fn() }),
}));
jest.mock('@/services/api/plaza', () => ({
  cancelSignup: jest.fn(),
  signupForPost: jest.fn(),
  deletePlazaPost: jest.fn(),
  reportPlazaPost: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_e: unknown, fallback: string) => fallback }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/user-icon-row', () => ({ UserIconRow: () => null }));
jest.mock('@/components/ui/member-name', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { MemberName: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('./image-grid', () => ({ ImageGrid: () => null }));
jest.mock('./plaza-post-actions-sheet', () => ({ PlazaPostActionsSheet: () => null }));

const noLimits = { vipLevel: null, creditScore: null, fancyNumber: false };
const post: CirclePlazaPost = {
  id: 'p1',
  content: '北京来人',
  images: [],
  tags: [],
  city: '北京',
  cities: [],
  isHorn: false,
  noteId: null,
  restrictions: noLimits,
  signupCount: 0,
  signedByMe: false,
  signupRestrictions: noLimits,
  canSignup: true,
  author: {
    id: 'author',
    nickname: '丁哥只认钱',
    avatarUrl: null,
    avatarFrame: null,
    avatarFrameAppearance: null,
    accountId: 'a1',
    displayIcons: [],
  },
  circle: { id: 'c1', name: '奢侈品交流' },
  circles: [],
  canInteract: true,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
} as CirclePlazaPost;

beforeEach(() => {
  mockUserId = 'me';
});

// 报名条件只有短短一截、报名按钮也只有一截,各占一行时右边全空着:合成一行,卡片矮一截。
test('the signup condition and the signup button share one row', () => {
  render(<PlazaPostCard post={post} />);
  const footer = within(screen.getByTestId('plaza-card-footer'));
  expect(footer.getByText('报名条件：')).toBeTruthy();
  expect(footer.getByText('不限制')).toBeTruthy();
  expect(footer.getByText('报名')).toBeTruthy();
});

test("the author's own post shows the signup count in that same row", () => {
  mockUserId = 'author';
  render(<PlazaPostCard post={post} />);
  const footer = within(screen.getByTestId('plaza-card-footer'));
  expect(footer.getByText('报名条件：')).toBeTruthy();
  expect(footer.getByText('0 人报名')).toBeTruthy();
});
