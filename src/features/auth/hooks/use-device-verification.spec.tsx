import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useDeviceVerification } from './use-device-verification';
import {
  fetchLoginChallengeStatus,
  requestLoginRecovery,
  resendLoginChallenge,
  verifyLoginChallengeCode,
} from '@/services/api/auth';
import { ApiError } from '@/services/api/api-error';

jest.mock('@/services/api/auth', () => ({
  fetchLoginChallengeStatus: jest.fn(),
  requestLoginRecovery: jest.fn(),
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
    recoveryAvailableAt: null,
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

test('retries session completion with retained tokens instead of consuming the code again', async () => {
  jest.mocked(verifyLoginChallengeCode).mockResolvedValue(tokens);
  const complete = jest.fn().mockRejectedValueOnce(new Error('bootstrap')).mockResolvedValueOnce(undefined);
  const { result } = renderHook(() => useDeviceVerification({ challengeId: 'c1', expiresAt: inFiveMinutes(), onVerified: complete }));
  await act(async () => result.current.submitCode('123456'));
  expect(result.current.completionPending).toBe(true);
  await act(async () => result.current.submitCode('123456'));
  expect(verifyLoginChallengeCode).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete).toHaveBeenLastCalledWith(tokens);
});

test('does not overlap slow status polls', async () => {
  jest.useFakeTimers();
  let resolve!: (value: any) => void;
  jest.mocked(fetchLoginChallengeStatus).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { result, unmount } = renderHook(() => useDeviceVerification({ challengeId: 'c', expiresAt: new Date(Date.now() + 300000).toISOString(), onVerified: jest.fn() }));
  await act(async () => { jest.advanceTimersByTime(9000); });
  expect(fetchLoginChallengeStatus).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ status: 'APPROVED', expiresAt: new Date(Date.now() + 300000).toISOString(), codeExpiresAt: new Date(Date.now() + 60000).toISOString() }));
  expect(result.current.phase).toBe('approved');
  unmount(); jest.useRealTimers();
});

describe('recovery (no trusted device available)', () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  test('requesting recovery switches to the waiting view with the completion time', async () => {
    const availableAt = inHours(24);
    jest.mocked(requestLoginRecovery).mockResolvedValue({
      id: 'c1',
      expiresAt: inHours(24 * 8),
      securityCodeAvailable: false,
      recoveryAvailableAt: availableAt,
    });
    const { result } = renderHook(() =>
      useDeviceVerification({ challengeId: 'c1', expiresAt: inFiveMinutes(), onVerified: jest.fn() }),
    );
    await waitFor(() => expect(result.current.phase).toBe('waiting'));

    await act(async () => {
      await result.current.requestRecovery();
    });

    expect(requestLoginRecovery).toHaveBeenCalledWith('c1');
    expect(result.current.phase).toBe('recoveryWaiting');
    expect(result.current.recoveryAvailableAt).toBe(Date.parse(availableAt));
    // 倒计时按等待期算，而不是 5 分钟的批准窗口。
    expect(result.current.remainingSeconds).toBeGreaterThan(23 * 3600);
  });

  test('a pending recovery whose waiting period passed asks to sign in again', async () => {
    const past = new Date(Date.now() - 1_000).toISOString();
    jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({
      status: 'PENDING',
      expiresAt: inHours(24 * 7),
      codeExpiresAt: null,
      recoveryAvailableAt: past,
    });
    const { result } = renderHook(() =>
      useDeviceVerification({
        challengeId: 'c1',
        expiresAt: inHours(24 * 7),
        recoveryAvailableAt: past,
        onVerified: jest.fn(),
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe('recoveryReady'));
  });

  test('if a trusted device approves during the wait, the code can be entered right away', async () => {
    jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({
      status: 'APPROVED',
      expiresAt: inHours(24 * 7),
      codeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      recoveryAvailableAt: inHours(20),
    });
    const { result } = renderHook(() =>
      useDeviceVerification({
        challengeId: 'c1',
        expiresAt: inHours(24 * 7),
        recoveryAvailableAt: inHours(20),
        onVerified: jest.fn(),
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe('approved'));
  });

  test('a recovery declined by a trusted device ends the flow', async () => {
    jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({
      status: 'REJECTED',
      expiresAt: inHours(24 * 7),
      codeExpiresAt: null,
      recoveryAvailableAt: inHours(20),
    });
    const { result } = renderHook(() =>
      useDeviceVerification({
        challengeId: 'c1',
        expiresAt: inHours(24 * 7),
        recoveryAvailableAt: inHours(20),
        onVerified: jest.fn(),
      }),
    );

    await waitFor(() => expect(result.current.phase).toBe('rejected'));
  });
});

test('resending an expired recovery clears its previous completion time', async () => {
 jest.mocked(fetchLoginChallengeStatus).mockResolvedValue({status: 'PENDING', expiresAt: inFiveMinutes(), codeExpiresAt: null, recoveryAvailableAt: null});
 jest.mocked(resendLoginChallenge).mockResolvedValue({id: 'c2', expiresAt: inFiveMinutes(), securityCodeAvailable: false, recoveryAvailableAt: null});
 const {result} = renderHook(() => useDeviceVerification({challengeId:'c1', expiresAt: new Date(Date.now()-1000).toISOString(), recoveryAvailableAt: new Date(Date.now()-2000).toISOString(), onVerified: jest.fn()}));
 expect(result.current.phase).toBe('expired');
 await act(async () => { await result.current.resend(); });
 expect(result.current.phase).toBe('waiting');
 expect(result.current.recoveryAvailableAt).toBeNull();
});
