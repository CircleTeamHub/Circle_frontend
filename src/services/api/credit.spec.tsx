import { apiClient } from '@/services/api/client';
import { fetchCreditEvents } from '@/services/api/credit';

jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));

jest.mock('@/services/api/client', () => ({
  apiClient: jest.fn(),
}));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

const event = {
  id: 'event-1',
  delta: -5,
  scoreAfter: 95,
  reason: 'FRIEND_REPORT',
  category: 'harassment',
  createdAt: '2026-10-30T08:00:00.000Z',
};

beforeEach(() => {
  mockedApiClient.mockReset();
});

test('reads the caller’s events from /credit/events', async () => {
  mockedApiClient.mockResolvedValue([event]);

  await expect(fetchCreditEvents()).resolves.toEqual([event]);
  expect(mockedApiClient).toHaveBeenCalledWith('/credit/events');
});

// 前端只认识已有的举报分类；服务端新增分类时不拼出一个找不到词条的标题。
test('normalizes an unknown report category to null', async () => {
  mockedApiClient.mockResolvedValue([{ ...event, category: 'brand-new' }]);

  await expect(fetchCreditEvents()).resolves.toEqual([{ ...event, category: null }]);
});

test.each([
  ['a non-array body', { items: [] }],
  ['a fractional delta', [{ ...event, delta: -2.5 }]],
  ['a negative resulting score', [{ ...event, scoreAfter: -1 }]],
  ['an unparseable timestamp', [{ ...event, createdAt: 'yesterday' }]],
  ['a missing reason', [{ ...event, reason: '' }]],
])('rejects %s', async (_label, body) => {
  mockedApiClient.mockResolvedValue(body);

  await expect(fetchCreditEvents()).rejects.toThrow('credit.recentLoadFailed');
});
