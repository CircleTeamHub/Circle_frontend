import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import MemberCenterScreen from './MemberCenterScreen';
import MemberRulesScreen from './MemberRulesScreen';
import { fetchCurrentUser } from '@/services/api/auth';
import { fetchMembershipProgramStatus } from '@/services/api/membership';
import type { AuthUser } from '@/stores/authStore';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockAuth = { state: {} as Record<string, unknown> };
let mockFocusCallback: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusCallback = callback;
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      options?: Record<string, string | number | undefined>,
    ) =>
      String(options?.defaultValue ?? _key).replace(
        /\{\{(\w+)\}\}/g,
        (_match, name: string) => String(options?.[name] ?? ''),
      ),
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('@/theme', () => ({
  Radius: { xs: 4, sm: 8 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  Typography: {
    tiny: {},
    small: {},
    caption: {},
    body: {},
    bodyRegular: {},
    h1: {},
    h2: {},
    h3: {},
  },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      divider: '#eee',
      text: '#111',
      textSecondary: '#666',
      primary: '#6200ee',
      primaryLight: '#eee8ff',
      white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => {
  const { Pressable, Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NavHeader: ({
      title,
      onRightPress,
      rightAccessibilityLabel,
    }: {
      title: string;
      onRightPress?: () => void;
      rightAccessibilityLabel?: string;
    }) => (
      <View>
        <Text>{title}</Text>
        {onRightPress ? (
          <Pressable
            accessibilityLabel={rightAccessibilityLabel}
            onPress={onRightPress}
          >
            <Text>{rightAccessibilityLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    ),
  };
});

jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAuth.state),
    { getState: () => mockAuth.state },
  ),
}));

jest.mock('@/services/api/auth', () => ({ fetchCurrentUser: jest.fn() }));
jest.mock('@/services/api/membership', () => ({
  fetchMembershipProgramStatus: jest.fn(),
}));

const mockFetchCurrentUser = fetchCurrentUser as jest.MockedFunction<
  typeof fetchCurrentUser
>;
const mockFetchMembershipProgramStatus =
  fetchMembershipProgramStatus as jest.MockedFunction<
    typeof fetchMembershipProgramStatus
  >;

function user(vipLevel: number, id = 'user-a'): AuthUser {
  return {
    id,
    accountId: id,
    uid: id,
    nickname: id,
    avatarUrl: null,
    avatarFrame: null,
    cover: null,
    email: null,
    phoneNumber: null,
    wechat: null,
    qq: null,
    whatsup: null,
    persona: null,
    helloWords: null,
    birthday: null,
    gender: 'unset',
    role: 'USER',
    status: 'ACTIVE',
    lastOnline: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    city: null,
    vipLevel,
    creditScore: 100,
    fancyNumber: false,
    displayIcons: [],
  };
}

function setAuth(currentUser: AuthUser, sessionEpoch = 1) {
  mockAuth.state = {
    user: currentUser,
    sessionEpoch,
    setUser: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID;
  mockFocusCallback = null;
  setAuth(user(0));
  mockFetchCurrentUser.mockResolvedValue(user(0));
  mockFetchMembershipProgramStatus.mockResolvedValue({
    enabled: true,
    enabledAt: '2026-08-01T00:00:00.000Z',
    entitlementFloorLevel: 0,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('regular user selects tiers and receives an activation contact state', async () => {
  render(<MemberCenterScreen />);

  await waitFor(() => expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1));
  expect(screen.getByText('普通用户')).toBeTruthy();
  expect(screen.getByText('联系客服开通 钻石会员')).toBeTruthy();
  expect(screen.getByText('1000 人')).toBeTruthy();
  expect(screen.getByText('单群人数上限')).toBeTruthy();
  expect(screen.queryByText('可创建群聊')).toBeNull();
  expect(screen.queryByText('高级圈子')).toBeNull();

  fireEvent.press(screen.getByLabelText('白银会员，1 个月，¥298'));

  expect(screen.getByText('联系客服开通 白银会员')).toBeTruthy();
  expect(screen.getByText('200 人')).toBeTruthy();
});

test('marketing phase hides recharge actions and shows the new gold limits', async () => {
  mockFetchMembershipProgramStatus.mockResolvedValue({
    enabled: false,
    enabledAt: null,
    entitlementFloorLevel: 2,
  });

  render(<MemberCenterScreen />);

  expect(await screen.findByText('会员功能暂未开放')).toBeTruthy();
  expect(
    screen.getByText('当前所有用户免费享有黄金额度'),
  ).toBeTruthy();
  expect(screen.getByText('单群 400 人 · 可加入 300 个群')).toBeTruthy();
  expect(screen.getByText('笔记 500 条 · 城市筛选 10 个')).toBeTruthy();
  expect(screen.queryByText(/联系客服开通/)).toBeNull();
  expect(screen.queryByText('¥')).toBeNull();
});

test('member tier selection distinguishes current, upgrade, and lower states', async () => {
  setAuth(user(2));
  mockFetchCurrentUser.mockResolvedValue(user(2));
  render(<MemberCenterScreen />);

  await waitFor(() => expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1));
  expect(screen.getByText('当前已是 黄金会员，联系客服咨询')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('钻石会员，12 个月，¥1998'));
  expect(screen.getByText('联系客服升级至 钻石会员')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('白银会员，1 个月，¥298'));
  expect(screen.getByText('当前会员等级更高，联系客服咨询')).toBeTruthy();
});

test('configured support opens its in-app profile and missing support shows Alert', async () => {
  process.env.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID = 'official-support';
  const first = render(<MemberCenterScreen />);
  await waitFor(() => expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByText('联系客服开通 钻石会员'));
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/profile/user/[id]',
    params: { id: 'official-support', name: '官方客服' },
  });
  expect(Alert.alert).not.toHaveBeenCalled();

  first.unmount();
  jest.clearAllMocks();
  delete process.env.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID;
  render(<MemberCenterScreen />);
  await waitFor(() => expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getByText('联系客服开通 钻石会员'));
  expect(Alert.alert).toHaveBeenCalledWith(
    '客服账号暂未配置',
    '请联系平台官方客服咨询会员开通或升级。',
  );
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test('rules actions navigate to the membership rules screen', async () => {
  render(<MemberCenterScreen />);
  await waitFor(() => expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1));

  fireEvent.press(screen.getAllByLabelText('会员规则')[0]);
  expect(mockRouter.push).toHaveBeenCalledWith(
    '/(tabs)/profile/member-rules',
  );
});

test('returning focus refreshes only the owning auth session', async () => {
  const original = user(1);
  const refreshed = { ...original, vipLevel: 3 };
  setAuth(original, 7);
  mockFetchCurrentUser.mockResolvedValueOnce(original);
  render(<MemberCenterScreen />);
  await waitFor(() => expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1));
  (mockAuth.state.setUser as jest.Mock).mockClear();

  mockFetchCurrentUser.mockResolvedValueOnce(refreshed);
  await act(async () => {
    mockFocusCallback?.();
    await Promise.resolve();
  });
  expect(mockAuth.state.setUser).toHaveBeenCalledWith(refreshed);

  let resolveStale!: (value: AuthUser) => void;
  mockFetchCurrentUser.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveStale = resolve;
    }),
  );
  const originalSetUser = mockAuth.state.setUser as jest.Mock;
  originalSetUser.mockClear();
  const staleFocusCleanup = mockFocusCallback?.();
  setAuth(user(0, 'user-b'), 8);
  await act(async () => {
    resolveStale(refreshed);
    await Promise.resolve();
  });
  expect(originalSetUser).not.toHaveBeenCalled();
  if (typeof staleFocusCleanup === 'function') staleFocusCleanup();
});

