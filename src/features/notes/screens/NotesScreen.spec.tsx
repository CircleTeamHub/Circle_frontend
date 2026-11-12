import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NotesScreen from './NotesScreen';
import NoteManagementScreen from './NoteManagementScreen';
import { fetchNoteDraft, fetchNotes, fetchNoteGroups } from '@/services/api/notes';
import type { NoteSummary } from '@/features/notes/types';

const mockRouter = { push: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockTranslate = (key: string) => key;
const mockOrder: string[] = [];
jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return { useRouter: () => mockRouter, useLocalSearchParams: () => ({ conversationID: 'managed-room' }), useSegments: () => ['(tabs)', 'profile'],
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
jest.mock('@/storage', () => ({ storage: { getString: () => undefined } }));
jest.mock('@/features/notes/utils/note-recording-storage', () => ({}));
jest.mock('@/services/api/notes', () => ({ fetchNotes: jest.fn(() => Promise.reject(new Error('offline'))), fetchNoteGroups: jest.fn(() => Promise.reject(new Error('offline'))), fetchNoteDraft: jest.fn(),
  // No persisted page snapshot: every screen starts from the network load under test.
  getCachedNotes: () => null, getCachedNoteGroups: () => null }));
jest.mock('@/services/api/client', () => ({ ApiError: class ApiError extends Error { status = 0; } }));
jest.mock('@/features/notes/components/NoteCard', () => {
  const { Pressable, Text, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { NoteCard: ({ note, onSourcePress, onMorePress }: { note: NoteSummary; onSourcePress?: (note: NoteSummary, target: 'sender' | 'group') => void; onMorePress?: (note: NoteSummary) => void }) => (
    <View>
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
jest.mock('@/chat-core/store', () => ({ useChatStore: (select: (state: unknown) => unknown) => select({ currentUserId: 'owner', conversations: [{ id: 'managed-room', ownerId: 'owner' }] }) }));
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
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/circle/[id]', params: { id: 'circle' } });
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
