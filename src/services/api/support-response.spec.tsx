import { apiClient } from '@/services/api/client';
import { fetchSupportConfig } from '@/services/api/support';

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: {
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? 'invalid response',
  },
}));

jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));

// 固定媒体白名单,免得断言跟着开发机的默认 API host 漂。
jest.mock('@/constants/config', () => ({
  API_URL: 'https://api.example.com/api/v1',
  MEDIA_ORIGINS: ['https://cdn.example.com'],
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

type RawAgent = Record<string, unknown>;

function payload(overrides: Record<string, RawAgent[]>) {
  return {
    agents: {
      recharge: [],
      issue: [],
      dispute: [],
      account: [],
      membership: [],
      ...overrides,
    },
  };
}

const namedAgent = {
  userID: 'agent-named',
  nickname: '官方客服',
  avatarUrl: null,
  vipLevel: 0,
};

beforeEach(() => {
  mockedApiClient.mockReset();
});

// 客服仍是普通用户,PublicUser.nickname 是 string | null。一个没起名的历史账号
// 曾经会让整份 /support/config 判为无效响应 —— 五类客服全线不可用。
test('keeps a support account that has no nickname and the rest of the roster', async () => {
  mockedApiClient.mockResolvedValue(
    payload({
      recharge: [
        { userID: 'agent-null', nickname: null, avatarUrl: null, vipLevel: 0 },
        { userID: 'agent-blank', nickname: '   ', avatarUrl: null, vipLevel: 1 },
        { userID: 'agent-missing', avatarUrl: null, vipLevel: 0 },
      ],
      membership: [namedAgent],
    }),
  );

  const config = await fetchSupportConfig();

  expect(config.recharge.map((agent) => agent.userID)).toEqual([
    'agent-null',
    'agent-blank',
    'agent-missing',
  ]);
  // 归一化成 '':屏幕据此回落到「在线客服 / 在线客服 N」。
  expect(config.recharge.map((agent) => agent.nickname)).toEqual(['', '', '']);
  expect(config.membership).toEqual([namedAgent]);
});

test('drops support avatars that point at an unapproved origin', async () => {
  mockedApiClient.mockResolvedValue(
    payload({
      account: [
        {
          userID: 'agent-external',
          nickname: '外链头像',
          avatarUrl: 'https://tracker.evil.example/beacon.png',
          vipLevel: 0,
        },
        {
          userID: 'agent-api',
          nickname: 'API 同源',
          avatarUrl: 'https://api.example.com/media/a.png',
          vipLevel: 0,
        },
        {
          userID: 'agent-cdn',
          nickname: '白名单 CDN',
          avatarUrl: 'https://cdn.example.com/media/b.png',
          vipLevel: 0,
        },
      ],
    }),
  );

  const config = await fetchSupportConfig();

  // 未授权来源 → null,列表渲染耳麦徽章,不会有人因为打开客服列表就把 IP
  // 和访问时刻交给那台机器。
  expect(config.account[0].avatarUrl).toBeNull();
  expect(config.account[1].avatarUrl).toBe('https://api.example.com/media/a.png');
  expect(config.account[2].avatarUrl).toBe('https://cdn.example.com/media/b.png');
});

test('still rejects a payload that is missing a category or an agent id', async () => {
  mockedApiClient.mockResolvedValue({
    agents: { recharge: [], issue: [], dispute: [], account: [] },
  });
  await expect(fetchSupportConfig()).rejects.toThrow();

  mockedApiClient.mockResolvedValue(
    payload({ issue: [{ nickname: '无 id', avatarUrl: null, vipLevel: 0 }] }),
  );
  await expect(fetchSupportConfig()).rejects.toThrow();
});
