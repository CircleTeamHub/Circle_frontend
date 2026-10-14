import { act, renderHook } from '@testing-library/react-native';
import { useAuth } from './use-auth';
import {
  fetchCurrentUser,
  fetchCurrentUserWithToken,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '@/services/api/auth';
import { clearLocalSession } from '@/services/auth/session';

const mockSetSession = jest.fn();
const mockUpsertAccount = jest.fn();
const mockLoadMessageGroups = jest.fn();
const mockRouterPush = jest.fn();
const mockRouter = { replace: jest.fn(), push: mockRouterPush, dismissTo: jest.fn() };
const mockSetUser = jest.fn();
const mockSetTokens = jest.fn();
const signedOutState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  sessionEpoch: 0,
  setUser: mockSetUser,
  setTokens: mockSetTokens,
};
let mockAuthState: Record<string, unknown> = signedOutState;

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
  useAuthStore.getState = () => mockAuthState;
  return { useAuthStore };
});

jest.mock('@/stores/knownAccountsStore', () => ({
  useKnownAccountsStore: {
    getState: () => ({ upsertAccount: mockUpsertAccount }),
  },
}));

let mockAddingAccount = false;
jest.mock('@/stores/accountSwitcherStore', () => ({
  useAccountSwitcherStore: {
    getState: () => ({
      addingAccount: mockAddingAccount,
      open: jest.fn(),
      close: jest.fn(),
      setSwitching: jest.fn(),
    }),
  },
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

const previousUser = { id: 'user-0', nickname: 'Previous User' };

/** 已登录 previousUser,且它的 token 自登录后被刷新轮换过一次。 */
function signInPreviousAccount() {
  mockAddingAccount = true;
  mockAuthState = {
    ...signedOutState,
    user: previousUser,
    accessToken: 'rotated-access',
    refreshToken: 'rotated-refresh',
    isAuthenticated: true,
    sessionEpoch: 3,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState = signedOutState;
  mockAddingAccount = false;
  // 与真实实现一致:清会话会推进 sessionEpoch、置为未登录。
  jest.mocked(clearLocalSession).mockImplementation(async () => {
    mockAuthState = {
      ...signedOutState,
      sessionEpoch: (mockAuthState.sessionEpoch as number) + 1,
    };
  });
  jest.mocked(logoutRequest).mockResolvedValue(undefined);
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
  // 未登录时的普通登录由根守卫跳转,这里不命令式导航。
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();
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

test('adding an account while signed in keeps the previous one switchable, tears it down, then lands on messages', async () => {
  signInPreviousAccount();
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens });
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue(user as never);
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_123', 'password1');
  });

  // 上一个账号先以最新(已轮换)的 token 记回账号列表,切回来才不会撞 401。
  expect(mockUpsertAccount).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      user: previousUser,
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    }),
  );
  // 先拆掉上一个账号的本地会话,再激活新账号。
  expect(clearLocalSession).toHaveBeenCalledTimes(1);
  const [rememberOrder] = mockUpsertAccount.mock.invocationCallOrder;
  const [clearOrder] = jest.mocked(clearLocalSession).mock.invocationCallOrder;
  const [setSessionOrder] = mockSetSession.mock.invocationCallOrder;
  expect(rememberOrder).toBeLessThan(clearOrder);
  expect(clearOrder).toBeLessThan(setSessionOrder);
  expect(mockSetSession).toHaveBeenCalledWith(tokens, user, {
    onboardingRequired: false,
  });
  // 登录页压在旧账号的 tabs 之上:退回那一层,不再另挂一份 tabs。
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)/messages');
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('a wrong password while adding an account leaves the signed-in account untouched', async () => {
  signInPreviousAccount();
  jest.mocked(loginRequest).mockRejectedValue(new Error('invalid credentials'));
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_123', 'wrong-password');
  });

  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockAuthState.isAuthenticated).toBe(true);
  expect(result.current.error).toBe('auth.errors.loginFailed');
});

