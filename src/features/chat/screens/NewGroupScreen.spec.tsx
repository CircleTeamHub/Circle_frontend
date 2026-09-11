import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import NewGroupScreen from './NewGroupScreen';
import { createGroupConversation } from '@/chat-core/client';
import { fetchFriends } from '@/services/api/friends';

/**
 * 建群页的提交闸:群名必填、至少 2 位好友。两条都是服务端会拒的硬条件
 * (CHAT_GROUP_NAME_REQUIRED / ArrayMinSize(2)),端上先拦一道,免得用户
 * 填完成员才被打回;发出去的群名必须是 trim 过的。
 */
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => ['(tabs)', 'messages'],
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/theme', () => ({
  Radius: { md: 8, lg: 12 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  Typography: { body: {}, caption: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      primary: '#00f',
      white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/keyboard-dismiss', () => ({
  keyboardDismissOnDragProps: {},
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: jest.fn(() => 'localized-error'),
}));
jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('@/chat-core/client', () => ({
  createGroupConversation: jest.fn(),
}));

const friend = (id: string, nickname: string) => ({
  id,
  nickname,
  remark: null,
  avatarUrl: null,
  accountId: id,
});

const FRIENDS = [friend('f1', '小方'), friend('f2', '小李')];

const submitButton = () => screen.getByLabelText('messages.newGroupSubmit');

/** 渲染 + 等好友列表落地,再按名字勾人。 */
async function renderWithFriends(selectNames: string[]) {
  render(<NewGroupScreen />);
  for (const name of selectNames) {
    fireEvent.press(await screen.findByLabelText(name));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchFriends).mockResolvedValue(FRIENDS);
  jest
    .mocked(createGroupConversation)
    .mockResolvedValue({ conversationID: 'conv-1' });
});

test('a whitespace-only name keeps submit shut even with enough friends picked', async () => {
  await renderWithFriends(['小方', '小李']);

  fireEvent.changeText(
    screen.getByPlaceholderText('messages.newGroupNamePlaceholder'),
    '   ',
  );
  expect(submitButton()).toBeDisabled();

  fireEvent.press(submitButton());
  expect(createGroupConversation).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test('a name alone is not enough: the 2-friend floor still gates submit', async () => {
  await renderWithFriends(['小方']);

  fireEvent.changeText(
    screen.getByPlaceholderText('messages.newGroupNamePlaceholder'),
    '周末爬山',
  );
  expect(submitButton()).toBeDisabled();

  fireEvent.press(submitButton());
  expect(createGroupConversation).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

test('a non-blank name plus 2 friends submits the trimmed name and opens the group', async () => {
  await renderWithFriends(['小方', '小李']);

  fireEvent.changeText(
    screen.getByPlaceholderText('messages.newGroupNamePlaceholder'),
    '  周末爬山  ',
  );
  expect(submitButton()).not.toBeDisabled();

  fireEvent.press(submitButton());

  await waitFor(() => {
    expect(createGroupConversation).toHaveBeenCalledWith({
      name: '周末爬山',
      memberIds: ['f1', 'f2'],
    });
  });
  // 标题用群名本身,不再回落「群聊」兜底名。
  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/messages/chat-detail',
      params: expect.objectContaining({
        conversationID: 'conv-1',
        title: '周末爬山',
        conversationKind: 'group',
      }),
    });
  });
});

test('the create lock holds through the navigation window so a double tap cannot build two groups', async () => {
  await renderWithFriends(['小方', '小李']);

  fireEvent.changeText(
    screen.getByPlaceholderText('messages.newGroupNamePlaceholder'),
    '周末爬山',
  );
  // 成功路径不解锁:屏幕要到下一帧才卸载,慢设备上的第二下点击不能再建一个群。
  fireEvent.press(submitButton());
  fireEvent.press(submitButton());

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
  expect(createGroupConversation).toHaveBeenCalledTimes(1);
});

test('a failed create unlocks submit so the user can retry', async () => {
  jest
    .mocked(createGroupConversation)
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue({ conversationID: 'conv-2' });
  await renderWithFriends(['小方', '小李']);

  fireEvent.changeText(
    screen.getByPlaceholderText('messages.newGroupNamePlaceholder'),
    '周末爬山',
  );
  fireEvent.press(submitButton());
  await waitFor(() => {
    expect(submitButton()).not.toBeDisabled();
  });

  fireEvent.press(submitButton());
  await waitFor(() => {
    expect(createGroupConversation).toHaveBeenCalledTimes(2);
  });
  expect(mockReplace).toHaveBeenCalledTimes(1);
});
