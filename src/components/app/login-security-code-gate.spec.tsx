import { act, render, waitFor } from '@testing-library/react-native';
import { LoginSecurityCodeGate } from './login-security-code-gate';
import { fetchLoginSecurityCodeStatus } from '@/services/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { useLoginApprovalStore } from '@/features/security/store/login-approval-store';

jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  const useAuthStore = create(() => ({
    isAuthenticated: true,
    isLoading: false,
    onboardingRequired: false,
    user: { id: 'A' } as { id: string } | null,
  }));
  return { useAuthStore };
});
jest.mock('@/services/api/auth', () => ({
  fetchLoginSecurityCodeStatus: jest.fn(),
  verifyLoginSecurityCode: jest.fn(),
  fetchPendingLoginChallenges: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/realtime/client', () => ({ setLoginChallengeListener: jest.fn() }));
jest.mock('@/services/auth/session', () => ({ clearLocalSession: jest.fn() }));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('@/storage', () => ({
  storage: { getString: jest.fn(), set: jest.fn() },
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  useLoginApprovalStore.setState({ appLocked: true });
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    onboardingRequired: false,
    user: { id: 'A' } as never,
  });
});

test('the approval prompt stays blocked until the lock status of the current account is known', async () => {
  const statusA = deferred<{ enabled: boolean }>();
  jest.mocked(fetchLoginSecurityCodeStatus).mockReturnValueOnce(statusA.promise);
  render(<LoginSecurityCodeGate />);

  expect(useLoginApprovalStore.getState().appLocked).toBe(true);
  await act(async () => statusA.resolve({ enabled: false }));
  await waitFor(() => expect(useLoginApprovalStore.getState().appLocked).toBe(false));
});

test('switching to another account re-blocks the prompt until that account’s lock status arrives', async () => {
  jest.mocked(fetchLoginSecurityCodeStatus).mockResolvedValueOnce({ enabled: false });
  render(<LoginSecurityCodeGate />);
  await waitFor(() => expect(useLoginApprovalStore.getState().appLocked).toBe(false));

  const statusB = deferred<{ enabled: boolean }>();
  jest.mocked(fetchLoginSecurityCodeStatus).mockReturnValueOnce(statusB.promise);
  // switchToAccount：先清会话，再落新账号。
  act(() => useAuthStore.setState({ isAuthenticated: false, user: null }));
  act(() => useAuthStore.setState({ isAuthenticated: true, user: { id: 'B' } as never }));

  // B 的安全码状态还没回来：批准弹窗必须挡住。
  expect(useLoginApprovalStore.getState().appLocked).toBe(true);

  await act(async () => statusB.resolve({ enabled: true }));
  // B 开了安全码：锁屏出现，批准弹窗继续挡住。
  expect(useLoginApprovalStore.getState().appLocked).toBe(true);
});
