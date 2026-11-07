import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { PlazaPostCard } from './plaza-post-card';
import { signupForPost } from '@/services/api/plaza';
import { useTheme } from '@/theme';
import type { ThemeColors } from '@/theme/types';
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

/** 测试环境里的主题色(和组件拿到的是同一份)。 */
function themeColors(): ThemeColors {
  let captured: ThemeColors | null = null;
  const Probe = () => {
    captured = useTheme().colors;
    return null;
  };
  render(<Probe />);
  return captured!;
}

const accentColor = () =>
  StyleSheet.flatten(screen.getByTestId('plaza-card-accent').props.style).backgroundColor;

// 左侧竖条告诉看帖的人「我能不能报」:能报绿、已报主题紫、不满足条件橙。
test('the left bar is green when I can sign up', () => {
  const colors = themeColors();
  render(<PlazaPostCard post={post} />);
  expect(accentColor()).toBe(colors.success);
});

test('the left bar is the theme purple once I have signed up', () => {
  const colors = themeColors();
  render(<PlazaPostCard post={{ ...post, signedByMe: true, signupCount: 1 }} />);
  expect(accentColor()).toBe(colors.tabBarActive);
});

test('the left bar is orange when I do not meet the conditions', () => {
  const colors = themeColors();
  render(<PlazaPostCard post={{ ...post, canSignup: false }} />);
  expect(accentColor()).toBe(colors.warning);
});

test('signing up turns the bar purple right away', async () => {
  const colors = themeColors();
  jest.mocked(signupForPost).mockResolvedValueOnce({ signed: true, signupCount: 1 });
  render(<PlazaPostCard post={post} />);
  await act(async () => {
    fireEvent.press(within(screen.getByTestId('plaza-card-footer')).getByText('报名'));
  });
  expect(accentColor()).toBe(colors.tabBarActive);
});

// 报名按钮和竖条同一套颜色:能报绿色实心、已报紫色描边、不满足条件橙色(变淡)。
const signupButtonStyle = () => StyleSheet.flatten(screen.getByTestId('plaza-card-signup').props.style);

test('the signup button is solid green when I can sign up', () => {
  const colors = themeColors();
  render(<PlazaPostCard post={post} />);
  expect(signupButtonStyle()).toMatchObject({ backgroundColor: colors.success, borderColor: colors.success });
  expect(accentColor()).toBe(colors.success);
});

test('the signed-up button is outlined in the theme purple', () => {
  const colors = themeColors();
  render(<PlazaPostCard post={{ ...post, signedByMe: true, signupCount: 1 }} />);
  expect(signupButtonStyle()).toMatchObject({ backgroundColor: 'transparent', borderColor: colors.tabBarActive });
  expect(screen.getByText('已报名 1').props.style).toMatchObject({ color: colors.tabBarActive });
});

test('the button is a faded orange when I do not meet the conditions', () => {
  const colors = themeColors();
  render(<PlazaPostCard post={{ ...post, canSignup: false }} />);
  expect(signupButtonStyle()).toMatchObject({ backgroundColor: colors.warning, opacity: 0.5 });
});

// 自己的帖子谈不上「我能不能报」:竖条用不带含义的描边色。
test("the bar on the author's own post carries no signup meaning", () => {
  mockUserId = 'author';
  const colors = themeColors();
  render(<PlazaPostCard post={post} />);
  expect(accentColor()).toBe(colors.surfaceBorder);
});

test("the author's own post shows the signup count in that same row", () => {
  mockUserId = 'author';
  render(<PlazaPostCard post={post} />);
  const footer = within(screen.getByTestId('plaza-card-footer'));
  expect(footer.getByText('报名条件：')).toBeTruthy();
  expect(footer.getByText('0 人报名')).toBeTruthy();
});
