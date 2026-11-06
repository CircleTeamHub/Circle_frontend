import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import PrivacySettingsScreen from './PrivacySettingsScreen';
import {
  fetchPrivacySettings,
  type PrivacySettings,
  type UpdatePrivacySettingsPayload,
  updatePrivacySettings,
} from '@/services/api/privacy';

const mockTranslate = (key: string) => key;
let mockSessionEpoch = 1;
const mockSetBurn = jest.fn();
const mockSetTyping = jest.fn();

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
      viewerSelfDestructSec: 0,
      setViewerSelfDestructSec: mockSetBurn,
      setViewerTypingPolicy: mockSetTyping,
    }),
  },
  viewerTypingPolicyFromPrivacy: (settings: { shareTypingInDirect?: boolean; shareTypingInGroup?: boolean }) => ({
    direct: settings.shareTypingInDirect ?? true, group: settings.shareTypingInGroup ?? true,
  }),
}));
jest.mock('@/components/ui/themed-switch', () => ({ ThemedSwitch: () => null }));
jest.mock('@/components/ui/bottom-sheet-modal', () => ({ BottomSheetModal: () => null }));
jest.mock('@/components/ui/option-picker-sheet', () => {
  const { Pressable: MockPressable, Text: MockText } = jest.requireActual<typeof import('react-native')>('react-native');
  return { OptionPickerSheet: ({ visible, onSelect }: { visible: boolean; onSelect: (value: number) => void }) =>
    visible ? <MockPressable testID="burn-30" onPress={() => onSelect(30)}><MockText>30s</MockText></MockPressable> : null };
});
type MockRow = {
  id: string;
  value?: boolean;
  valueText?: string;
  subtitleKey?: string;
  disabled?: boolean;
  onValueChange?: (value: boolean) => void;
  onPress?: () => void;
};
// 每行画成「当前值|是否可拨」,开关行可按 —— 断言用户首帧看到的到底是哪份设置。
jest.mock('@/features/profile/components/settings-detail', () => {
  const { Pressable: MockPressable, Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SettingsDetailScreen: ({ sections, header, footer }: { sections: { rows: MockRow[] }[]; header?: React.ReactNode; footer?: React.ReactNode }) => <>
      {header}
      {sections.flatMap((section) =>
        section.rows.map((row) => (
          <MockPressable
            key={row.id}
            testID={`row-${row.id}`}
            disabled={row.disabled}
            onPress={() => row.onValueChange ? row.onValueChange(!row.value) : row.onPress?.()}
          >
            <MockText>
              {`${String(row.value ?? row.valueText ?? '')}|${row.disabled ? 'disabled' : 'enabled'}`}
            </MockText>
            {row.subtitleKey ? <MockText>{row.subtitleKey}</MockText> : null}
          </MockPressable>
        )),
      )}
      {footer}
    </>,
  };
});
// 服务端应答。真实 API 层在服务端确认后写展示快照(privacy-settings-cache),
// 屏幕「再进来先画上次的真实设置」读的就是那份快照 —— 替身照做同一步。
const mockServerFetch = jest.fn<Promise<PrivacySettings>, []>();
const mockServerUpdate = jest.fn<Promise<PrivacySettings>, [UpdatePrivacySettingsPayload]>();
jest.mock('@/services/api/privacy', () => {
  const { writePrivacySettingsCache } = jest.requireActual<
    typeof import('@/features/profile/privacy-settings-cache')
  >('@/features/profile/privacy-settings-cache');
  const confirm = async (epoch: number, pending: Promise<PrivacySettings>) => {
    const settings = await pending;
    writePrivacySettingsCache(epoch, settings);
    return settings;
  };
  return {
    fetchPrivacySettings: jest.fn(() => confirm(mockSessionEpoch, mockServerFetch())),
    updatePrivacySettings: jest.fn((payload: UpdatePrivacySettingsPayload) =>
      confirm(mockSessionEpoch, mockServerUpdate(payload))),
  };
});
jest.mock('@/services/api/client', () => ({
  isDefinitiveAuthFailure: () => false,
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/stores/authStore', () => {
  const getState = () => ({ user: { id: 'me' }, sessionEpoch: mockSessionEpoch });
  return {
    useAuthStore: Object.assign(
      (select: (state: ReturnType<typeof getState>) => unknown) => select(getState()),
      { getState },
    ),
  };
});

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
  mockServerFetch.mockResolvedValueOnce(settings);
  const view = render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  return view;
}

beforeEach(() => {
  mockSessionEpoch += 1;
  jest.mocked(fetchPrivacySettings).mockClear();
  jest.mocked(updatePrivacySettings).mockClear();
  mockServerFetch.mockReset();
  mockServerUpdate.mockReset();
  mockSetBurn.mockClear();
  mockSetTyping.mockClear();
});

