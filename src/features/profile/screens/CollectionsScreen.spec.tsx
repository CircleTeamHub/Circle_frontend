import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import CollectionsScreen from './CollectionsScreen';
import { fetchCollections, type UserCollection } from '@/services/api/collections';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

// 组件直接 import 了 router 单例：用 getter 延迟取值，避开 jest.mock 提升后的 TDZ。
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

// 与真 react-i18next 一样返回稳定的 t：加载 effect 依赖 t，每次渲染换身份会无限重拉。
const mockTranslate = (key: string, options?: { defaultValue?: string; title?: string }) =>
  (options?.defaultValue ?? key).replace('{{title}}', options?.title ?? '');
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));

// message-collection 读 i18n 单例，真模块会牵出原生存储。
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// 真实 token 与浅色色板，只替换掉会牵出原生存储的 ThemeProvider。
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: jest.requireActual('@/theme/colors').lightColors }),
}));

jest.mock('@/components/ui/nav-header', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { NavHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});

jest.mock('@/hooks/use-network-status', () => ({
  useNetworkStatus: () => ({ isOffline: false }),
}));

jest.mock('@/services/api/collections', () => ({
  fetchCollections: jest.fn(),
  deleteCollection: jest.fn(),
}));

const mockFetchCollections = fetchCollections as jest.MockedFunction<typeof fetchCollections>;

const chatItem: UserCollection = {
  id: 'c-1',
  userID: 'me',
  type: 'CHAT',
  title: '周末去爬山',
  summary: '早上八点集合',
  sourceID: null,
  payload: {
    kind: 'openim-message',
    messageID: 'm-1',
    messageType: 'text',
    conversationID: 'sg_group-1',
    conversationTitle: '登山群',
    senderID: 'u-2',
    senderName: '小李',
  },
  createdAt: '2026-10-30T08:00:00.000Z',
  updatedAt: '2026-10-30T08:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows the page title and an actionable empty state', async () => {
  mockFetchCollections.mockResolvedValue([]);
  render(<CollectionsScreen />);

  expect(screen.getByText('我的收藏')).toBeTruthy();
  expect(await screen.findByText('还没有收藏')).toBeTruthy();
  expect(screen.getByText('在聊天里长按消息，选择「收藏」')).toBeTruthy();
});

test('a failed load offers a retry that refetches', async () => {
  mockFetchCollections.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([chatItem]);
  render(<CollectionsScreen />);

  fireEvent.press(await screen.findByText('重试'));

  expect(await screen.findByText('周末去爬山')).toBeTruthy();
  expect(mockFetchCollections).toHaveBeenCalledTimes(2);
});

test('tapping a card jumps back to the source message; delete lives in the more menu', async () => {
  mockFetchCollections.mockResolvedValue([chatItem]);
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  render(<CollectionsScreen />);

  fireEvent.press(await screen.findByLabelText('周末去爬山'));
  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: '/(tabs)/profile/chat-detail',
      params: expect.objectContaining({ sourceID: 'group-1', searchedMsgID: 'm-1' }),
    }),
  );

  // 卡片上不再常驻红色「删除」，删除收进「…」菜单。
  expect(screen.queryByText('删除')).toBeNull();
  fireEvent.press(screen.getByLabelText('更多操作'));
  const buttons = alertSpy.mock.calls[0][2]?.map((button) => button.text);
  expect(buttons).toEqual(['回到消息', '发送人', '删除', '取消']);
});
