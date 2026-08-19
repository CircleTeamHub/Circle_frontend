import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import SupportAgentsScreen from './SupportAgentsScreen';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockSupport = { state: {} as Record<string, unknown> };

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({ category: 'recharge' }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number | undefined>) =>
      String(options?.defaultValue ?? key).replace(
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
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});

jest.mock('@/theme', () => ({
  Radius: { xs: 4, sm: 8 },
  Spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  Typography: { small: {}, body: {}, bodyRegular: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      text: '#111',
      textSecondary: '#666',
      primary: '#6200ee',
      white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});

jest.mock('@/components/ui/divider', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { Divider: () => <View /> };
});

jest.mock('@/components/ui/avatar', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Avatar: ({ uri }: { uri: string }) => <Text>{`avatar:${uri}`}</Text>,
  };
});

jest.mock('@/observability/sentry', () => ({ reportError: jest.fn() }));
jest.mock('@/chat-core/client', () => ({
  ensureDirectConversation: jest.fn(),
}));

// 只 mock store;selectSupportAgents 是纯函数,保持真实。
jest.mock('@/stores/supportConfigStore', () => ({
  useSupportConfigStore: (selector: (state: unknown) => unknown) =>
    selector(mockSupport.state),
}));

const emptyConfig = () => ({
  recharge: [],
  issue: [],
  dispute: [],
  account: [],
  membership: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSupport.state = {
    config: null,
    loading: false,
    error: null,
    fetchConfig: jest.fn(),
  };
});

test('the first load shows a loading line rather than claiming there is no support', () => {
  mockSupport.state = { ...mockSupport.state, loading: true };

  render(<SupportAgentsScreen />);

  expect(screen.getByText('加载中…')).toBeTruthy();
  expect(screen.queryByText('profile.customerService.empty')).toBeNull();
});

// 「拉取失败」和「后端确实没配」是两件事:把故障说成「没有客服」会让用户直接
// 放弃咨询,而且他手上没有任何下一步可做。
test('a failed fetch shows a retry action instead of the empty-roster message', () => {
  mockSupport.state = { ...mockSupport.state, error: 'offline' };

  render(<SupportAgentsScreen />);

  expect(screen.getByText('客服信息加载失败')).toBeTruthy();
  expect(screen.getByText('common.networkError')).toBeTruthy();
  expect(screen.queryByText('profile.customerService.empty')).toBeNull();

  const fetchConfig = mockSupport.state.fetchConfig as jest.Mock;
  fetchConfig.mockClear();
  fireEvent.press(screen.getByText('common.retry'));
  expect(fetchConfig).toHaveBeenCalledWith({ force: true });
});

test('a successful but empty roster still says there is no agent in this category', () => {
  mockSupport.state = { ...mockSupport.state, config: emptyConfig() };

  render(<SupportAgentsScreen />);

  expect(screen.getByText('profile.customerService.empty')).toBeTruthy();
  expect(screen.queryByText('common.retry')).toBeNull();
});

test('an agent without an avatar renders the headset badge, not a broken image', () => {
  mockSupport.state = {
    ...mockSupport.state,
    config: {
      ...emptyConfig(),
      recharge: [
        { userID: 'a1', nickname: '', avatarUrl: null, vipLevel: 0 },
        { userID: 'a2', nickname: '', avatarUrl: null, vipLevel: 0 },
      ],
    },
  };

  render(<SupportAgentsScreen />);

  // 没昵称的客服回落成带编号的通用名(mock 的 t 不做插值,断言只看用了哪个 key),
  // 免得两行长得一模一样。
  expect(
    screen.getAllByText('profile.customerService.agentIndexedName'),
  ).toHaveLength(2);
  expect(screen.getAllByText('headset')).toHaveLength(2);
  expect(screen.queryByText(/^avatar:/)).toBeNull();
});