test('failed loading keeps settings locked and offers a visible retry', async () => {
  mockServerFetch.mockRejectedValueOnce(new Error('offline'));
  render(<PrivacySettingsScreen />);
  await screen.findByText('settingsDetails.privacy.loadFailed');
  expect(rowText('show-phone')).toHaveTextContent('false|disabled');
  mockServerFetch.mockResolvedValueOnce(REAL_SETTINGS);
  fireEvent.press(screen.getByText('common.retry'));
  await waitUntilLoaded();
  expect(rowText('show-phone')).toHaveTextContent('true|enabled');
});

test('saving one toggle explicitly locks controls until it finishes', async () => {
  await visitOnce(REAL_SETTINGS);
  let finish!: (value: PrivacySettings) => void;
  mockServerUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  fireEvent.press(rowText('show-qq'));
  expect(rowText('show-phone')).toHaveTextContent('true|disabled');
  expect(screen.getByTestId('privacy-saving')).toBeTruthy();
  fireEvent.press(rowText('show-phone'));
  expect(updatePrivacySettings).toHaveBeenCalledTimes(1);
  expect(rowText('show-phone')).toHaveTextContent('true|disabled');
  await act(async () => { finish({ ...REAL_SETTINGS, showQQ: false }); });
  expect(rowText('show-phone')).toHaveTextContent('true|enabled');
  expect(mockSetBurn).not.toHaveBeenCalled();
});

test.each(['online-time', 'single-typing', 'group-typing'])('legacy servers mark %s unavailable instead of advertising a working switch', async (id) => {
  await visitOnce(REAL_SETTINGS);
  expect(rowText(id)).toHaveTextContent(/settingsDetails.privacy.unavailable\|disabled/);
  expect(rowText(id)).toHaveTextContent(/settingsDetails.privacy.unsupportedHint/);
  fireEvent.press(rowText(id));
  expect(updatePrivacySettings).not.toHaveBeenCalled();
});

test.each([
  ['online-time', 'shareOnlineStatus'],
  ['single-typing', 'shareTypingInDirect'],
  ['group-typing', 'shareTypingInGroup'],
] as const)('a PATCH omitting %s does not silently confirm consent was saved', async (id, field) => {
  await visitOnce({ ...REAL_SETTINGS, [field]: true });
  mockServerUpdate.mockResolvedValueOnce(REAL_SETTINGS);
  await act(async () => { fireEvent.press(rowText(id)); });
  expect(updatePrivacySettings).toHaveBeenCalledWith({ [field]: false });
  expect(rowText(id)).toHaveTextContent(/settingsDetails.privacy.unavailable\|disabled/);
  expect(screen.getByText('settingsDetails.privacy.saveFailed')).toBeTruthy();
});

test.each(['resolve', 'reject'] as const)('a load that %ss after session replacement cannot update the screen or chat policy', async (result) => {
  let resolve!: (value: PrivacySettings) => void;
  let reject!: (error: Error) => void;
  mockServerFetch.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
  render(<PrivacySettingsScreen />);
  mockSessionEpoch += 1; // Same chat user ID, but the auth session has changed.
  await act(async () => { if (result === 'resolve') resolve(REAL_SETTINGS); else reject(new Error('offline')); });
  expect(rowText('show-phone')).toHaveTextContent('false|disabled');
  expect(screen.queryByText('settingsDetails.privacy.loadFailed')).toBeNull();
  expect(mockSetBurn).not.toHaveBeenCalled();
  expect(mockSetTyping).not.toHaveBeenCalled();
});

test('a confirmed typing save after leaving the screen still updates the live policy and cache', async () => {
  const saved = { ...REAL_SETTINGS, shareTypingInDirect: true };
  const view = await visitOnce(saved);
  mockSetTyping.mockClear();
  let finish!: (value: PrivacySettings) => void;
  mockServerUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  fireEvent.press(rowText('single-typing'));
  view.unmount();
  await act(async () => { finish({ ...saved, shareTypingInDirect: false }); });
  expect(mockSetTyping).toHaveBeenCalledTimes(1);
  expect(mockSetTyping).toHaveBeenCalledWith({ direct: false, group: true });
  mockServerFetch.mockReturnValueOnce(new Promise(() => {}));
  render(<PrivacySettingsScreen />);
  expect(rowText('single-typing')).toHaveTextContent('false|disabled');
});

