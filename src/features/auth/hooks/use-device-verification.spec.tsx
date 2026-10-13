import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useDeviceVerification } from './use-device-verification';
import {
  fetchLoginChallengeStatus,
  resendLoginChallenge,
  verifyLoginChallengeCode,
} from '@/services/api/auth';
import { ApiError } from '@/services/api/api-error';

jest.mock('@/services/api/auth', () => ({
  fetchLoginChallengeStatus: jest.fn(),
  resendLoginChallenge: jest.fn(),
  verifyLoginChallengeCode: jest.fn(),
  verifyLoginChallengeSecurityCode: jest.fn(),
}));
jest.mock('@/i18n', () => ({ t: (key: string) => key }));

const inFiveMinutes = () => new Date(Date.now() + 300_000).toISOString();
const tokens = { accessToken: 'a', refreshToken: 'r' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({
    status: 'PENDING',
    expiresAt: inFiveMinutes(),
    codeExpiresAt: null,
  });
});

test('waits for the trusted device, then shows the approved code window', async () => {
  const onVerified = jest.fn();
  const { result } = renderHook(() =>
    useDeviceVerification({ challengeId: 'c1', expiresAt: inFiveMinutes(), onVerified }),
  );
  await waitFor(() => expect(fetchLoginChallengeStatus).toHaveBeenCalledWith('c1'));
  expect(result.current.phase).toBe('waiting');

  jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({
    status: 'APPROVED',
    expiresAt: inFiveMinutes(),
    codeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const view = renderHook(() =>
    useDeviceVerification({ challengeId: 'c1', expiresAt: inFiveMinutes(), onVerified }),
  );
  await waitFor(() => expect(view.result.current.phase).toBe('approved'));
  expect(view.result.current.remainingSeconds).toBeLessThanOrEqual(60);
});

test('a correct code hands the tokens to the login finalizer', async () => {
  jest.mocked(verifyLoginChallengeCode).mockResolvedValue(tokens);
  const onVerified = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useDeviceVerification({ challengeId: 'c1', expiresAt: inFiveMinutes(), onVerified }),
  );

  await act(async () => {
    await result.current.submitCode(' 123456 ');
  });

  expect(verifyLoginChallengeCode).toHaveBeenCalledWith('c1', '123456');
  expect(onVerified).toHaveBeenCalledWith(tokens);
});

test('a rejection from the trusted device ends the flow', async () => {
  jest
    .mocked(verifyLoginChallengeCode)
    .mockRejectedValue(
      new ApiError('rejected', { status: 403, errorCode: 'AUTH_LOGIN_CHALLENGE_REJECTED' }),
    );
  const onVerified = jest.fn();
  const { result } = renderHook(() =>
    useDeviceVerification({ challengeId: 'c1', expiresAt: inFiveMinutes(), onVerified }),
  );

  await act(async () => {
    await result.current.submitCode('123456');
  });

  expect(result.current.phase).toBe('rejected');
  expect(onVerified).not.toHaveBeenCalled();
});

test('an expired request can be resent and returns to waiting', async () => {
  const past = new Date(Date.now() - 1_000).toISOString();
  jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({
    status: 'EXPIRED',
    expiresAt: past,
    codeExpiresAt: null,
  });
  jest.mocked(resendLoginChallenge).mockResolvedValue({
    id: 'c2',
    expiresAt: inFiveMinutes(),
    securityCodeAvailable: false,
  });
  const { result } = renderHook(() =>
    useDeviceVerification({ challengeId: 'c1', expiresAt: past, onVerified: jest.fn() }),
  );
  await waitFor(() => expect(result.current.phase).toBe('expired'));

  jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({
    status: 'PENDING',
    expiresAt: inFiveMinutes(),
    codeExpiresAt: null,
  });
  await act(async () => {
    await result.current.resend();
  });

  expect(resendLoginChallenge).toHaveBeenCalledWith('c1');
  await waitFor(() => expect(fetchLoginChallengeStatus).toHaveBeenCalledWith('c2'));
  expect(result.current.phase).toBe('waiting');
});
