import React from 'react';
import { Alert, FlatList } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NotesScreen from './NotesScreen';
import NoteManagementScreen from './NoteManagementScreen';
import { fetchNoteDraft, fetchNotes, fetchNoteGroups, getCachedNotes } from '@/services/api/notes';
import { publishInterruptedNotes } from '@/features/notes/utils/interrupted-note-recovery';
import type { NoteSummary } from '@/features/notes/types';
import { useNotesSortStore } from '@/features/notes/store/use-notes-sort-store';

const mockRouter = { push: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockTranslate = (key: string) => key;
const mockOrder: string[] = [];
const mockParams: { conversationID: string; highlightNoteId?: string } = { conversationID: 'managed-room' };
jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return { useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, useSegments: () => ['(tabs)', 'profile'],
    useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(effect, [effect]) };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/stores/authStore', () => {
  // Both screens key their content by `${user.id}:${sessionEpoch}` and re-check the epoch via getState().
  const state = { user: { id: 'owner' }, sessionEpoch: 1 };
  return { useAuthStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) };
});
jest.mock('@/features/notes/store/use-notes-tab-order-store', () => ({ useNotesTabOrderStore: (selector: (state: { orderIds: string[] }) => unknown) => selector({ orderIds: mockOrder }) }));
jest.mock('@/storage', () => ({ storage: { getString: () => undefined },
  mmkvJsonStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } }));
jest.mock('@/features/notes/utils/note-recording-storage', () => ({}));
jest.mock('@/features/notes/utils/interrupted-note-recovery', () => ({
  publishInterruptedNotes: jest.fn(async () => ({ published: 0, resumeDraft: null })),
}));
jest.mock('@/services/api/notes', () => ({ fetchNotes: jest.fn(() => Promise.reject(new Error('offline'))), fetchNoteGroups: jest.fn(() => Promise.reject(new Error('offline'))), fetchNoteDraft: jest.fn(),
  // No persisted page snapshot by default: every screen starts from the network load under test.
  getCachedNotes: jest.fn(() => null), getCachedNoteGroups: () => null }));
jest.mock('@/services/api/client', () => ({ ApiError: class ApiError extends Error { status = 0; } }));
jest.mock('@/features/notes/components/NoteCard', () => {
  const { Pressable, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { NoteCard: ({ note, onSourcePress, onMorePress, showCreatedAt }: { note: NoteSummary; onSourcePress?: (note: NoteSummary, target: 'sender' | 'group') => void; onMorePress?: (note: NoteSummary) => void; showCreatedAt?: boolean }) => (
    <View>
      <Text testID="note-title">{note.title}</Text>
      <Text testID="note-time-field">{showCreatedAt ? 'created' : 'updated'}</Text>
      <Pressable testID="note-contact" onPress={() => onSourcePress?.(note, 'sender')}><Text>Contact</Text></Pressable>
      <Pressable testID="note-group" onPress={() => onSourcePress?.(note, 'group')}><Text>Group</Text></Pressable>
      <Pressable testID="note-more" onPress={() => onMorePress?.(note)}><Text>More</Text></Pressable>
      <Text testID="note-rating-counts">{`${note.goodCount ?? '-'}/${note.badCount ?? '-'}`}</Text>
    </View>
  ) };
});
type MockSheetProps = {
  note: NoteSummary | null;
  onRateGood?: (note: NoteSummary) => void;
  onRateBad?: (note: NoteSummary) => void;
  onViewBadRatings?: (note: NoteSummary) => void;
};
let mockSheetProps: MockSheetProps | null = null;
jest.mock('@/features/notes/components/NoteActionsSheet', () => ({ NoteActionsSheet: (props: MockSheetProps) => {
  mockSheetProps = props;
  return null;
} }));
const mockRateGood = jest.fn((_noteId: string, _onRated?: (counts: { goodCount: number; badCount: number }) => void) => Promise.resolve());
const mockStartBad = jest.fn((_noteId: string, _onRated?: (counts: { goodCount: number; badCount: number }) => void) => Promise.resolve());
jest.mock('@/features/notes/rating/note-rating-flow', () => ({
  rateNoteGood: (...args: [string, never]) => mockRateGood(...args),
  startBadNoteRating: (...args: [string, never]) => mockStartBad(...args),
}));
jest.mock('@/features/notes/components/NoteRemarkSheet', () => ({ NoteRemarkSheet: () => null }));
jest.mock('@/features/notes/components/NoteGroupPickerSheet', () => ({ NoteGroupPickerSheet: () => null }));
jest.mock('@/features/notes/components/ShareNoteSheet', () => ({ ShareNoteSheet: () => null }));
jest.mock('@/features/notes/components/GroupManagerSheet', () => ({ GroupManagerSheet: () => null }));
jest.mock('@/chat-core/store', () => {
  const state = { currentUserId: 'owner', conversations: [{ id: 'managed-room', ownerId: 'owner', name: 'Badminton Club', myRemark: 'Saturday games', circle: null }] };
  return { useChatStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});
jest.mock('@/chat-core/api', () => ({ fetchChatMembers: jest.fn(async () => [{ userId: 'owner', role: 'OWNER' }]), refreshConversationOrList: jest.fn(async () => undefined) }));
jest.mock('@/services/api/circles', () => ({ fetchCircleDetail: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/bottom-sheet-modal', () => ({ BottomSheetModal: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/theme', () => ({
  Radius: { full: 50, pill: 50 }, Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, Typography: { h1: {}, body: {}, bodyRegular: {}, small: {} },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666', primary: '#6200ee', divider: '#ddd', white: '#fff' } }),
  withAlpha: (value: string) => value,
}));

test('offline New generates distinct route IDs and explicitly requests a fresh editor', async () => {
  mockRouter.push.mockClear(); render(<NotesScreen />);
  await screen.findByText('notes.loadFailed');
  fireEvent.press(screen.getByRole('button', { name: 'notes.actions.new' }));
  fireEvent.press(screen.getByRole('button', { name: 'notes.actions.new' }));
  const routes = mockRouter.push.mock.calls.map(([route]) => route as { pathname: string; params: { draftId: string; draftMode: string } });
  expect(routes).toHaveLength(2);
  expect(routes[0].pathname).toBe('/(tabs)/profile/notes/edit'); expect(routes[0].params.draftMode).toBe('new');
  expect(routes[0].params.draftId).toBeTruthy(); expect(routes[1].params.draftId).not.toBe(routes[0].params.draftId);
  expect(fetchNoteDraft).not.toHaveBeenCalled();
});

test('a note requiring recovery opens the existing editor with the saved draft ID', async () => {
  mockRouter.push.mockClear();
  jest.mocked(publishInterruptedNotes).mockResolvedValueOnce({
    published: 0, resumeDraft: { draftId: 'saved-draft', noteId: 'existing-note' },
  });
  render(<NotesScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'notes.resumeInterrupted' }));
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/profile/notes/edit', params: { draftId: 'saved-draft', draftMode: 'recovery', id: 'existing-note' },
  });
});

