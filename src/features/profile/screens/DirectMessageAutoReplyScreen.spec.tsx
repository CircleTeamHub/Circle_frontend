import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import DirectMessageAutoReplyScreen from './DirectMessageAutoReplyScreen';
import {
  fetchPrivacySettings,
  updatePrivacySettings,
} from '@/services/api/privacy';
import { useDirectMessageAutoReplyStore } from '@/features/profile/store/use-direct-message-auto-reply-store';

const mockChatState = { currentUserId: 'user-1' as string | null };
const mockTranslate = (key: string, options?: { defaultValue?: string }) =>
  options?.defaultValue ?? key;

jest.mock('@/chat-core/store', () => {
  const useChatStore = Object.assign(
    (selector: (state: typeof mockChatState) => unknown) =>
      selector(mockChatState),
    { getState: () => mockChatState },
  );
  return { useChatStore };
});

jest.mock('@/services/api/privacy', () => ({
  fetchPrivacySettings: jest.fn(),
  updatePrivacySettings: jest.fn(),
}));

jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

jest.mock('@/theme', () => ({
  Radius: { xl: 16 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  Typography: { body: {}, bodyRegular: {}, caption: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      surfaceBorder: '#ddd',
      text: '#111',
      textSecondary: '#666',
      blue: '#00f',
      primary: '#6200ee',
      error: '#c00',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => {
  const { Text, View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NavHeader: ({
      title,
      rightSlot,
    }: {
      title: string;
      rightSlot?: React.ReactNode;
    }) => (
      <View>
        <Text>{title}</Text>
        {rightSlot}
      </View>
    ),
  };
});

jest.mock('@/components/ui/themed-switch', () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ThemedSwitch: ({
      value,
      disabled,
      onValueChange,
    }: {
      value: boolean;
      disabled?: boolean;
      onValueChange: (value: boolean) => void;
    }) => (
      <Pressable
        accessibilityLabel="auto-reply-switch"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => onValueChange(!value)}
      >
        <Text>{String(value)}</Text>
      </Pressable>
    ),
  };
});

const fetchSettings = jest.mocked(fetchPrivacySettings);
const patchSettings = jest.mocked(updatePrivacySettings);
const settings = {
  messageSelfDestructDays: 0 as const,
  momentsVisibility: 'ALL' as const,
  allowStrangerMessages: true,
  showPhone: false,
  showWechat: true,
  showQQ: true,
  showWhatsup: true,
  addMeByAccount: true,
  addMeByPhone: false,
  addMeByQrCode: true,
  addMeByGroup: true,
  callPermission: 'EVERYONE' as const,
  groupInvitePermission: 'EVERYONE' as const,
  directMessageAutoReplyEnabled: true,
  directMessageAutoReplyText: '服务端正文',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockChatState.currentUserId = 'user-1';
  useDirectMessageAutoReplyStore.setState({ byUserId: {} });
});

it('keeps editing disabled after a failed load and retries without patching defaults', async () => {
  fetchSettings
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(settings);

  render(<DirectMessageAutoReplyScreen />);

  expect(await screen.findByText('自动回复设置加载失败')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('auto-reply-switch'));
  expect(patchSettings).not.toHaveBeenCalled();

  fireEvent.press(screen.getByText('重试'));
  await waitFor(() => {
    expect(screen.getByDisplayValue('服务端正文')).toBeTruthy();
  });
  expect(patchSettings).not.toHaveBeenCalled();
});

it('saves an edited reply through an explicit action without relying on blur', async () => {
  fetchSettings.mockResolvedValue(settings);
  patchSettings.mockResolvedValue({
    ...settings,
    directMessageAutoReplyText: '新的正文',
  });

  render(<DirectMessageAutoReplyScreen />);
  const input = await screen.findByDisplayValue('服务端正文');
  fireEvent.changeText(input, '  新的正文  ');

  expect(patchSettings).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('保存'));

  await waitFor(() => {
    expect(patchSettings).toHaveBeenCalledWith({
      directMessageAutoReplyEnabled: true,
      directMessageAutoReplyText: '新的正文',
    });
  });
});
