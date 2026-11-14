import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NoteRankingScreen from './NoteRankingScreen';
import { fetchNoteRanking } from '@/services/api/notes';
import { useCityPickStore } from '@/features/discover/store/use-city-pick-store';
import type { NoteRanking, NoteSummary } from '@/features/notes/types';

const mockPush = jest.fn();
let mockFocus: (() => void) | null = null;
let mockUserCity: string | null = '成都';

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void) => {
      mockFocus = callback;
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});
// 和真的 react-i18next 一样，t 在渲染之间保持同一个引用。
const mockT = (key: string, opts?: Record<string, unknown>) =>
  opts?.city ? `${key}:${opts.city}` : opts?.month ? `${key}:${opts.month}` : key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/features/notes/components/NoteCard', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NoteCard: ({ note, onPress }: { note: NoteSummary; onPress: (n: NoteSummary) => void }) => (
      <Pressable onPress={() => onPress(note)}>
        <Text>{note.title}</Text>
      </Pressable>
    ),
  };
});
jest.mock('@/services/api/notes', () => ({ fetchNoteRanking: jest.fn() }));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: { user: { city: string | null } }) => unknown) =>
    select({ user: { city: mockUserCity } }),
}));

function note(id: string, title: string): NoteSummary {
  return {
    id,
    title,
    ownerId: `owner-${id}`,
    contentPreview: null,
    status: 'ACTIVE',
    available: true,
    pinned: false,
    groups: [],
    cover: null,
    imageCount: 0,
    videoCount: 0,
    mediaCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    city: '成都',
    goodCount: 3,
    badCount: 0,
  };
}

function ranking(city: string | null, items: NoteSummary[]): NoteRanking {
  return { month: '2026-11', city, items };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserCity = '成都';
  useCityPickStore.setState({ picked: {} });
});

test('opens on the profile city, ranks the notes in server order and opens a note in the explore tab', async () => {
  jest.mocked(fetchNoteRanking).mockResolvedValue(ranking('成都', [note('a', '火锅'), note('b', '茶馆')]));
  render(<NoteRankingScreen />);
  await act(async () => {});

  expect(fetchNoteRanking).toHaveBeenCalledWith('成都');
  expect(screen.getByText('explore.ranking.subtitle:11')).toBeTruthy();
  expect(screen.getAllByLabelText('explore.ranking.rankA11y')).toHaveLength(2);
  expect(screen.getAllByText(/^[12]$/).map((node) => node.props.children)).toEqual([1, 2]);
  fireEvent.press(screen.getByText('茶馆'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(tabs)/explore/notes/[id]',
    params: { id: 'b', ownerId: 'owner-b' },
  });
});

test('全国 shows every city, and the city chip opens the shared single-pick city picker', async () => {
  mockUserCity = null;
  jest.mocked(fetchNoteRanking).mockResolvedValue(ranking(null, []));
  render(<NoteRankingScreen />);
  await act(async () => {});
  expect(fetchNoteRanking).toHaveBeenLastCalledWith(null);
  expect(screen.getByText('explore.ranking.empty')).toBeTruthy();

  fireEvent.press(screen.getByText('explore.ranking.chooseCity'));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/(tabs)/explore/select-city',
    params: { target: 'ranking' },
  });

  // 选城市页交回结果，回到本页时取走并按新城市重拉。
  useCityPickStore.getState().pick('ranking', '杭州');
  await act(async () => { mockFocus?.(); });
  expect(fetchNoteRanking).toHaveBeenLastCalledWith('杭州');
  expect(screen.getByText('explore.ranking.emptyCity:杭州')).toBeTruthy();
});

test('a slow answer for the previous city never replaces the current city\'s chart', async () => {
  const chengdu = deferred<NoteRanking>();
  jest.mocked(fetchNoteRanking)
    .mockReturnValueOnce(chengdu.promise)
    .mockResolvedValueOnce(ranking(null, [note('n', '全国第一')]));
  render(<NoteRankingScreen />);

  fireEvent.press(screen.getByText('explore.ranking.nationwide'));
  await act(async () => {});
  await act(async () => chengdu.resolve(ranking('成都', [note('c', '成都旧榜')])));

  expect(screen.getByText('全国第一')).toBeTruthy();
  expect(screen.queryByText('成都旧榜')).toBeNull();
});

test('a failed load says so and retries on tap', async () => {
  jest.mocked(fetchNoteRanking)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(ranking('成都', [note('a', '火锅')]));
  render(<NoteRankingScreen />);
  await act(async () => {});

  expect(screen.getByText('explore.ranking.loadFailed')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('common.retry')); });
  expect(screen.getByText('火锅')).toBeTruthy();
});
