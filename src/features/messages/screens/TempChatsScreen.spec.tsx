import React from 'react';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import TempChatsScreen from './TempChatsScreen';
import {
  createTempChat,
  deleteTempChat,
  fetchMyTempChats,
  type TempChatListItem,
} from '@/services/api/temp-chat';

const mockTranslate = (key: string) => key;
const mockRemoveConversation = jest.fn();

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('@/theme', () => ({
  Radius: { full: 999, md: 8, lg: 12 },
  Spacing: { sm: 4, md: 8, lg: 16, xl: 24 },
  Typography: { body: {}, bodyRegular: {}, caption: {}, tiny: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', text: '#111',
      textSecondary: '#666', primary: '#00f', white: '#fff',
    },
  }),
}));
// 顶栏右侧按钮渲染成可按的替身,用无障碍标签找。
jest.mock('@/components/ui/nav-header', () => {
  const { Pressable: MockPressable } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NavHeader: ({
      rightActions = [],
    }: {
      rightActions?: { accessibilityLabel: string; onPress: () => void }[];
    }) =>
      rightActions.map((action) => (
        <MockPressable
          key={action.accessibilityLabel}
          accessibilityLabel={action.accessibilityLabel}
          onPress={action.onPress}
        />
      )),
  };
});
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/features/messages/components/ShareTempChatModal', () => ({
  __esModule: true,
  default: () => null,
}));
// 新建面板只留一个提交入口:这里测的是失败之后屏幕怎么提示。
jest.mock('@/features/messages/components/CreateTempChatModal', () => {
  const { Pressable: MockPressable, Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({
      visible,
      onSubmit,
    }: {
      visible: boolean;
      onSubmit: (payload: { ttlMinutes: number; maxMembers: number }) => void;
    }) =>
      visible ? (
        <MockPressable onPress={() => onSubmit({ ttlMinutes: 60, maxMembers: 10 })}>
          <MockText>submit-create</MockText>
        </MockPressable>
      ) : null,
  };
});
jest.mock('@/services/api/temp-chat', () => ({
  fetchMyTempChats: jest.fn(),
  createTempChat: jest.fn(),
  endTempChat: jest.fn(),
  deleteTempChat: jest.fn(),
  isTempChatOpenable: (room: { status: string; expiresAt: string }) =>
    room.status === 'ACTIVE' && Date.parse(room.expiresAt) > Date.now(),
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: { getState: () => ({ removeConversation: mockRemoveConversation }) },
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (error: { errorCode?: string } | undefined, fallback: string) =>
    error?.errorCode ? `serverErrors.${error.errorCode}` : fallback,
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

const baseRoom: TempChatListItem = {
  id: 'tc-ended',
  groupId: 'g-ended',
  conversationId: 'conv-ended',
  title: '上周的临时聊天',
  status: 'ENDED',
  guestCount: 2,
  memberCount: 3,
  maxMembers: 10,
  expiresAt: '2026-10-20T00:00:00.000Z',
  createdAt: '2026-10-17T00:00:00.000Z',
  endedAt: '2026-10-18T00:00:00.000Z',
  shareUrl: null,
  isActive: false,
  isExpired: false,
};

const activeRoom: TempChatListItem = {
  ...baseRoom,
  id: 'tc-active',
  groupId: 'g-active',
  conversationId: 'conv-active',
  title: '进行中的临时聊天',
  status: 'ACTIVE',
  expiresAt: '2999-01-01T00:00:00.000Z',
  endedAt: null,
  shareUrl: 'https://t.example/t/token',
  isActive: true,
};

let alertSpy: jest.SpyInstance;

function lastAlert(): { title: string; message?: string; buttons: AlertButton[] } {
  const [title, message, buttons] = alertSpy.mock.calls.at(-1) as [
    string,
    string | undefined,
    AlertButton[] | undefined,
  ];
  return { title, message, buttons: buttons ?? [] };
}

function pressAlertButton(label: string): void {
  const button = lastAlert().buttons.find((candidate) => candidate.text === label);
  if (!button?.onPress) throw new Error(`no alert button ${label}`);
  button.onPress();
}

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
});

test('deleting an ended room confirms first, then drops the row and its conversation', async () => {
  jest.mocked(fetchMyTempChats).mockResolvedValue([baseRoom]);
  jest.mocked(deleteTempChat).mockResolvedValue(undefined);
  render(<TempChatsScreen />);
  await screen.findByText(baseRoom.title);

  fireEvent.press(screen.getByLabelText('tempChats.more'));
  // 已结束的房间只剩删除(和取消),没有复制链接 / 结束。
  expect(lastAlert().buttons.map((button) => button.text)).toEqual([
    'tempChats.actionDelete',
    'common.cancel',
  ]);
  pressAlertButton('tempChats.actionDelete');
  expect(lastAlert()).toMatchObject({
    title: 'tempChats.deleteConfirmTitle',
    message: 'tempChats.deleteConfirmMessage',
  });
  expect(deleteTempChat).not.toHaveBeenCalled();

  await act(async () => {
    pressAlertButton('tempChats.deleteConfirm');
  });

  expect(deleteTempChat).toHaveBeenCalledWith('tc-ended');
  expect(screen.queryByText(baseRoom.title)).toBeNull();
  expect(mockRemoveConversation).toHaveBeenCalledWith('conv-ended');
});

test('an active room offers copy, end and delete, and warns that deleting ends it', async () => {
  jest.mocked(fetchMyTempChats).mockResolvedValue([activeRoom]);
  render(<TempChatsScreen />);
  await screen.findByText(activeRoom.title);

  fireEvent.press(screen.getByLabelText('tempChats.more'));
  expect(lastAlert().buttons.map((button) => button.text)).toEqual([
    'tempChats.copyLink',
    'tempChats.actionEnd',
    'tempChats.actionDelete',
    'common.cancel',
  ]);
  pressAlertButton('tempChats.actionDelete');
  expect(lastAlert().message).toBe('tempChats.deleteActiveConfirmMessage');
});

test('a failed delete keeps the row and shows the localized error', async () => {
  jest.mocked(fetchMyTempChats).mockResolvedValue([baseRoom]);
  jest.mocked(deleteTempChat).mockRejectedValue({ errorCode: 'TEMP_CHAT_CREATOR_ONLY' });
  render(<TempChatsScreen />);
  await screen.findByText(baseRoom.title);

  fireEvent.press(screen.getByLabelText('tempChats.more'));
  pressAlertButton('tempChats.actionDelete');
  await act(async () => {
    pressAlertButton('tempChats.deleteConfirm');
  });

  expect(lastAlert()).toMatchObject({
    title: 'tempChats.deleteFailed',
    message: 'serverErrors.TEMP_CHAT_CREATOR_ONLY',
  });
  expect(screen.getByText(baseRoom.title)).toBeTruthy();
  expect(mockRemoveConversation).not.toHaveBeenCalled();
});

// 列表非空时 error 区块不渲染、新建面板还盖在上面 —— 每日上限必须用对话框说出来。
test('the daily create limit pops a localized dialog over the open create sheet', async () => {
  jest.mocked(fetchMyTempChats).mockResolvedValue([baseRoom]);
  jest.mocked(createTempChat).mockRejectedValue({
    errorCode: 'TEMP_CHAT_DAILY_CREATE_LIMIT',
  });
  render(<TempChatsScreen />);
  await screen.findByText(baseRoom.title);

  fireEvent.press(screen.getByLabelText('tempChats.create'));
  await act(async () => {
    fireEvent.press(screen.getByText('submit-create'));
  });

  expect(createTempChat).toHaveBeenCalledWith({ ttlMinutes: 60, maxMembers: 10 });
  expect(lastAlert()).toMatchObject({
    title: 'tempChats.createFailed',
    message: 'serverErrors.TEMP_CHAT_DAILY_CREATE_LIMIT',
  });
  // 面板不关:用户可以直接关掉或改天再来,不会以为已经建好了。
  expect(screen.getByText('submit-create')).toBeTruthy();
});
