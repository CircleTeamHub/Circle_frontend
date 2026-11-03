import React from 'react';
import { Alert, ScrollView } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NoteDetailScreen from './NoteDetailScreen';
import { collectNote, fetchNoteDetail } from '@/services/api/notes';
import { resolveNoteCollectSource } from '@/features/notes/utils/collect-note-source';
import type { NoteImageViewport } from '@/features/notes/utils/note-image-viewport';

let mockParams: Record<string, string | string[]>;
let mockAuth = { user: { id: 'me' }, sessionEpoch: 1 };
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
const mockTranslate = (key: string) => key;
let mockBodyProps: any;
let mockViewport: NoteImageViewport | null = null;
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter, useSegments: () => ['(tabs)', 'messages'], useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign(
  (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth), { getState: () => mockAuth },
) }));
jest.mock('@/services/api/notes', () => ({ fetchNoteDetail: jest.fn(), collectNote: jest.fn(), createNoteExport: jest.fn(), notesMutatedSince: () => false }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/services/api/client', () => ({ ApiError: class extends Error {} }));
jest.mock('@/features/notes/utils/collect-note-source', () => ({ resolveNoteCollectSource: jest.fn() }));
jest.mock('@/utils/save-image', () => ({ downloadMediaToCache: jest.fn(), saveMediaToLibrary: jest.fn() }));
jest.mock('@/utils/client-diagnostics', () => ({ logClientDiagnostic: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/notes/components/NoteBlockRenderer', () => ({ NoteImageViewportContext: jest.requireActual<typeof import('react')>('react').createContext(null) }));
jest.mock('@/features/notes/components/NoteDocumentBody', () => ({ NoteDocumentBody: (props: unknown) => {
  mockBodyProps = props;
  mockViewport = jest.requireActual<typeof import('react')>('react').useContext<NoteImageViewport | null>(
    jest.requireMock('@/features/notes/components/NoteBlockRenderer').NoteImageViewportContext,
  );
  return null;
} }));
jest.mock('@/features/notes/components/ShareNoteSheet', () => ({ ShareNoteSheet: () => null }));
jest.mock('@/components/ui/image-viewer', () => ({ ImageViewer: () => null }));
jest.mock('@/theme', () => ({
  Radius: { full: 50 }, Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, Typography: {},
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111', primary: '#6200ee', white: '#fff' } }),
}));

const note = {
  id: 'note', ownerId: 'peer', title: 'Shared', canEdit: false, createdAt: '2026-11-01T00:00:00Z', groups: [],
  media: [], content: 'Content', contentJson: [{ type: 'contact', props: { id: 'private-person' } }],
};
const source = { conversationID: 'conversation', clientMsgID: 'message', conversationType: 'private', sender: { id: 'peer', name: 'Peer' } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockParams = { id: 'note', sourceConversationId: 'conversation', sourceMessageId: 'message', sourceMessageHeight: '50' };
  mockAuth = { user: { id: 'me' }, sessionEpoch: 1 };
  jest.mocked(fetchNoteDetail).mockResolvedValue(note as any);
  jest.mocked(resolveNoteCollectSource).mockResolvedValue(source as any);
  jest.mocked(collectNote).mockResolvedValue({ alreadyCollected: false, note: { id: 'copy' } } as any);
});

afterEach(() => jest.restoreAllMocks());

test('only shows Add for a non-owned note with chat source context', async () => {
  mockParams = { id: 'note' };
  render(<NoteDetailScreen />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'notes.actions.share' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'chat.messageActions.addToNotes' })).toBeNull();
  expect(collectNote).not.toHaveBeenCalled();
}, 15_000);

test('normalizes scalar route values and ignores repeated Add presses during lookup', async () => {
  mockParams = Object.fromEntries(Object.entries(mockParams).map(([key, value]) => [key, [value as string]]));
  let finish!: (value: any) => void;
  jest.mocked(resolveNoteCollectSource).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<NoteDetailScreen />);
  const add = await screen.findByRole('button', { name: 'chat.messageActions.addToNotes' });
  act(() => { fireEvent.press(add); fireEvent.press(add); });
  expect(resolveNoteCollectSource).toHaveBeenCalledTimes(1);
  expect(resolveNoteCollectSource).toHaveBeenCalledWith('note', 'conversation', 'message', '50');
  await act(async () => { finish(source); });
  expect(collectNote).toHaveBeenCalledTimes(1);
  expect(collectNote).toHaveBeenCalledWith('note', source);
  expect(screen.getByRole('button', { name: 'notes.detail.added' })).toBeDisabled();
});

test('does not collect if the account changes during source lookup', async () => {
  let finish!: (value: any) => void;
  jest.mocked(resolveNoteCollectSource).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<NoteDetailScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'chat.messageActions.addToNotes' }));
  mockAuth = { ...mockAuth, sessionEpoch: 2 };
  await act(async () => { finish(source); });
  expect(collectNote).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('does not collect an unavailable source and permits retry', async () => {
  jest.mocked(resolveNoteCollectSource).mockResolvedValue(null);
  render(<NoteDetailScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'chat.messageActions.addToNotes' }));
  await act(async () => {});
  expect(collectNote).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'chat.messageActions.addToNotes' })).not.toBeDisabled();
  expect(Alert.alert).toHaveBeenCalledWith('notes.detail.addFailed', 'notes.detail.addSourceUnavailable');
});

test('holds the duplicate-submit guard during collection and resets after failure', async () => {
  let reject!: (error: Error) => void;
  jest.mocked(collectNote).mockReturnValue(new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
  render(<NoteDetailScreen />);
  const add = await screen.findByRole('button', { name: 'chat.messageActions.addToNotes' });
  fireEvent.press(add);
  await act(async () => {});
  fireEvent.press(add);
  expect(collectNote).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('offline')); });
  expect(screen.getByRole('button', { name: 'chat.messageActions.addToNotes' })).not.toBeDisabled();
  expect(Alert.alert).toHaveBeenCalledWith('notes.detail.addFailed', 'chat.messageActions.collectFailedHint');
});

test('keeps source cards out of read-only NoteDocumentBody content', async () => {
  render(<NoteDetailScreen />);
  await screen.findByRole('button', { name: 'notes.actions.share' });
  expect(mockBodyProps.sections.text.contentJson).toEqual([]);
  expect(mockBodyProps.sections.contacts.items).toEqual([]);
  expect(mockBodyProps.sections.groups.items).toEqual([]);
});

test('measures the viewport through the native ScrollView host', async () => {
  render(<NoteDetailScreen />);
  await screen.findByRole('button', { name: 'notes.actions.share' });
  const scrollView = screen.UNSAFE_getByType(ScrollView);
  const nativeHost = scrollView.instance;
  const measure = jest.spyOn(nativeHost, 'measureInWindow').mockImplementation(
    (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 100, 320, 400),
  );
  const getNativeScrollRef = jest.spyOn(ScrollView.prototype, 'getNativeScrollRef').mockReturnValue(nativeHost);
  const visibility = jest.fn();
  const unregister = mockViewport!.register(200, 100, visibility);
  expect(visibility).toHaveBeenLastCalledWith(false);
  fireEvent(scrollView, 'layout', { nativeEvent: { layout: { x: 0, y: 100, width: 320, height: 400 } } });
  expect(getNativeScrollRef).toHaveBeenCalledTimes(1);
  expect(measure).toHaveBeenCalledTimes(1);
  expect(visibility).toHaveBeenLastCalledWith(true);
  unregister();
});
