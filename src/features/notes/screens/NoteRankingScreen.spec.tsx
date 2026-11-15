import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NoteRankingScreen from './NoteRankingScreen';
import { fetchNoteRanking } from '@/services/api/notes';
import { useCityPickStore } from '@/features/discover/store/use-city-pick-store';
import type { NoteRanking, NoteRankingItem } from '@/features/notes/types';
import type { NoteCardData } from '@/types';

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
// 榜单直接用聊天里的笔记卡片：记下它收到的卡片数据，标题和「视频」块都能点。
type MockCardProps = {
  note: NoteCardData;
  width?: number;
  ratingCounts?: { goodCount: number; badCount: number };
  onPress: (note: NoteCardData) => void;
  onSectionPress: (note: NoteCardData, section: string) => void;
};
let mockCards: MockCardProps[] = [];
jest.mock('@/features/chat/components/bubbles/note-card-body', () => {
  const { Pressable, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    NoteCardBody: (props: MockCardProps) => {
      mockCards.push(props);
      return (
        <View>
          <Pressable onPress={() => props.onPress(props.note)}>
            <Text>{props.note.title}</Text>
          </Pressable>
          <Pressable onPress={() => props.onSectionPress(props.note, 'media')}>
            <Text>{`${props.note.title}:media`}</Text>
          </Pressable>
        </View>
      );
    },
  };
});
// 聊天气泡的共享模块会拉进头像、i18n 初始化；榜单只用到卡片内边距这一个常量。
jest.mock('@/features/chat/components/bubbles/shared', () => ({ CHAT_CARD_PADDING_VERTICAL: 10 }));
jest.mock('@/services/api/notes', () => ({ fetchNoteRanking: jest.fn() }));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: { user: { city: string | null } }) => unknown) =>
    select({ user: { city: mockUserCity } }),
}));

function note(id: string, title: string): NoteRankingItem {
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
    previewUrls: [`https://media/${id}/1.jpg`],
  };
}

function ranking(city: string | null, items: NoteRankingItem[]): NoteRanking {
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
  mockCards = [];
  useCityPickStore.setState({ picked: {} });
});

const latestCard = (noteId: string) =>
  [...mockCards].reverse().find((card) => card.note.noteId === noteId);

test('opens on the profile city, ranks the notes in server order and opens a note in the explore tab', async () => {
  jest.mocked(fetchNoteRanking).mockResolvedValue(ranking('成都', [note('a', '火锅'), note('b', '茶馆')]));
  render(<NoteRankingScreen />);
  await act(async () => {});

  expect(fetchNoteRanking).toHaveBeenCalledWith('成都');
  expect(screen.getByText('explore.ranking.heroTitle:11')).toBeTruthy();
  expect(screen.getAllByLabelText('explore.ranking.rankA11y')).toHaveLength(2);
  expect(screen.getAllByText(/^[12]$/).map((node) => node.props.children)).toEqual([1, 2]);
  fireEvent.press(screen.getByText('茶馆'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/(tabs)/explore/notes/[id]',
    params: { id: 'b', ownerId: 'owner-b' },
  });
});

test('each entry is the chat note card, with its previews and this month\'s counts', async () => {
  jest.mocked(fetchNoteRanking).mockResolvedValue(ranking('成都', [note('a', '火锅')]));
  render(<NoteRankingScreen />);
  await act(async () => {});

  const card = latestCard('a');
  expect(card?.note).toMatchObject({
    noteId: 'a',
    ownerId: 'owner-a',
    title: '火锅',
    previewUrls: ['https://media/a/1.jpg'],
    publicationStatus: 'ACTIVE',
  });
  expect(card?.ratingCounts).toEqual({ goodCount: 3, badCount: 0 });
  expect(card?.width).toBeGreaterThan(0);

  // 卡片上的分块按钮打开详情并定位到那一块（榜单里没有聊天可发）。
  fireEvent.press(screen.getByText('火锅:media'));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/(tabs)/explore/notes/[id]',
    params: { id: 'a', ownerId: 'owner-a', section: 'media' },
  });
});

test('an empty city chart offers the nationwide chart in one tap', async () => {
  jest.mocked(fetchNoteRanking)
    .mockResolvedValueOnce(ranking('成都', []))
    .mockResolvedValueOnce(ranking(null, [note('n', '全国第一')]));
  render(<NoteRankingScreen />);
  await act(async () => {});

  expect(screen.getByText('explore.ranking.emptyCity:成都')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('explore.ranking.viewNationwide')); });
  expect(fetchNoteRanking).toHaveBeenLastCalledWith(null);
  expect(screen.getByText('全国第一')).toBeTruthy();
});

test('全国 shows every city, and the city chip opens the shared single-pick city picker', async () => {
  mockUserCity = null;
  jest.mocked(fetchNoteRanking).mockResolvedValue(ranking(null, []));
  render(<NoteRankingScreen />);
  await act(async () => {});
  expect(fetchNoteRanking).toHaveBeenLastCalledWith(null);
  expect(screen.getByText('explore.ranking.empty')).toBeTruthy();
  // 全国榜不要求选城市，空状态不能再叫人去选城市。
  expect(screen.getByText('explore.ranking.emptyHintNationwide')).toBeTruthy();
  expect(screen.queryByText('explore.ranking.emptyHint')).toBeNull();

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
  expect(screen.getByText('explore.ranking.emptyHint')).toBeTruthy();
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

test('after switching to 全国, the city segment goes straight back to the last city', async () => {
  jest.mocked(fetchNoteRanking).mockResolvedValue(ranking(null, []));
  render(<NoteRankingScreen />);
  await act(async () => {});

  await act(async () => { fireEvent.press(screen.getByText('explore.ranking.nationwide')); });
  expect(fetchNoteRanking).toHaveBeenLastCalledWith(null);
  await act(async () => { fireEvent.press(screen.getByText('成都')); });
  expect(fetchNoteRanking).toHaveBeenLastCalledWith('成都');
  expect(mockPush).not.toHaveBeenCalled();

  // 已在城市榜：再点城市那一段就是换城市。
  fireEvent.press(screen.getByText('成都'));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/(tabs)/explore/select-city',
    params: { target: 'ranking', city: '成都' },
  });
});
