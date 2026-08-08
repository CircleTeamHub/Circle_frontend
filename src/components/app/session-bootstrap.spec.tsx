import { AppState } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { SessionBootstrap } from './session-bootstrap';
import { fetchCurrentUser } from '@/services/api/auth';
import { clearLocalSession } from '@/services/auth/session';
import { connectChat } from '@/chat-core/socket-manager';
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
jest.mock('@/chat-core/socket-manager', () => ({
  connectChat: jest.fn(),
  disconnectChat: jest.fn(),
  suspendChat: jest.fn(),
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
const mockConnectChat = connectChat as jest.MockedFunction<typeof connectChat>;

// bootstrap 只读 user.id，宽松对象足够。
const storedUser = { id: 'user-1' } as AuthUser;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener');
  mockAuth.state = {
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
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

test('a successful cold start restores the user', async () => {
  mockFetchCurrentUser.mockResolvedValue(storedUser);

  render(<SessionBootstrap />);

  await waitFor(() =>
    expect(mockAuth.state.setUser).toHaveBeenCalledWith(storedUser),
  );
  expect(mockClearLocalSession).not.toHaveBeenCalled();
});

// 自研 chat 长连接由 effect 按 accessToken 直接建立，不依赖 /auth/me 成功 ——
// 瞬断冷启动下消息通道照常可用（socket-manager 自己重连）。
test('the chat socket connects from the persisted session without waiting on /auth/me', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('offline', { status: 0, failureKind: 'network' }),
  );

  render(<SessionBootstrap />);

  await waitFor(() =>
    expect(mockConnectChat).toHaveBeenCalledWith('access-a', 'user-1'),
  );
  expect(mockClearLocalSession).not.toHaveBeenCalled();
});

// 护栏（authStore / app/index.tsx 反复记录过的老 bug）：路由只认
// isAuthenticated / onboardingRequired / isLoading。瞬时失败的降级进入
// 绝不能拿可能过期的快照去改这些输入，把用户路由进错误的 onboarding 态。
test('a transient failure never rewrites onboarding routing state', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('bad gateway', { status: 502 }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockAuth.state.setLoading).toHaveBeenCalledWith(false),
    { timeout: 3_000 },
  );
  expect(mockAuth.state.setOnboardingRequired).not.toHaveBeenCalled();
  expect(mockAuth.state.setUser).not.toHaveBeenCalled();
});

// onboarding 未完成时不建聊天长连接（完成后 onboardingRequired 翻 false，
// effect 重跑自动接上）。
test('onboarding sessions do not connect the chat socket', async () => {
  mockAuth.state.onboardingRequired = true;
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('offline', { status: 0, failureKind: 'network' }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockAuth.state.setLoading).toHaveBeenCalledWith(false),
    { timeout: 3_000 },
  );
  expect(mockConnectChat).not.toHaveBeenCalled();
});
