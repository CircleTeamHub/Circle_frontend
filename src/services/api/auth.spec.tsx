import { fetchCurrentUser } from './auth';
import { apiClient } from './client';

jest.mock('./client', () => ({ apiClient: jest.fn() }));
jest.mock('@/services/api/utils', () => ({ normalizeUser: (value: unknown) => value }));

const baseUser = {
  id: 'u1',
  accountId: 'a1',
  inviteCode: 'invite',
  nickname: 'User',
  avatarUrl: null,
  cover: null,
  email: null,
  phoneNumber: null,
  wechat: null,
  qq: null,
  whatsup: null,
  persona: null,
  helloWords: null,
  birthday: null,
  gender: 'unset',
  city: null,
  vipLevel: 0,
  creditScore: 0,
  fancyNumber: false,
  role: 'USER',
  status: 'ACTIVE',
  lastOnline: null,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('accepts mixed-version /auth/me responses without displayIcons', async () => {
  jest.mocked(apiClient).mockResolvedValueOnce(baseUser);

  await expect(fetchCurrentUser()).resolves.toEqual({
    ...baseUser,
    displayIcons: [],
  });
});

test('still rejects malformed displayIcons when the field is present', async () => {
  jest.mocked(apiClient).mockResolvedValueOnce({
    ...baseUser,
    displayIcons: 'not-an-array',
  });

  await expect(fetchCurrentUser()).rejects.toThrow('用户资料返回数据格式异常');
});
