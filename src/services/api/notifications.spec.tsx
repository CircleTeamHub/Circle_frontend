import { apiClient } from '@/services/api/client';
import {
  fetchNotificationsPage,
  fetchProfileNotificationsPage,
} from '@/services/api/notifications';

jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));

const mockedApiClient = apiClient as jest.MockedFunction<typeof apiClient>;

const notification = {
  id: 'notice-1',
  type: 'PROFILE_LIKE',
  content: '通知',
  read: false,
  createdAt: '2026-08-14T12:00:00.000Z',
};

beforeEach(() => mockedApiClient.mockReset());

test('requests the first interactive cursor page with the optional domain', async () => {
  mockedApiClient.mockResolvedValue({ items: [notification], nextCursor: 'c1' });

  await expect(fetchNotificationsPage(undefined, 'circle')).resolves.toEqual({
    items: [notification],
    nextCursor: 'c1',
  });
  expect(mockedApiClient).toHaveBeenCalledWith(
    '/notification/list?cursorMode=true&domain=circle',
  );
});

test('passes the profile cursor and rejects malformed cursor pages', async () => {
  mockedApiClient.mockResolvedValue({ items: [notification], nextCursor: null });
  await fetchProfileNotificationsPage('cursor with spaces');
  expect(mockedApiClient).toHaveBeenCalledWith(
    '/notification/profile/list?cursorMode=true&cursor=cursor+with+spaces',
  );

  mockedApiClient.mockResolvedValue({ items: [{ ...notification, read: 'no' }] });
  await expect(fetchProfileNotificationsPage()).rejects.toThrow(
    '系统通知分页数据格式异常',
  );
});
