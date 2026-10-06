import { fetchFriends } from '@/services/api/friends';
import { fetchMyCircles } from '@/services/api/circles';
import { useCirclesStore } from '@/features/discover/store/use-circles-store';
import {
  getCachedNotePickerCircles,
  prefetchNoteCardPickerData,
} from './note-card-picker-cache';

jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('@/services/api/circles', () => ({ fetchMyCircles: jest.fn() }));
jest.mock('@/features/discover/store/use-circles-store', () => ({
  useCirclesStore: { getState: jest.fn() },
}));

const mockGetCirclesState = jest.mocked(useCirclesStore.getState);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCirclesState.mockReturnValue({
    joinedCircles: [],
    createdCircles: [],
    myCirclesLoading: false,
    myCirclesError: null,
  } as never);
  jest.mocked(fetchFriends).mockResolvedValue([]);
  jest.mocked(fetchMyCircles).mockResolvedValue([]);
});

test('prefetch reuses the already loaded circle store and fetches friends in the background', async () => {
  mockGetCirclesState.mockReturnValue({
    joinedCircles: [{ id: 'joined', name: '已加入', avatarUrl: null }],
    createdCircles: [{ id: 'created', name: '我创建的', avatarUrl: null }],
    myCirclesLoading: false,
    myCirclesError: null,
  } as never);

  await prefetchNoteCardPickerData('account-with-store-data');

  expect(getCachedNotePickerCircles('account-with-store-data')).toEqual([
    { id: 'joined', name: '已加入', avatarUrl: null },
    { id: 'created', name: '我创建的', avatarUrl: null },
  ]);
  expect(fetchMyCircles).not.toHaveBeenCalled();
  expect(fetchFriends).toHaveBeenCalledTimes(1);
});

test('prefetch falls back to the direct circle API when the global store is empty', async () => {
  jest.mocked(fetchMyCircles)
    .mockResolvedValueOnce([{ id: 'joined', name: '已加入', avatarUrl: null }] as never)
    .mockResolvedValueOnce([{ id: 'created', name: '我创建的', avatarUrl: null }] as never);

  await prefetchNoteCardPickerData('account-without-store-data');

  expect(fetchMyCircles).toHaveBeenCalledTimes(2);
  expect(getCachedNotePickerCircles('account-without-store-data')).toEqual([
    { id: 'joined', name: '已加入', avatarUrl: null },
    { id: 'created', name: '我创建的', avatarUrl: null },
  ]);
});