describe.each([['notes', NotesScreen], ['group notes', NoteManagementScreen]] as const)('%s contact navigation', (_name, Screen) => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchNoteGroups).mockResolvedValue([]);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const note = (overrides: Partial<NoteSummary> = {}): NoteSummary => ({
    id: 'note', ownerId: 'owner', title: 'My note', contentPreview: '', status: 'ACTIVE', available: true,
    pinned: false, groups: [], cover: null, imageCount: 0, videoCount: 0, mediaCount: 0,
    sourceConversationID: 'managed-room', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
    cardPreview: { contacts: [{ id: 'owner', name: 'Me' }], groups: [] }, ...overrides,
  });

  test.each(Screen === NotesScreen ? ['explicit card', 'collected sender'] : ['explicit card'])('shows the self-card notice instead of opening a self-chat for %s', async (origin) => {
    jest.mocked(fetchNotes).mockResolvedValue([note(origin === 'collected sender' ? {
      cardPreview: null,
      collectedFrom: { conversationType: 'private', conversationID: 'old-conversation', clientMsgID: 'message', sender: { id: 'owner', name: 'Me' } },
    } : {})]);
    render(<Screen />);
    fireEvent.press(await screen.findByTestId('note-contact'));
    expect(Alert.alert).toHaveBeenCalledWith('qr.thisIsYou');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  test('still opens another person in the current tab even when the note belongs to me', async () => {
    jest.mocked(fetchNotes).mockResolvedValue([note({ cardPreview: { contacts: [{ id: 'peer', name: 'Peer' }], groups: [] } })]);
    render(<Screen />);
    fireEvent.press(await screen.findByTestId('note-contact'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/profile/chat-detail', params: {
      sourceID: 'peer', title: 'Peer', conversationType: 'private',
    } });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('keeps the group-card navigation available', async () => {
    jest.mocked(fetchNotes).mockResolvedValue([note({ cardPreview: { contacts: [], groups: [{ id: 'circle', name: 'Circle' }] } })]);
    render(<Screen />);
    fireEvent.press(await screen.findByTestId('note-group'));
    // 圈子详情开在笔记所在的栈(这里是「我的」),不再折到消息栈。
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/profile/circle/[id]', params: { id: 'circle' } });
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('好评 / 差评 from the ⋯ sheet', () => {
  const copy = {
    id: 'copy-1', ownerId: 'owner', title: 'Collected', contentPreview: '', status: 'ACTIVE', available: true,
    pinned: false, groups: [], cover: null, imageCount: 0, videoCount: 0, mediaCount: 0,
    createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z', goodCount: 2, badCount: 0,
    collectedFrom: { conversationType: 'group', conversationID: 'g', clientMsgID: 'm', sender: { id: 'boss', name: 'Boss' }, sourceNoteId: 'root-1' },
  } as unknown as NoteSummary;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSheetProps = null;
    jest.mocked(fetchNoteGroups).mockResolvedValue([]);
  });

  test("rates the copy's source note and shows the new counters on its card", async () => {
    jest.mocked(fetchNotes).mockResolvedValue([copy]);
    render(<NotesScreen />);
    fireEvent.press(await screen.findByTestId('note-more'));
    expect(screen.getByTestId('note-rating-counts')).toHaveTextContent('2/0');

    act(() => mockSheetProps?.onRateGood?.(mockSheetProps.note!));
    expect(mockRateGood).toHaveBeenCalledWith('copy-1', expect.any(Function));
    act(() => mockRateGood.mock.calls[0][1]?.({ goodCount: 3, badCount: 0 }));

    expect(screen.getByTestId('note-rating-counts')).toHaveTextContent('3/0');
  });

  test('差评 starts the reason flow for the same note', async () => {
    jest.mocked(fetchNotes).mockResolvedValue([copy]);
    render(<NotesScreen />);
    fireEvent.press(await screen.findByTestId('note-more'));

    act(() => mockSheetProps?.onRateBad?.(mockSheetProps.note!));

    expect(mockStartBad).toHaveBeenCalledWith('copy-1', expect.any(Function));
  });

  test('查看差评 opens the bad-rating list in the 我的 stack', async () => {
    jest.mocked(fetchNotes).mockResolvedValue([{ ...copy, id: 'mine', collectedFrom: null }]);
    render(<NotesScreen />);
    fireEvent.press(await screen.findByTestId('note-more'));

    act(() => mockSheetProps?.onViewBadRatings?.(mockSheetProps.note!));

    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/profile/notes/bad-ratings', params: { id: 'mine' } });
  });
});

describe('搜索也能按名片名字找笔记', () => {
  const base = {
    ownerId: 'owner', contentPreview: '', status: 'ACTIVE', available: true, pinned: false, groups: [], cover: null,
    imageCount: 0, videoCount: 0, mediaCount: 0, sourceConversationID: null, cardPreview: null,
    createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
  };
  const notes = [
    { ...base, id: 'a', title: 'Alpha', cardPreview: { contacts: [{ id: 'p1', name: 'Zhang San' }], groups: [] } },
    { ...base, id: 'b', title: 'Beta', cardPreview: { contacts: [], groups: [{ id: 'c1', name: 'Weekend Hikers' }] } },
    { ...base, id: 'c', title: 'Gamma', collectedFrom: {
      conversationType: 'group', conversationID: 'g', clientMsgID: 'm', sender: { id: 'boss', name: 'Boss Li' }, group: { id: 'g', name: 'Chess Club' },
    } },
    { ...base, id: 'd', title: 'Delta', sourceConversationID: 'managed-room' },
    { ...base, id: 'e', title: 'Epsilon' },
  ] as unknown as NoteSummary[];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchNoteGroups).mockResolvedValue([]);
    jest.mocked(fetchNotes).mockResolvedValue(notes);
  });

  test.each([
    ['a contact card', 'zhang', ['Alpha']],
    ['a group card', 'HIKERS', ['Beta']],
    ['the collected-from sender', 'boss li', ['Gamma']],
    ['the collected-from group', 'chess', ['Gamma']],
    ['the bound source group name', 'badminton', ['Delta']],
    ['my remark for the bound source group', 'saturday', ['Delta']],
    ['the title, as before', 'epsilon', ['Epsilon']],
  ])('matches %s', async (_what, query, expected) => {
    render(<NotesScreen />);
    expect(await screen.findAllByTestId('note-title')).toHaveLength(notes.length);

    fireEvent.changeText(screen.getByPlaceholderText('notes.searchPlaceholder'), query);

    expect(screen.getAllByTestId('note-title').map((node) => node.props.children)).toEqual(expected);
  });
});