test('a profile fetch failure while adding an account leaves the signed-in account untouched', async () => {
  signInPreviousAccount();
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens });
  jest
    .mocked(fetchCurrentUserWithToken)
    .mockRejectedValue(new Error('profile unavailable'));
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_123', 'password1');
  });

  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockAuthState.isAuthenticated).toBe(true);
  expect(mockRouter.dismissTo).not.toHaveBeenCalled();
});

test('switching accounts records the current account with its latest tokens before tearing it down', async () => {
  signInPreviousAccount();
  const target = {
    user: { id: 'user-2', nickname: 'Target' },
    accessToken: 'target-access',
    refreshToken: 'target-refresh',
    updatedAt: 1,
  };
  jest.mocked(fetchCurrentUser).mockResolvedValue(target.user as never);
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.switchToAccount(target as never);
  });

  expect(mockUpsertAccount).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      user: previousUser,
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    }),
  );
  const [rememberOrder] = mockUpsertAccount.mock.invocationCallOrder;
  const [clearOrder] = jest.mocked(clearLocalSession).mock.invocationCallOrder;
  expect(rememberOrder).toBeLessThan(clearOrder);
});

test('adding an account still lands on messages if the previous account was signed out remotely meanwhile', async () => {
  // 停在「添加账号」登录页期间,旧账号被远端踢下线:会话已清空,标记还在。
  mockAddingAccount = true;
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens });
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue(user as never);
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_123', 'password1');
  });

  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockSetSession).toHaveBeenCalledWith(tokens, user, {
    onboardingRequired: false,
  });
  // 守卫在添加账号期间不会把登录页换走,只能由这里退回 tabs,否则卡在登录页。
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)/messages');
});

test('adding the account that is already signed in keeps its local data and revokes the superseded tokens', async () => {
  signInPreviousAccount();
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens });
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue(previousUser as never);
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.login('user_0', 'password1');
  });

  // 拆会话会清掉本账号的草稿、待发媒体、聊天背景等本地数据 —— 同一个人不该拆。
  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockSetTokens).toHaveBeenCalledWith(tokens);
  expect(mockSetUser).toHaveBeenCalledWith(previousUser);
  // 被顶替的那对 token 在服务端撤销,别留一个没人持有的活会话挂在登录设备列表里。
  expect(logoutRequest).toHaveBeenCalledWith('rotated-refresh');
  expect(mockUpsertAccount).toHaveBeenLastCalledWith(
    expect.objectContaining({ user: previousUser, ...tokens }),
  );
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/(tabs)/messages');
});

test('a device-verified login that fails to finalize while adding an account leaves the signed-in account untouched', async () => {
  signInPreviousAccount();
  jest
    .mocked(fetchCurrentUserWithToken)
    .mockRejectedValue(new Error('profile unavailable'));
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await expect(result.current.completeVerifiedLogin(tokens)).rejects.toThrow(
      'profile unavailable',
    );
  });

  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockAuthState.isAuthenticated).toBe(true);
});

test('a device-verified login that fails after the previous session was torn down still clears the half-made session', async () => {
  signInPreviousAccount();
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue(user as never);
  mockSetSession.mockImplementationOnce(() => {
    throw new Error('activation failed');
  });
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await expect(result.current.completeVerifiedLogin(tokens)).rejects.toThrow(
      'activation failed',
    );
  });

  // 一次拆旧会话 + 一次清掉失败的新会话:世代已变,不再「原样保留」。
  expect(clearLocalSession).toHaveBeenCalledTimes(2);
});

