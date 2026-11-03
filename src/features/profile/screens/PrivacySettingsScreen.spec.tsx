import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import PrivacySettingsScreen from './PrivacySettingsScreen';
import {
  fetchPrivacySettings,
  type PrivacySettings,
  updatePrivacySettings,
} from '@/services/api/privacy';

const mockTranslate = (key: string) => key;
let mockSessionEpoch = 1;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('@/theme', () => ({
  Radius: { full: 999, xl: 18 },
  Spacing: { xs: 4, md: 8, lg: 16 },
  Typography: { h3: {}, body: {}, caption: {} },
  useTheme: () => ({
    colors: {
      error: '#f00', surface: '#fff', surfaceBorder: '#ddd', text: '#111',
      textSecondary: '#666', primary: '#00f', overlay: '#0008',
    },
  }),
}));
jest.mock('@/chat-core/burn-durations', () => ({
  BURN_DURATION_CHOICES: [0, 30],
  BURN_DURATION_OFF: 0,
  formatBurnDuration: (value: number) => `${value}s`,
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: {
    getState: () => ({
      currentUserId: 'me',
      setViewerSelfDestructSec: () => undefined,
      setViewerTypingPolicy: () => undefined,
    }),
  },
  viewerTypingPolicyFromPrivacy: () => ({ direct: true, group: true }),
}));
jest.mock('@/components/ui/themed-switch', () => ({ ThemedSwitch: () => null }));
jest.mock('@/components/ui/bottom-sheet-modal', () => ({ BottomSheetModal: () => null }));
jest.mock('@/components/ui/option-picker-sheet', () => ({ OptionPickerSheet: () => null }));
type MockRow = {
  id: string;
  value?: boolean;
  valueText?: string;
  disabled?: boolean;
  onValueChange?: (value: boolean) => void;
};
// 每行画成「当前值|是否可拨」,开关行可按 —— 断言用户首帧看到的到底是哪份设置。
jest.mock('@/features/profile/components/settings-detail', () => {
  const { Pressable: MockPressable, Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SettingsDetailScreen: ({ sections }: { sections: { rows: MockRow[] }[] }) =>
      sections.flatMap((section) =>
        section.rows.map((row) => (
          <MockPressable
            key={row.id}
            testID={`row-${row.id}`}
            onPress={() => row.onValueChange?.(!row.value)}
          >
            <MockText>
              {`${String(row.value ?? row.valueText ?? '')}|${row.disabled ? 'disabled' : 'enabled'}`}
            </MockText>
          </MockPressable>
        )),
      ),
  };
});
jest.mock('@/services/api/privacy', () => ({
  fetchPrivacySettings: jest.fn(),
  updatePrivacySettings: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: { sessionEpoch: number }) => unknown) =>
    select({ sessionEpoch: mockSessionEpoch }),
}));

// 刻意与默认值相反:默认 showPhone=false、showWechat=true。
const REAL_SETTINGS: PrivacySettings = {
  messageSelfDestructSec: 0,
  momentsVisibility: 'ALL',
  allowStrangerMessages: true,
  showPhone: true,
  showEmail: false,
  showWechat: false,
  showQQ: true,
  showWhatsup: true,
  addMeByAccount: true,
  addMeByPhone: false,
  addMeByQrCode: true,
  addMeByGroup: true,
  callPermission: 'EVERYONE',
  groupInvitePermission: 'EVERYONE',
};

function rowText(id: string) {
  return screen.getByTestId(`row-${id}`);
}

async function waitUntilLoaded() {
  await waitFor(() =>
    expect(rowText('show-phone')).toHaveTextContent(/\|enabled$/),
  );
}

async function visitOnce(settings: PrivacySettings) {
  jest.mocked(fetchPrivacySettings).mockResolvedValueOnce(settings);
  const view = render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  return view;
}

beforeEach(() => {
  mockSessionEpoch += 1;
  jest.mocked(fetchPrivacySettings).mockReset();
  jest.mocked(updatePrivacySettings).mockReset();
});

