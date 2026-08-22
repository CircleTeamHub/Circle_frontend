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

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ t: 'l'.repeat(32) }),
  useRouter: () => mockRouter,
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

beforeEach(() => {
  jest.clearAllMocks();
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