test('registering from the add-account page keeps the signed-in account when the new session cannot be finalized', async () => {
  signInPreviousAccount();
  jest.mocked(registerRequest).mockResolvedValue(tokens as never);
  jest
    .mocked(fetchCurrentUserWithToken)
    .mockRejectedValue(new Error('profile unavailable'));
  const { result } = renderHook(() => useAuth());

  await act(async () => {
    await result.current.register('b@test.dev', 'password1', 'password1', 'B');
  });

  expect(registerRequest).toHaveBeenCalled();
  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockAuthState.isAuthenticated).toBe(true);
  expect(result.current.error).toBe('auth.errors.registerSucceededSessionFailed');
});

test.each(['login', 'profile'])('leaving add-account during pending %s keeps the original session', async (pendingStep) => {
  const current = { ...signedOutState, user: { id: 'A' }, isAuthenticated: true, sessionEpoch: 4, refreshToken: 'a-refresh' };
  mockAuthState = current;
  let resolve!: (value: any) => void;
  const waiting = new Promise<any>(done => { resolve = done; });
  if (pendingStep === 'login') jest.mocked(loginRequest).mockReturnValueOnce(waiting);
  else { jest.mocked(loginRequest).mockResolvedValueOnce({ kind: 'tokens', tokens: { accessToken: 'b-access', refreshToken: 'b-refresh' } } as never); jest.mocked(fetchCurrentUserWithToken).mockReturnValueOnce(waiting); }
  const { result, unmount } = renderHook(() => useAuth());
  let login!: Promise<void>;
  act(() => { login = result.current.login('user_123', 'password1'); });
  await act(async () => { await Promise.resolve(); });
  unmount();
  await act(async () => { resolve(pendingStep === 'login' ? { kind: 'tokens', tokens: { accessToken: 'b-access', refreshToken: 'b-refresh' } } : { id: 'B' }); await login; });
  expect(clearLocalSession).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockSetTokens).not.toHaveBeenCalled();
  expect(mockAuthState.user).toEqual({ id: 'A' });
});

test('canceling while old-session teardown is pending restores the old account rather than activating the new one', async () => {
  const originalUser = { id: 'A' };
  mockAuthState = { ...signedOutState, isAuthenticated: true, sessionEpoch: 4, accessToken: 'a-access', refreshToken: 'a-refresh', user: originalUser };
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens: { accessToken: 'b-access', refreshToken: 'b-refresh' } } as never);
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue({ id: 'B' } as never);
  let finish!: () => void;
  jest.mocked(clearLocalSession).mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { mockAuthState = { ...signedOutState, sessionEpoch: 5 }; resolve(); }; }));
  const { result, unmount } = renderHook(() => useAuth());
  let login!: Promise<void>;
  act(() => { login = result.current.login('user_123', 'password1'); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(clearLocalSession).toHaveBeenCalled();
  unmount();
  await act(async () => { finish(); await login; });
  expect(mockSetSession).toHaveBeenCalledWith({ accessToken: 'a-access', refreshToken: 'a-refresh' }, originalUser, expect.any(Object));
  expect(mockSetSession).not.toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'b-access' }), expect.anything(), expect.anything());
});

test('the irreversible cleanup phase is exposed as a navigation commit lock', async () => {
  mockAuthState = { ...signedOutState, isAuthenticated: true, user: { id: 'A' }, accessToken: 'a-access', refreshToken: 'a-refresh', sessionEpoch: 4 };
  jest.mocked(loginRequest).mockResolvedValue({ kind: 'tokens', tokens: { accessToken: 'b-access', refreshToken: 'b-refresh' } } as never);
  jest.mocked(fetchCurrentUserWithToken).mockResolvedValue({ id: 'B' } as never);
  let finish!: () => void;
  let draft = 'unsent draft';
  jest.mocked(clearLocalSession).mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { draft = ''; resolve(); }; }));
  const { result } = renderHook(() => useAuth());
  let login!: Promise<void>;
  act(() => { login = result.current.login('user_123', 'password1'); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(result.current.committing).toBe(true);
  expect(draft).toBe('unsent draft');
  await act(async () => { finish(); await login; });
  expect(result.current.committing).toBe(false);
});
