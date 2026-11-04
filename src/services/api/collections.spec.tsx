import { apiClient } from '@/services/api/client';
import { fetchCollections } from './collections';

jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/dev-log', () => ({ devWarn: jest.fn() }));
jest.mock('@/constants/config', () => ({
  API_URL: 'https://api.example.com/api/v1',
  MEDIA_ORIGINS: ['https://cdn.example.com'],
}));

const message = {
  id: 'message', conversationId: 'conversation', height: 42, type: 'image',
  content: { key: 'chat/peer/photo', url: 'https://cdn.example.com/photo?signature=fresh' },
  sender: { id: 'peer', nickname: 'Peer', avatarUrl: null },
  replyToId: null, d: null, createdAt: '2026-11-01T00:00:00Z',
};
const collection = {
  id: 'collection', userID: 'me', type: 'MESSAGE', title: '图片消息', summary: '图片',
  sourceID: 'message', payload: {}, createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
};

beforeEach(() => jest.mocked(apiClient).mockReset());

test('keeps the old-server absent field distinct from unavailable and invalid sources', async () => {
  jest.mocked(apiClient).mockResolvedValue([
    collection, { ...collection, id: 'unavailable', message: null },
    { ...collection, id: 'invalid', message: { ...message, height: '42' } },
  ]);
  const result = await fetchCollections();
  expect(result[0].message).toBeUndefined();
  expect(result[1].message).toBeNull();
  expect(result[2].message).toBeNull();
});

test.each([{ content: null }, { sender: undefined }, { deleted: true }, { revokedAt: '2026-11-02T00:00:00Z' }])(
  'treats malformed and removed source DTOs as unavailable: %j', async (overrides) => {
    jest.mocked(apiClient).mockResolvedValue([{ ...collection, message: { ...message, ...overrides } }]);
    expect((await fetchCollections())[0].message).toBeNull();
  },
);

test('preserves authoritative source coordinates and fresh allowlisted media URLs', async () => {
  jest.mocked(apiClient).mockResolvedValue([{ ...collection, message }]);
  const [result] = await fetchCollections('MESSAGE');
  expect(result.message).toEqual(message);
  expect(apiClient).toHaveBeenCalledWith('/collections?type=MESSAGE');
});

test('removes untrusted media and local paths without changing the response object', async () => {
  const raw = { ...message, content: {
    key: 'chat/peer/photo', url: 'https://tracker.example.com/photo',
    thumbUrl: 'https://tracker.example.com/thumb', localUri: 'file:///private/photo.jpg',
  }, sender: { id: 'peer', nickname: 'Peer', avatarUrl: 'https://tracker.example.com/avatar' } };
  jest.mocked(apiClient).mockResolvedValue([{ ...collection, message: raw }]);
  const [result] = await fetchCollections();
  expect(result.message?.content.url).toBeUndefined();
  expect(result.message?.content.thumbUrl).toBeUndefined();
  expect(result.message?.content.localUri).toBeUndefined();
  expect(result.message?.sender?.avatarUrl).toBeNull();
  expect(raw.content.localUri).toBe('file:///private/photo.jpg');
});
