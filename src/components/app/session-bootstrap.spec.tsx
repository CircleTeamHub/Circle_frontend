import { render, waitFor } from '@testing-library/react-native';
import { SessionBootstrap } from './session-bootstrap';
import { fetchCurrentUser } from '@/services/api/auth';
import { clearLocalSession } from '@/services/auth/session';
import { loginToOpenIM } from '@/im/client';
import { ApiError } from '@/services/api/client';
import type { AuthUser } from '@/stores/authStore';

// authStore 只需要「按 selector 取值 + getState」这两种用法；bootstrap 的恢复流程在
// 挂载时跑一次即可，不需要真正的订阅/重渲染。
const mockAuth = {
  state: {} as Record<string, unknown>,
};

jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAuth.state),
    { getState: () => mockAuth.state },
  ),
}));
jest.mock('@/services/api/auth', () => ({ fetchCurrentUser: jest.fn() }));
// 真实 api/client 要进来（isDefinitiveAuthFailure / ApiError 是被测逻辑的一部分），
// 但它的 i18n 依赖会一路拉起 AsyncStorage native module。
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  },
}));
jest.mock('@/services/auth/session', () => ({
  clearLocalSession: jest.fn(async () => undefined),
  registerLogoutHandler: jest.fn(() => () => undefined),
}));
jest.mock('@/im/client', () => ({
  loginToOpenIM: jest.fn(async () => true),
  logoutFromOpenIM: jest.fn(async () => undefined),
}));
jest.mock('@/realtime/client', () => ({
  connectRealtime: jest.fn(),
  disconnectRealtime: jest.fn(),
  recoverTabBadgeSnapshot: jest.fn(async () => undefined),
}));
jest.mock('@/features/messages/store/use-message-groups-store', () => ({
  useMessageGroupsStore: {
    getState: () => ({ load: jest.fn(async () => undefined) }),
  },
}));
jest.mock('@/features/auth/onboarding-completion', () => ({
  hasCompletedOnboardingProfile: () => true,
}));

const mockFetchCurrentUser = fetchCurrentUser as jest.MockedFunction<
  typeof fetchCurrentUser
>;
const mockClearLocalSession = clearLocalSession as jest.MockedFunction<
  typeof clearLocalSession
>;
const mockLoginToOpenIM = loginToOpenIM as jest.MockedFunction<
  typeof loginToOpenIM
>;

// bootstrap 只读 user.id，宽松对象足够。
const storedUser = { id: 'user-1' } as AuthUser;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.state = {
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    imToken: 'im-a',
    // 冷启动时 user 已由 authStore 从磁盘水合回来（user 在持久化字段里）。
    user: storedUser,
    isAuthenticated: true,
    hasHydrated: true,
    isLoading: true,
    onboardingRequired: false,
    sessionEpoch: 1,
    setUser: jest.fn(),
    setLoading: jest.fn(),
    setOnboardingRequired: jest.fn(),
  };
});

// P0-12b: /auth/me 在每次冷启动都跑。够不到服务器 ≠ 未登录 —— 在地铁里开一次 app
// 不该把本地凭证清空。
test('an offline cold start keeps the session instead of logging the user out', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('offline', { status: 0, failureKind: 'network' }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockAuth.state.setLoading).toHaveBeenCalledWith(false),
    { timeout: 3_000 },
  );
  expect(mockClearLocalSession).not.toHaveBeenCalled();
});

test('a timeout on cold start keeps the session', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('timeout', { status: 0, failureKind: 'timeout' }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockAuth.state.setLoading).toHaveBeenCalledWith(false),
    { timeout: 3_000 },
  );
  expect(mockClearLocalSession).not.toHaveBeenCalled();
});

test('a backend 5xx on cold start keeps the session', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('bad gateway', { status: 502 }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockAuth.state.setLoading).toHaveBeenCalledWith(false),
    { timeout: 3_000 },
  );
  expect(mockClearLocalSession).not.toHaveBeenCalled();
});

// 反面：服务端明确否认凭证时必须照常登出，否则用户会卡在一个死会话里。
test('a rejected credential on cold start still clears the session', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('unauthorized', { status: 401 }),
  );

  render(<SessionBootstrap />);

  await waitFor(() => expect(mockClearLocalSession).toHaveBeenCalledTimes(1));
});

test('a forbidden account on cold start still clears the session', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('forbidden', { status: 403 }),
  );

  render(<SessionBootstrap />);

  await waitFor(() => expect(mockClearLocalSession).toHaveBeenCalledTimes(1));
});

test('a successful cold start restores the user and logs into OpenIM', async () => {
  mockFetchCurrentUser.mockResolvedValue(storedUser);

  render(<SessionBootstrap />);

  await waitFor(() => expect(mockAuth.state.setUser).toHaveBeenCalledWith(storedUser));
  await waitFor(() => expect(mockLoginToOpenIM).toHaveBeenCalledWith('user-1', 'im-a'));
  expect(mockClearLocalSession).not.toHaveBeenCalled();
});
