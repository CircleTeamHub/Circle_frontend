import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import QrLandingScreen from './QrLandingScreen';
import { approveQrLogin } from '@/services/api/qr-login';
import { resolveQrToken } from '@/services/api/qr';

const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};

// 落地页按 segments 决定往下跳进哪一栈,所以这里得可改。
let mockSegments: string[] = ['(tabs)', 'messages', 'qr'];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ t: 'l'.repeat(32) }),
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
}));

jest.mock('react-i18next', () => {
  const translate = (key: string) => key;
  return { useTranslation: () => ({ t: translate }) };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/theme', () => ({
  Radius: { lg: 12 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  Typography: { small: {}, body: {}, bodyRegular: {}, h2: {} },
  useTheme: () => ({
    colors: {
      background: '#fff',
      surface: '#fff',
      text: '#111',
      textSecondary: '#666',
      primary: '#00f',
      white: '#fff',
    },
  }),
}));

jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/circle-avatar', () => ({ CircleAvatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({
  GroupChatAvatar: () => null,
}));

jest.mock('@/services/api/qr', () => ({
  resolveQrToken: jest.fn(),
  joinByQrToken: jest.fn(),
}));

jest.mock('@/services/api/qr-login', () => ({
  approveQrLogin: jest.fn(),
}));

jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

const loginPreview = {
  type: 'LOGIN' as const,
  targetId: '',
  name: '',
  avatarUrl: null,
  memberCount: null,
  issuerNickname: '',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  viewerState: 'NONE' as const,
  requestDevice: 'Chrome · macOS',
  verificationCode: '123456',
};

const userPreview = {
  type: 'USER' as const,
  targetId: 'u-9',
  name: '小李',
  avatarUrl: null,
  memberCount: null,
  issuerNickname: '',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  viewerState: 'NONE' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSegments = ['(tabs)', 'messages', 'qr'];
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(resolveQrToken).mockResolvedValue(loginPreview);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('shows the verification context and submits login approval only once', async () => {
  let finishApproval!: (value: { ok: boolean }) => void;
  jest.mocked(approveQrLogin).mockImplementation(
    () => new Promise((resolve) => (finishApproval = resolve)),
  );

  render(<QrLandingScreen />);

  expect(await screen.findByText('Chrome · macOS')).toBeTruthy();
  expect(screen.getByText('123456')).toBeTruthy();
  const confirm = screen.getByRole('button');
  fireEvent.press(confirm);
  fireEvent.press(confirm);

  expect(approveQrLogin).toHaveBeenCalledTimes(1);
  expect(approveQrLogin).toHaveBeenCalledWith('l'.repeat(32));

  finishApproval({ ok: true });
  await waitFor(() => {
    expect(Alert.alert).toHaveBeenCalledWith(
      'qr.loginDoneTitle',
      'qr.loginDoneMessage',
      expect.any(Array),
    );
  });
});

// 「从哪进就从哪回」:落地页往下跳必须留在进来的那一栈,否则加完好友返回时用户
// 已经在别的 tab 里,上一层就不再是他出发的那个页面。
test('加好友跳转跟随进入落地页的那一栈，不写死 messages', async () => {
  jest.mocked(resolveQrToken).mockResolvedValue(userPreview);
  mockSegments = ['(tabs)', 'contacts', 'qr'];

  render(<QrLandingScreen />);
  fireEvent.press(await screen.findByRole('button'));

  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: '/(tabs)/contacts/user/[id]/request',
    }),
  );
});

test('顶层 /qr（外部相机深链）没有 tab 段时回落 messages', async () => {
  jest.mocked(resolveQrToken).mockResolvedValue(userPreview);
  mockSegments = ['qr'];

  render(<QrLandingScreen />);
  fireEvent.press(await screen.findByRole('button'));

  expect(mockRouter.push).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: '/(tabs)/messages/user/[id]/request',
    }),
  );
});

test('keeps the confirmation screen recoverable when approval fails', async () => {
  jest.mocked(approveQrLogin).mockRejectedValue(new Error('offline'));
  render(<QrLandingScreen />);

  await screen.findByText('qr.loginConfirm');
  fireEvent.press(screen.getByRole('button'));

  await waitFor(() => {
    expect(Alert.alert).toHaveBeenCalledWith(
      'qr.joinFailedTitle',
      expect.any(String),
    );
  });
  expect(screen.getByText('qr.loginConfirm')).toBeTruthy();
});
