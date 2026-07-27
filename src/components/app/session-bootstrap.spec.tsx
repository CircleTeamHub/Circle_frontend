import { AppState } from 'react-native';
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
jest.mock('@/im/token-recovery', () => ({
  getIMRecoveryGeneration: jest.fn(() => 0),
  isIMReloginPending: jest.fn(() => false),
  recoverIMSession: jest.fn(async () => undefined),
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

// 把 app 切回前台：取出组件注册的 AppState 'change' 监听器并喂一个 'active'。
async function foregroundApp() {
  const handlers = (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([event]) => event === 'change')
    .map(([, handler]) => handler as (state: string) => void);
  expect(handlers.length).toBeGreaterThan(0);
  for (const handler of handlers) {
    handler('active');
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener');
  // clearAllMocks 不会清掉 mockRejectedValueOnce 排的队，一个没被消费的 once
  // 会漏进下一个 test。显式重置，让每个 test 从「登录会成功」开始。
  mockLoginToOpenIM.mockReset();
  mockLoginToOpenIM.mockResolvedValue(true);
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

// bootstrap 是冷启动唯一登录 OpenIM 的地方。保住 session 却不登录 IM，只是把
// 「被登出」换成「消息一路降级到用户手动重启 app」——用磁盘上的 user 快照补登。
test('a transient /auth/me failure still logs into OpenIM with the cached user', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('offline', { status: 0, failureKind: 'network' }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockLoginToOpenIM).toHaveBeenCalledWith('user-1', 'im-a'),
    { timeout: 3_000 },
  );
  expect(mockClearLocalSession).not.toHaveBeenCalled();
});

// 护栏（authStore / app/index.tsx 反复记录过的老 bug）：路由只认
// isAuthenticated / onboardingRequired / isLoading。补登 IM 属于降级修复，
// 绝不能拿可能过期的 user 快照去改这些输入，把用户路由进错误的 onboarding 态。
test('the cached-user fallback never rewrites onboarding routing state', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('bad gateway', { status: 502 }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockLoginToOpenIM).toHaveBeenCalledWith('user-1', 'im-a'),
    { timeout: 3_000 },
  );
  expect(mockAuth.state.setOnboardingRequired).not.toHaveBeenCalled();
  expect(mockAuth.state.setUser).not.toHaveBeenCalled();
});

// onboarding 未完成时冷启动本就不登录 IM（成功路径会 early-return），
// 降级路径必须保持同样的门禁。
test('a transient failure during onboarding does not log into OpenIM', async () => {
  mockAuth.state.onboardingRequired = true;
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('offline', { status: 0, failureKind: 'network' }),
  );

  render(<SessionBootstrap />);

  await waitFor(
    () => expect(mockAuth.state.setLoading).toHaveBeenCalledWith(false),
    { timeout: 3_000 },
  );
  expect(mockLoginToOpenIM).not.toHaveBeenCalled();
});

// 反面：服务端明确否认凭证 = 真登出，不该再拿旧快照把 IM 登回去。
test('a rejected credential on cold start does not attempt an OpenIM login', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('unauthorized', { status: 401 }),
  );

  render(<SessionBootstrap />);

  await waitFor(() => expect(mockClearLocalSession).toHaveBeenCalledTimes(1));
  expect(mockLoginToOpenIM).not.toHaveBeenCalled();
});

// 真正离线时 /auth/me 和 IM 登录会一起失败，补登也救不回来。欠账要留到
// 下次 app 回前台（网络通常已恢复）重试，而不是就此降级一整个会话。
test('an OpenIM login that fails offline is retried when the app returns to the foreground', async () => {
  mockFetchCurrentUser.mockRejectedValue(
    new ApiError('offline', { status: 0, failureKind: 'network' }),
  );
  mockLoginToOpenIM.mockRejectedValueOnce(new Error('network down'));

  render(<SessionBootstrap />);

  await waitFor(() => expect(mockLoginToOpenIM).toHaveBeenCalledTimes(1), {
    timeout: 3_000,
  });

  await foregroundApp();

  await waitFor(() => expect(mockLoginToOpenIM).toHaveBeenCalledTimes(2));
  expect(mockLoginToOpenIM).toHaveBeenLastCalledWith('user-1', 'im-a');
});

// 但健康会话不该为此付出代价：每次前台都去 login 一遍会让原本无事的路径
// 多打一轮 native 调用。只有欠着登录时才补。
test('a healthy session does not re-attempt an OpenIM login on foreground', async () => {
  mockFetchCurrentUser.mockResolvedValue(storedUser);

  render(<SessionBootstrap />);

  await waitFor(() => expect(mockLoginToOpenIM).toHaveBeenCalledTimes(1));

  await foregroundApp();
  await foregroundApp();

  expect(mockLoginToOpenIM).toHaveBeenCalledTimes(1);
});