describe('进页不卡:首帧只出页面壳', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchNoteGroups).mockResolvedValue([]);
  });

  test('有缓存笔记时,卡片下一帧才渲染,中间也不闪「暂无笔记」', async () => {
    const cached = {
      id: 'cached', ownerId: 'owner', title: 'Cached', contentPreview: '', status: 'ACTIVE', available: true,
      pinned: false, groups: [], cover: null, imageCount: 0, videoCount: 0, mediaCount: 0,
      createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
    } as unknown as NoteSummary;
    jest.mocked(getCachedNotes).mockReturnValueOnce({ value: [cached], at: Date.now() });
    // 网络一直不回:页面上只有缓存那一份。
    jest.mocked(fetchNotes).mockReturnValue(new Promise(() => undefined));

    render(<NotesScreen />);

    expect(screen.getByText('notes.title')).toBeTruthy();
    expect(screen.queryByTestId('note-more')).toBeNull();
    expect(screen.queryByText('notes.empty.noNotes')).toBeNull();
    expect(await screen.findByTestId('note-more')).toBeTruthy();
  });
});

test('the header back button is announced to screen readers and goes back', async () => {
  render(<NotesScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'common.back' }));
  expect(mockRouter.back).toHaveBeenCalled();
});

describe('排序栏', () => {
  // a 最早添加、最近编辑；c 最晚添加、最早编辑。
  const sortable = (id: string, created: string, updated: string) => ({
    id, ownerId: 'owner', title: id.toUpperCase(), contentPreview: '', status: 'ACTIVE', available: true,
    pinned: false, groups: [], cover: null, imageCount: 0, videoCount: 0, mediaCount: 0,
    createdAt: `2026-11-${created}T00:00:00Z`, updatedAt: `2026-11-${updated}T00:00:00Z`,
  }) as unknown as NoteSummary;
  const titles = () => screen.getAllByTestId('note-title').map((node) => node.props.children);

  beforeEach(() => {
    jest.clearAllMocks();
    useNotesSortStore.setState({ byUser: {} });
    jest.mocked(fetchNoteGroups).mockResolvedValue([]);
    jest.mocked(fetchNotes).mockResolvedValue([sortable('c', '09', '02'), sortable('a', '01', '20'), sortable('b', '05', '10')]);
  });

  test('按选中的排序方式重排列表，手动排序可以把一条移到最前', async () => {
    render(<NotesScreen />);
    expect(await screen.findAllByTestId('note-title')).toHaveLength(3);
    expect(titles()).toEqual(['A', 'B', 'C']);

    expect(screen.getAllByTestId('note-time-field')[0].props.children).toBe('updated');
    fireEvent.press(screen.getByRole('tab', { name: 'notes.sort.added' }));
    expect(titles()).toEqual(['C', 'B', 'A']);
    // 按添加时间排，卡片上也显示添加时间。
    expect(screen.getAllByTestId('note-time-field').map((node) => node.props.children)).toEqual(['created', 'created', 'created']);
    expect(screen.queryByRole('button', { name: 'notes.sort.adjust' })).toBeNull();

    // 还没手动排过：先按添加时间排，右侧出现「调整顺序」。
    fireEvent.press(screen.getByRole('tab', { name: 'notes.sort.manual' }));
    expect(titles()).toEqual(['C', 'B', 'A']);
    fireEvent.press(screen.getByRole('button', { name: 'notes.sort.adjust' }));
    // 第一行没有「移到最前」；点最后一行（A）的。
    const toFront = screen.getAllByRole('button', { name: 'notes.sort.moveToFront' });
    fireEvent.press(toFront[toFront.length - 1]);
    expect(titles()).toEqual(['A', 'C', 'B']);
  });

  test('下次进来默认用上一次选的排序方式', async () => {
    const first = render(<NotesScreen />);
    await screen.findAllByTestId('note-title');
    fireEvent.press(screen.getByRole('tab', { name: 'notes.sort.added' }));
    first.unmount();

    render(<NotesScreen />);
    await screen.findAllByTestId('note-title');
    expect(screen.getByRole('tab', { name: 'notes.sort.added' }).props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(titles()).toEqual(['C', 'B', 'A']);
  });
});

test('「查看」定位把目标笔记放在浮动头部下面，而不是被头部盖住', async () => {
  jest.clearAllMocks();
  const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  jest.mocked(fetchNoteGroups).mockResolvedValue([]);
  jest.mocked(fetchNotes).mockResolvedValue(['one', 'two', 'three'].map((id) => ({
    id, ownerId: 'owner', title: id, contentPreview: '', status: 'ACTIVE', available: true,
    pinned: false, groups: [], cover: null, imageCount: 0, videoCount: 0, mediaCount: 0,
    createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
  }) as unknown as NoteSummary));
  mockParams.highlightNoteId = 'three';
  try {
    render(<NotesScreen />);
    await waitFor(() => expect(scrollToIndex).toHaveBeenCalled());
    // 视口从安全区顶边算起：顶到展开头部（jest 里量出来是 0）再加 8 的留白之下。
    expect(scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 2, viewPosition: 0, viewOffset: 8 }));
  } finally {
    delete mockParams.highlightNoteId;
    scrollToIndex.mockRestore();
  }
});
