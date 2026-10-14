import { useAuthStore } from '@/stores/authStore';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useLoginApproval } from './use-login-approval';
import {
  approveLoginChallenge,
  fetchPendingLoginChallenges,
  rejectLoginChallenge,
} from '@/services/api/auth';
import { useLoginApprovalStore } from '@/features/security/store/login-approval-store';

jest.mock('@/services/api/auth', () => ({
  approveLoginChallenge: jest.fn(),
  fetchPendingLoginChallenges: jest.fn(),
  rejectLoginChallenge: jest.fn(),
}));
jest.mock('@/realtime/client', () => ({ setLoginChallengeListener: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return { useAuthStore: create(() => ({ isAuthenticated: true, onboardingRequired: false, sessionEpoch: 1 })) };
});

const challenge = {
  id: 'c1',
  deviceName: 'Pixel 9',
  ip: '203.0.113.7',
  userAgent: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  status: 'PENDING' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  AppState.currentState = 'active';
  useAuthStore.setState({ sessionEpoch: 1 });
  useLoginApprovalStore.setState({
    pending: [],
    appLocked: false,
    consumedId: null,
    handledIds: [],
  });
  jest.mocked(fetchPendingLoginChallenges).mockResolvedValue([challenge]);
});

test('asks about a pending login and shows the code after approval', async () => {
  jest.mocked(approveLoginChallenge).mockResolvedValue({
    code: '482913',
    codeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const { result } = renderHook(() => useLoginApproval());
  await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));

  act(() => result.current.approve());

  await waitFor(() => expect(result.current.stage?.kind).toBe('code'));
  expect(result.current.stage).toEqual(
    expect.objectContaining({ code: '482913', challengeId: 'c1' }),
  );
  expect(result.current.codeSecondsLeft).toBeGreaterThan(55);
});

test('the code panel closes once the new device has signed in', async () => {
  jest.mocked(approveLoginChallenge).mockResolvedValue({
    code: '482913',
    codeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const { result } = renderHook(() => useLoginApproval());
  await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));
  act(() => result.current.approve());
  await waitFor(() => expect(result.current.stage?.kind).toBe('code'));

  act(() => useLoginApprovalStore.getState().markResolved('c1', 'CONSUMED'));

  await waitFor(() => expect(result.current.stage).toBeNull());
});

test('rejecting suggests changing the password', async () => {
  jest.mocked(rejectLoginChallenge).mockResolvedValue(undefined);
  const { result } = renderHook(() => useLoginApproval());
  await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));

  await act(async () => {
    await result.current.reject();
  });

  expect(rejectLoginChallenge).toHaveBeenCalledWith('c1');
  expect(result.current.stage).toEqual({ kind: 'rejected' });
});

test('stays hidden while the app lock is engaged', async () => {
  useLoginApprovalStore.setState({ appLocked: true });
  const { result } = renderHook(() => useLoginApproval());
  await waitFor(() => expect(fetchPendingLoginChallenges).toHaveBeenCalled());
  expect(result.current.stage).toBeNull();
});

test('another device handling the request dismisses the prompt here', async () => {
  const { result } = renderHook(() => useLoginApproval());
  await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));

  act(() => useLoginApprovalStore.getState().markResolved('c1', 'APPROVED'));

  expect(result.current.stage).toBeNull();
});

test('a late list response does not bring back a request already handled', async () => {
  let resolveLate: (value: (typeof challenge)[]) => void = () => undefined;
  jest
    .mocked(fetchPendingLoginChallenges)
    .mockReturnValueOnce(new Promise((resolve) => (resolveLate = resolve)));
  const { result } = renderHook(() => useLoginApproval());

  act(() => useLoginApprovalStore.getState().markResolved('c1', 'REJECTED'));
  await act(async () => resolveLate([challenge]));

  expect(result.current.stage).toBeNull();
});

test('an ask disappears by itself once it expires', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(fetchPendingLoginChallenges).mockResolvedValue([
      { ...challenge, expiresAt: new Date(Date.now() + 2_000).toISOString() },
    ]);
    const { result } = renderHook(() => useLoginApproval());
    await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));

    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    expect(result.current.stage).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('a pending-list request from the previous account is dropped after reset', async () => {
  let resolveOld: (value: (typeof challenge)[]) => void = () => undefined;
  jest
    .mocked(fetchPendingLoginChallenges)
    .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
    .mockResolvedValueOnce([]);
  const store = useLoginApprovalStore.getState();

  void store.refresh();
  store.reset();
  await act(async () => {
    await useLoginApprovalStore.getState().refresh();
  });
  // 新账号自己发了请求，没有复用旧账号那个。
  expect(fetchPendingLoginChallenges).toHaveBeenCalledTimes(2);

  await act(async () => resolveOld([challenge]));
  expect(useLoginApprovalStore.getState().pending).toEqual([]);
});


test('the approval code is hidden on background even without a security-code lock', async () => {
  let change!: (state: AppStateStatus) => void;
  const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => { change = listener; return { remove: jest.fn() }; });
  jest.mocked(approveLoginChallenge).mockResolvedValue({ code: '482913', codeExpiresAt: new Date(Date.now() + 60000).toISOString() });
  try {
    const { result } = renderHook(() => useLoginApproval());
    await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));
    await act(async () => result.current.approve());
    expect(result.current.stage?.kind).toBe('code');
    act(() => change('inactive'));
    expect(result.current.stage).toBeNull();
    act(() => change('background'));
    expect(result.current.stage).toBeNull();
    await act(async () => change('active'));
    expect(result.current.stage?.kind).toBe('code');
  } finally { subscription.mockRestore(); }
});

test('discards approval codes after switching accounts', async () => {
  let resolve!: (value: { code: string; codeExpiresAt: string }) => void;
  jest.mocked(approveLoginChallenge).mockReturnValue(new Promise((done) => { resolve = done; }));
  const { result } = renderHook(() => useLoginApproval());
  await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));
  act(() => result.current.approve());
  act(() => useAuthStore.setState({ sessionEpoch: 2 }));
  await act(async () => resolve({ code: '123456', codeExpiresAt: new Date(Date.now() + 60000).toISOString() }));
  expect(result.current.stage?.kind).not.toBe('code');
  expect(result.current.busy).toBe(false);
});

test('refreshes a stale request after a rejected rejection', async () => {
  jest.mocked(rejectLoginChallenge).mockRejectedValue(new Error('already handled'));
  const { result } = renderHook(() => useLoginApproval());
  await waitFor(() => expect(result.current.stage?.kind).toBe('ask'));
  jest.mocked(fetchPendingLoginChallenges).mockResolvedValue([]);
  await act(async () => result.current.reject());
  await waitFor(() => expect(result.current.stage).toBeNull());
});
