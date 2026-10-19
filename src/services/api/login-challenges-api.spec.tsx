import {
  approveLoginChallenge,
  fetchPendingLoginChallenges,
  rejectLoginChallenge,
  requestLoginRecovery,
} from './auth';
import { apiClient, refreshSessionAccessToken } from '@/services/api/client';

jest.mock('@/services/api/client', () => ({
  apiClient: jest.fn(),
  refreshSessionAccessToken: jest.fn(() => Promise.resolve('fresh-token')),
}));
jest.mock('expo-device', () => ({ modelName: 'iPhone', osName: 'iOS' }));
jest.mock('@/services/api/utils', () => ({ normalizeUser: (u: unknown) => u }));

const unbound = Object.assign(new Error('unbound'), {
  errorCode: 'AUTH_SESSION_DEVICE_UNBOUND',
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('a pre-rollout session refreshes once (binding this device) and retries the pending list', async () => {
  jest
    .mocked(apiClient)
    .mockRejectedValueOnce(unbound)
    .mockResolvedValueOnce([{ id: 'c1' }]);

  await expect(fetchPendingLoginChallenges()).resolves.toEqual([{ id: 'c1' }]);
  expect(refreshSessionAccessToken).toHaveBeenCalledTimes(1);
  expect(apiClient).toHaveBeenCalledTimes(2);
});

test('approve and reject get the same one-shot refresh and retry', async () => {
  jest
    .mocked(apiClient)
    .mockRejectedValueOnce(unbound)
    .mockResolvedValueOnce({ code: '123456', codeExpiresAt: 'x' })
    .mockRejectedValueOnce(unbound)
    .mockResolvedValueOnce(undefined);

  await expect(approveLoginChallenge('c1')).resolves.toEqual({
    code: '123456',
    codeExpiresAt: 'x',
  });
  await expect(rejectLoginChallenge('c1')).resolves.toBeUndefined();
  expect(refreshSessionAccessToken).toHaveBeenCalledTimes(2);
});

test('other errors are not retried and do not refresh', async () => {
  const other = Object.assign(new Error('nope'), { errorCode: 'AUTH_DEVICE_NOT_TRUSTED' });
  jest.mocked(apiClient).mockRejectedValueOnce(other);

  await expect(fetchPendingLoginChallenges()).rejects.toBe(other);
  expect(refreshSessionAccessToken).not.toHaveBeenCalled();
  expect(apiClient).toHaveBeenCalledTimes(1);
});

test('a second unbound answer after the refresh surfaces as an error instead of looping', async () => {
  jest.mocked(apiClient).mockRejectedValue(unbound);

  await expect(fetchPendingLoginChallenges()).rejects.toBe(unbound);
  expect(refreshSessionAccessToken).toHaveBeenCalledTimes(1);
  expect(apiClient).toHaveBeenCalledTimes(2);
});

test('requesting recovery returns the challenge with its completion time', async () => {
  jest.mocked(apiClient).mockResolvedValueOnce({
    deviceVerificationRequired: true,
    challenge: {
      id: 'c1',
      expiresAt: '2026-10-26T00:00:00.000Z',
      securityCodeAvailable: false,
      recoveryAvailableAt: '2026-10-19T00:00:00.000Z',
    },
  });

  await expect(requestLoginRecovery('c1')).resolves.toEqual({
    id: 'c1',
    expiresAt: '2026-10-26T00:00:00.000Z',
    securityCodeAvailable: false,
    recoveryAvailableAt: '2026-10-19T00:00:00.000Z',
  });
  expect(apiClient).toHaveBeenCalledWith(
    '/auth/login-challenges/c1/recovery',
    { method: 'POST', auth: false },
  );
});

 test.each([undefined, null, 'invalid'])('recovery rejects invalid completion timestamp %s', async (recoveryAvailableAt) => {
 jest.mocked(apiClient).mockResolvedValueOnce({deviceVerificationRequired: true, challenge: { id: 'c1', expiresAt: '2026-10-26T00:00:00.000Z', securityCodeAvailable: false, recoveryAvailableAt }});
 await expect(requestLoginRecovery('c1')).rejects.toThrow('认证返回数据格式异常');
 });
