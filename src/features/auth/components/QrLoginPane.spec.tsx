import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { QrLoginPane } from './QrLoginPane';
import {
  createQrLoginSession,
  pollQrLoginStatus,
} from '@/services/api/qr-login';

jest.mock('react-native-qrcode-svg', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return function MockQrCode() {
    return <View testID="qr-code" />;
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/theme', () => ({
  Radius: { md: 8, lg: 12 },
  Spacing: { xs: 4, md: 12, lg: 16 },
  Typography: { small: {}, body: {}, bodyRegular: {}, h2: {} },
  useTheme: () => ({
    colors: {
      primary: '#00f',
      text: '#111',
      textSecondary: '#666',
      white: '#fff',
    },
  }),
}));

jest.mock('@/services/api/qr-login', () => ({
  createQrLoginSession: jest.fn(),
  pollQrLoginStatus: jest.fn(),
}));

const session = {
  qrToken: 'q'.repeat(32),
  pollKey: 'p'.repeat(32),
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  requestDevice: 'Chrome · macOS',
  verificationCode: '123456',
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(createQrLoginSession).mockResolvedValue(session);
});

afterEach(() => {
  jest.useRealTimers();
});

test('shows a recoverable failure when token finalization rejects', async () => {
  jest.mocked(pollQrLoginStatus).mockResolvedValue({
    status: 'APPROVED',
    tokens: { accessToken: 'access', refreshToken: 'refresh' },
  });
  const onTokens = jest.fn().mockRejectedValue(new Error('finalization failed'));

  render(<QrLoginPane onTokens={onTokens} />);

  await waitFor(() => expect(screen.getByTestId('qr-code')).toBeTruthy());

  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(screen.getByText('auth.qrLoginFailed')).toBeTruthy();
    expect(screen.getByText('auth.qrLoginRefresh')).toBeTruthy();
    expect(screen.queryByTestId('qr-code')).toBeNull();
  });
});

test('keeps polling through PENDING and finalizes APPROVED tokens once', async () => {
  jest
    .mocked(pollQrLoginStatus)
    .mockResolvedValueOnce({ status: 'PENDING' })
    .mockResolvedValueOnce({
      status: 'APPROVED',
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    });
  const onTokens = jest.fn().mockResolvedValue(true);

  render(<QrLoginPane onTokens={onTokens} />);
  await waitFor(() => expect(screen.getByTestId('qr-code')).toBeTruthy());

  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });
  expect(onTokens).not.toHaveBeenCalled();
  expect(screen.getByTestId('qr-code')).toBeTruthy();

  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });
  await waitFor(() => expect(onTokens).toHaveBeenCalledTimes(1));
  expect(pollQrLoginStatus).toHaveBeenCalledTimes(2);

  await act(async () => {
    jest.advanceTimersByTime(8_000);
    await Promise.resolve();
  });
  expect(onTokens).toHaveBeenCalledTimes(1);
});

test('shows the refresh path when the server reports EXPIRED', async () => {
  jest.mocked(pollQrLoginStatus).mockResolvedValue({ status: 'EXPIRED' });

  render(<QrLoginPane onTokens={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('qr-code')).toBeTruthy());

  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByText('auth.qrLoginExpired')).toBeTruthy();
    expect(screen.getByText('auth.qrLoginRefresh')).toBeTruthy();
    expect(screen.queryByTestId('qr-code')).toBeNull();
  });
});

test('does not overlap polling requests and resumes after the pending one settles', async () => {
  let resolvePoll!: (value: { status: 'PENDING' }) => void;
  jest.mocked(pollQrLoginStatus).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
  );

  render(<QrLoginPane onTokens={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('qr-code')).toBeTruthy());

  await act(async () => {
    jest.advanceTimersByTime(8_000);
    await Promise.resolve();
  });
  expect(pollQrLoginStatus).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolvePoll({ status: 'PENDING' });
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });
  expect(pollQrLoginStatus).toHaveBeenCalledTimes(2);
});

test('expires locally even when an in-flight poll never settles', async () => {
  jest.mocked(createQrLoginSession).mockResolvedValue({
    ...session,
    expiresAt: new Date(Date.now() + 5_000).toISOString(),
  });
  jest.mocked(pollQrLoginStatus).mockImplementation(() => new Promise(() => {}));

  render(<QrLoginPane onTokens={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('qr-code')).toBeTruthy());

  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });
  expect(pollQrLoginStatus).toHaveBeenCalledTimes(1);

  await act(async () => {
    jest.advanceTimersByTime(4_000);
    await Promise.resolve();
  });
  expect(screen.getByText('auth.qrLoginExpired')).toBeTruthy();
  expect(screen.getByText('auth.qrLoginRefresh')).toBeTruthy();
  expect(screen.queryByTestId('qr-code')).toBeNull();
});