test('a second visit draws the last loaded settings, never the defaults', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  jest.mocked(fetchPrivacySettings).mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);

  // 首帧就是用户自己的设置;后台重拉回来之前仍不可拨(与首次进入一致)。
  expect(rowText('show-phone')).toHaveTextContent('true|disabled');
  expect(rowText('show-wechat')).toHaveTextContent('false|disabled');
  expect(fetchPrivacySettings).toHaveBeenCalledTimes(2);
});

test('the first visit still starts from the defaults while loading', () => {
  jest.mocked(fetchPrivacySettings).mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);

  expect(rowText('show-phone')).toHaveTextContent('false|disabled');
  expect(rowText('show-wechat')).toHaveTextContent('true|disabled');
});

test('a saved toggle is what the next visit draws first', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  jest.mocked(fetchPrivacySettings).mockResolvedValueOnce(REAL_SETTINGS);
  jest.mocked(updatePrivacySettings).mockResolvedValueOnce({
    ...REAL_SETTINGS,
    showQQ: false,
  });
  const view = render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  expect(rowText('show-qq')).toHaveTextContent('true|enabled');
  await act(async () => {
    fireEvent.press(rowText('show-qq'));
    await Promise.resolve();
  });
  expect(updatePrivacySettings).toHaveBeenCalledWith({ showQQ: false });
  expect(rowText('show-qq')).toHaveTextContent('false|enabled');
  view.unmount();

  jest.mocked(fetchPrivacySettings).mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);
  expect(rowText('show-qq')).toHaveTextContent('false|disabled');
});

test('a failed save does not leave the optimistic value for the next visit', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  jest.mocked(fetchPrivacySettings).mockResolvedValueOnce(REAL_SETTINGS);
  jest.mocked(updatePrivacySettings).mockRejectedValueOnce(new Error('offline'));
  const view = render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  await act(async () => {
    fireEvent.press(rowText('show-qq'));
    await Promise.resolve();
  });
  expect(rowText('show-qq')).toHaveTextContent('true|enabled');
  view.unmount();

  jest.mocked(fetchPrivacySettings).mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);
  expect(rowText('show-qq')).toHaveTextContent('true|disabled');
});

test('another account starts from the defaults, not the previous account settings', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  mockSessionEpoch += 1;
  jest.mocked(fetchPrivacySettings).mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);

  expect(rowText('show-phone')).toHaveTextContent('false|disabled');
  expect(rowText('show-wechat')).toHaveTextContent('true|disabled');
});

test('direct group joining is off for legacy settings and saves only explicit opt-in', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();
  jest.mocked(fetchPrivacySettings).mockResolvedValueOnce(REAL_SETTINGS);
  jest.mocked(updatePrivacySettings).mockResolvedValueOnce({
    ...REAL_SETTINGS, allowFriendGroupDirectJoin: true,
  } as PrivacySettings);
  render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  expect(rowText('friend-group-direct-join')).toHaveTextContent('false|enabled');
  await act(async () => { fireEvent.press(rowText('friend-group-direct-join')); });
  expect(updatePrivacySettings).toHaveBeenCalledWith({ allowFriendGroupDirectJoin: true });
  expect(rowText('friend-group-direct-join')).toHaveTextContent('true|enabled');
});

test('failed direct-join consent changes restore the previous saved choice', async () => {
  const saved = { ...REAL_SETTINGS, allowFriendGroupDirectJoin: true } as PrivacySettings;
  jest.mocked(fetchPrivacySettings).mockResolvedValueOnce(saved);
  jest.mocked(updatePrivacySettings).mockRejectedValueOnce(new Error('offline'));
  render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  expect(rowText('friend-group-direct-join')).toHaveTextContent('true|enabled');
  await act(async () => { fireEvent.press(rowText('friend-group-direct-join')); });
  expect(updatePrivacySettings).toHaveBeenCalledWith({ allowFriendGroupDirectJoin: false });
  expect(rowText('friend-group-direct-join')).toHaveTextContent('true|enabled');
});
