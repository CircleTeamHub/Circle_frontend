import { act, renderHook } from '@testing-library/react-native';
import { useAuth } from './use-auth';
import { fetchCurrentUserWithToken, login as loginRequest } from '@/services/api/auth';
import { clearLocalSession } from '@/services/auth/session';

const mockSetSession = jest.fn();
const mockUpsertAccount = jest.fn();
const mockLoadMessageGroups = jest.fn();
const mockRouterPush = jest.fn();
const mockRouter = { replace: jest.fn(), push: mockRouterPush };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

jest.mock('@/stores/authStore', () => {
  const useAuthStore = (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setSession: mockSetSession,
      isAuthenticated: false,
      isLoading: false,
    });
  useAuthStore.getState = () => ({ user: null });
  return { useAuthStore };
});

jest.mock('@/stores/knownAccountsStore', () => ({
  useKnownAccountsStore: {
    getState: () => ({ upsertAccount: mockUpsertAccount }),
  },
}));

jest.mock('@/stores/accountSwitcherStore', () => ({
  useAccountSwitcherStore: { getState: () => ({ open: jest.fn() }) },
}));

jest.mock('@/features/messages/store/use-message-groups-store', () => ({
  useMessageGroupsStore: {
    getState: () => ({ load: mockLoadMessageGroups }),
  },
}));

jest.mock('@/services/api/auth', () => ({
  fetchCurrentUser: jest.fn(),
  fetchCurrentUserWithToken: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  register: jest.fn(),
}));

jest.mock('@/services/auth/session', () => ({ clearLocalSession: jest.fn() }));
jest.mock('@/services/api/client', () => ({
  isDefinitiveAuthFailure: jest.fn(() => false),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/utils/retry', () => ({ retry: (task: () => Promise<unknown>) => task() }));
jest.mock('@/i18n', () => ({ t: (key: string) => key }));

const tokens = { accessToken: 'access', refreshToken: 'refresh' };
const user = { id: 'user-1', nickname: 'Test User' };

beforeEach(() => {
  jest.clearAllMocks();
});

test('login by user ID runs the normal session finalization path', async () => {
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens });
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue(user as never);
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_123', 'password1');
  });

  expect(loginRequest).toHaveBeenCalledWith({ identifier: 'user_123', password: 'password1' });
  expect(fetchCurrentUserWithToken).toHaveBeenCalledWith('access');
  expect(mockSetSession).toHaveBeenCalledWith(tokens, user, {
    onboardingRequired: false,
  });
  expect(mockUpsertAccount).toHaveBeenCalledWith(
    expect.objectContaining({ user, ...tokens }),
  );
  expect(mockLoadMessageGroups).toHaveBeenCalledTimes(1);
  expect(clearLocalSession).not.toHaveBeenCalled();
});

test('login clears partial credentials and reports failure', async () => {
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens });
  jest
    .mocked(fetchCurrentUserWithToken)
    .mockRejectedValue(new Error('profile unavailable'));
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_123', 'password1');
  });

  expect(clearLocalSession).toHaveBeenCalledTimes(1);
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(result.current.error).toBe('auth.errors.loginFailed');
});

test('an unknown device goes to verification without creating a session', async () => {
  jest.mocked(loginRequest).mockResolvedValue({
    kind: 'deviceVerification',
    challenge: {
      id: 'challenge-1',
      expiresAt: '2026-10-14T00:05:00.000Z',
      securityCodeAvailable: true,
    },
  });
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_123', 'password1');
  });

  expect(mockRouterPush).toHaveBeenCalledWith({
    pathname: '/(auth)/device-verification',
    params: {
      challengeId: 'challenge-1',
      expiresAt: '2026-10-14T00:05:00.000Z',
      securityCode: '1',
    },
  });
  expect(fetchCurrentUserWithToken).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(result.current.error).toBeNull();
});

test('completeVerifiedLogin finalizes the session with the verified tokens', async () => {
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue(user as never);
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.completeVerifiedLogin(tokens);
  });

  expect(mockSetSession).toHaveBeenCalledWith(tokens, user, {
    onboardingRequired: false,
  });
});
