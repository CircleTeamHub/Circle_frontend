import { act } from '@testing-library/react-native';
import { useStickerStore } from './use-sticker-store';

const mockList = jest.fn();
const mockCreate = jest.fn();
const mockRemove = jest.fn();
const mockAuth = { sessionEpoch: 1 };
function mockListeners(): ((state: typeof mockAuth, previous: typeof mockAuth) => void)[] {
  const holder = globalThis as { __stickerListeners?: ((state: typeof mockAuth, previous: typeof mockAuth) => void)[] };
  return holder.__stickerListeners ??= [];
}
jest.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => mockAuth, subscribe: (listener: (state: typeof mockAuth, previous: typeof mockAuth) => void) => { mockListeners().push(listener); return () => undefined; } } }));
jest.mock('@/services/api/stickers', () => ({ fetchStickers: () => mockList(), createSticker: (...args: unknown[]) => mockCreate(...args), removeSticker: (...args: unknown[]) => mockRemove(...args) }));

beforeEach(() => {
  mockAuth.sessionEpoch = 1;
  useStickerStore.setState({ items: [], loading: false, error: false });
  mockList.mockReset(); mockCreate.mockReset(); mockRemove.mockReset();
});

test('independent refreshes use the server collection so another device additions appear', async () => {
  mockList.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
  await useStickerStore.getState().refresh();
  expect(useStickerStore.getState().items).toEqual([{ id: 'a' }]);
  await useStickerStore.getState().refresh();
  expect(useStickerStore.getState().items).toEqual([{ id: 'a' }, { id: 'b' }]);
});

test('account change clears private stickers and ignores a late response', async () => {
  let resolve!: (value: unknown[]) => void;
  mockList.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const request = useStickerStore.getState().refresh();
  act(() => { const previous = { ...mockAuth }; mockAuth.sessionEpoch++; mockListeners().forEach((listener) => listener(mockAuth, previous)); });
  resolve([{ id: 'alice' }]); await request;
  expect(useStickerStore.getState().items).toEqual([]);
  expect(useStickerStore.getState().loading).toBe(false);
});

test('failure preserves the current collection and exposes retry state', async () => {
  useStickerStore.setState({ items: [{ id: 'a' }] as never });
  mockList.mockRejectedValue(new Error('offline'));
  await useStickerStore.getState().refresh();
  expect(useStickerStore.getState().items).toEqual([{ id: 'a' }]);
  expect(useStickerStore.getState().error).toBe(true);
});

test('failed save never adds a phantom sticker; duplicate save reconciles by id', async () => {
  mockCreate.mockRejectedValueOnce(new Error('upload failed')).mockResolvedValue({ id: 'a' });
  await expect(useStickerStore.getState().save({ messageId: 'm1' })).rejects.toThrow('upload failed');
  expect(useStickerStore.getState().items).toEqual([]);
  await useStickerStore.getState().save({ messageId: 'm1' });
  await useStickerStore.getState().save({ messageId: 'm1' });
  expect(useStickerStore.getState().items).toEqual([{ id: 'a' }]);
});

test('save and removal completing after an account change cannot alter the next account', async () => {
  let finish!: (value: unknown) => void;
  mockCreate.mockImplementation(() => new Promise((done) => { finish = done; }));
  const request = useStickerStore.getState().save({ messageId: 'm1' });
  mockAuth.sessionEpoch++;
  useStickerStore.setState({ items: [{ id: 'bob' }] as never });
  finish({ id: 'alice' }); await request;
  expect(useStickerStore.getState().items).toEqual([{ id: 'bob' }]);
});