test('focus refresh updates membership without replacing badges or unrelated user fields', async () => {
  const badge = {
    id: 'badge-a',
    type: 'SYSTEM' as const,
    title: 'Verified',
    imageUrl: null,
    fallbackIconName: 'shield-checkmark',
    systemKey: 'VERIFIED_PROFILE' as const,
    sortOrder: 1,
  };
  const current = {
    ...user(1),
    nickname: 'Current profile',
    creditScore: 888,
    displayIcons: [badge],
  };
  const staleResponse = {
    ...current,
    vipLevel: 3,
    nickname: 'Stale profile',
    creditScore: 100,
    displayIcons: [],
  };
  setAuth(current, 7);
  mockFetchCurrentUser.mockResolvedValueOnce(staleResponse);

  render(<MemberCenterScreen />);

  await waitFor(() =>
    expect(mockAuth.state.setUser).toHaveBeenCalledWith({
      ...current,
      vipLevel: 3,
    }),
  );
});

test('focus refresh ignores unmount and reports failure without error data', async () => {
  let resolveRefresh!: (value: AuthUser) => void;
  mockFetchCurrentUser.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveRefresh = resolve;
    }),
  );
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const view = render(<MemberCenterScreen />);
  view.unmount();

  await act(async () => {
    resolveRefresh(user(3));
    await Promise.resolve();
  });
  expect(mockAuth.state.setUser).not.toHaveBeenCalled();

  mockFetchCurrentUser.mockRejectedValueOnce(new Error('private response data'));
  render(<MemberCenterScreen />);
  await waitFor(() => expect(warn).toHaveBeenCalledWith('[MemberCenterScreen] user refresh failed'));
});

test('tier headers wrap long content instead of forcing a single line', async () => {
  render(<MemberCenterScreen />);
  await waitFor(() => expect(mockFetchCurrentUser).toHaveBeenCalledTimes(1));

  let sectionHeader = screen.getByText('选择会员档位').parent;
  while (
    sectionHeader &&
    StyleSheet.flatten(sectionHeader.props.style)?.flexWrap !== 'wrap'
  ) {
    sectionHeader = sectionHeader.parent;
  }
  expect(sectionHeader).not.toBeNull();
  expect(StyleSheet.flatten(sectionHeader?.props.style)).toEqual(
    expect.objectContaining({ flexWrap: 'wrap' }),
  );
  expect(screen.getByText('钻石会员').props.numberOfLines).toBe(2);
  expect(screen.getByText('钻石会员').props.adjustsFontSizeToFit).toBeUndefined();
});

test('rules screen states the exact support-assisted membership contract', () => {
  render(<MemberRulesScreen />);

  for (const text of [
    '白银会员 ¥298 / 1 个月；黄金会员 ¥1288 / 6 个月；钻石会员 ¥1998 / 1 年；超级会员 ¥3998 / 永久。',
    '会员不在 App 内使用积分兑换或直接购买。联系客服后，由客服人工核实并开通会员。',
    '已开通会员可联系客服补差价升级；升级后立即生效，原会员剩余价值由客服核算抵扣。',
    '会员到期后仅停止会员权益，不删除账号、聊天、笔记或其他用户内容。',
    '会员规则仅适用于会员中心列出的权益；其中展示的“不限”仍受后端较高的合理使用与防滥用上限约束，实际权限以后端为准。',
    '语音转文字是所有用户可用的免费基础功能，不受会员等级限制。',
    '当前会员权益不包含头像框或动态头像承诺。',
  ]) {
    expect(screen.getByText(text)).toBeTruthy();
  }

  expect(screen.queryByText(/创建群.*上限|高级圈子|优先客服/)).toBeNull();
});