test('a confirmed burn save after leaving the screen still updates the live policy and cache', async () => {
  const view = await visitOnce(REAL_SETTINGS);
  let finish!: (value: PrivacySettings) => void;
  mockServerUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  fireEvent.press(rowText('self-destruct'));
  fireEvent.press(screen.getByTestId('burn-30'));
  view.unmount();
  await act(async () => { finish({ ...REAL_SETTINGS, messageSelfDestructSec: 30 }); });
  expect(mockSetBurn).toHaveBeenCalledTimes(1);
  expect(mockSetBurn).toHaveBeenCalledWith(30);
  mockServerFetch.mockReturnValueOnce(new Promise(() => {}));
  render(<PrivacySettingsScreen />);
  expect(rowText('self-destruct')).toHaveTextContent('30s|disabled');
});

test.each(['resolve', 'reject'] as const)('a save that %ss after session replacement cannot update the new session', async (result) => {
  await visitOnce(REAL_SETTINGS);
  mockSetTyping.mockClear();
  let resolve!: (value: PrivacySettings) => void;
  let reject!: (error: Error) => void;
  mockServerUpdate.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
  fireEvent.press(rowText('show-phone'));
  mockSessionEpoch += 1;
  await act(async () => { if (result === 'resolve') resolve({ ...REAL_SETTINGS, showPhone: false }); else reject(new Error('offline')); });
  expect(mockSetTyping).not.toHaveBeenCalled();
  expect(mockSetBurn).not.toHaveBeenCalled();
  expect(screen.queryByText('settingsDetails.privacy.saveFailed')).toBeNull();
});

test('changing the burn duration still synchronizes the confirmed policy', async () => {
  await visitOnce(REAL_SETTINGS);
  mockServerUpdate.mockResolvedValueOnce({ ...REAL_SETTINGS, messageSelfDestructSec: 30 });
  fireEvent.press(rowText('self-destruct'));
  await act(async () => { fireEvent.press(screen.getByTestId('burn-30')); });
  expect(updatePrivacySettings).toHaveBeenCalledWith({ messageSelfDestructSec: 30 });
  expect(mockSetBurn).toHaveBeenCalledTimes(1);
  expect(mockSetBurn).toHaveBeenCalledWith(30);
});

test('a second visit draws the last loaded settings, never the defaults', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  mockServerFetch.mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);

  // 首帧就是用户自己的设置;后台重拉回来之前仍不可拨(与首次进入一致)。
  expect(rowText('show-phone')).toHaveTextContent('true|disabled');
  expect(rowText('show-wechat')).toHaveTextContent('false|disabled');
  expect(fetchPrivacySettings).toHaveBeenCalledTimes(2);
});

test('the first visit still starts from the defaults while loading', () => {
  mockServerFetch.mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);

  expect(rowText('show-phone')).toHaveTextContent('false|disabled');
  expect(rowText('show-wechat')).toHaveTextContent('true|disabled');
});

test('a saved toggle is what the next visit draws first', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  mockServerFetch.mockResolvedValueOnce(REAL_SETTINGS);
  mockServerUpdate.mockResolvedValueOnce({
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

  mockServerFetch.mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);
  expect(rowText('show-qq')).toHaveTextContent('false|disabled');
});

test('a failed save does not leave the optimistic value for the next visit', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  mockServerFetch.mockResolvedValueOnce(REAL_SETTINGS);
  mockServerUpdate.mockRejectedValueOnce(new Error('offline'));
  const view = render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  await act(async () => {
    fireEvent.press(rowText('show-qq'));
    await Promise.resolve();
  });
  expect(rowText('show-qq')).toHaveTextContent('true|enabled');
  view.unmount();

  mockServerFetch.mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);
  expect(rowText('show-qq')).toHaveTextContent('true|disabled');
});

test('another account starts from the defaults, not the previous account settings', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();

  mockSessionEpoch += 1;
  mockServerFetch.mockReturnValue(new Promise(() => {}));
  render(<PrivacySettingsScreen />);

  expect(rowText('show-phone')).toHaveTextContent('false|disabled');
  expect(rowText('show-wechat')).toHaveTextContent('true|disabled');
});

test('direct group joining is off for legacy settings and saves only explicit opt-in', async () => {
  (await visitOnce(REAL_SETTINGS)).unmount();
  mockServerFetch.mockResolvedValueOnce(REAL_SETTINGS);
  mockServerUpdate.mockResolvedValueOnce({
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
  mockServerFetch.mockResolvedValueOnce(saved);
  mockServerUpdate.mockRejectedValueOnce(new Error('offline'));
  render(<PrivacySettingsScreen />);
  await waitUntilLoaded();
  expect(rowText('friend-group-direct-join')).toHaveTextContent('true|enabled');
  await act(async () => { fireEvent.press(rowText('friend-group-direct-join')); });
  expect(updatePrivacySettings).toHaveBeenCalledWith({ allowFriendGroupDirectJoin: false });
  expect(rowText('friend-group-direct-join')).toHaveTextContent('true|enabled');
});
