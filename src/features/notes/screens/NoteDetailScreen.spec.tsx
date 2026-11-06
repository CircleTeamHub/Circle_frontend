import React from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NoteDetailScreen from './NoteDetailScreen';
import { collectNote, fetchNoteDetail, findCollectedNote } from '@/services/api/notes';
import { Avatar } from '@/components/ui/avatar';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { resolveNoteCollectSource } from '@/features/notes/utils/collect-note-source';
import type { NoteImageViewport } from '@/features/notes/utils/note-image-viewport';
import { recordMetric } from '@/observability/metrics';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

let mockParams: Record<string, string | string[]>;
let mockAuth = { user: { id: 'me' }, sessionEpoch: 1 };
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
const mockTranslate = (key: string) => key;
let mockBodyProps: any;
let mockViewport: NoteImageViewport | null = null;
let mockClock = 0;
jest.mock('@/observability/metrics', () => ({ recordMetric: jest.fn() }));
jest.mock('@/observability/http-diagnostics', () => ({ diagnosticNow: () => mockClock }));
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
jest.mock('@/services/api/notes', () => ({ fetchNoteDetail: jest.fn(), findCollectedNote: jest.fn(), collectNote: jest.fn(), createNoteExport: jest.fn(), notesMutatedSince: () => false }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
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
  mockClock = 0;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockParams = { id: 'note', sourceConversationId: 'conversation', sourceMessageId: 'message', sourceMessageHeight: '50' };
  mockAuth = { user: { id: 'me' }, sessionEpoch: 1 };
  jest.mocked(fetchNoteDetail).mockResolvedValue(note as any);
  jest.mocked(findCollectedNote).mockResolvedValue(null);
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

test('separates source lookup from collection request duration without recording note data', async () => {
  let finishSource!: (value: any) => void;
  let finishCollect!: (value: any) => void;
  jest.mocked(resolveNoteCollectSource).mockReturnValue(new Promise((resolve) => { finishSource = resolve; }));
  jest.mocked(collectNote).mockReturnValue(new Promise((resolve) => { finishCollect = resolve; }));
  render(<NoteDetailScreen />);
  const add = await screen.findByRole('button', { name: 'chat.messageActions.addToNotes' });
  mockClock = 100;
  fireEvent.press(add);
  mockClock = 600;
  await act(async () => finishSource(source));
  mockClock = 2100;
  await act(async () => finishCollect({ note: { id: 'copy' }, alreadyCollected: false }));
  expect(logClientDiagnostic).toHaveBeenCalledWith('note.collect.phase', { stage: 'source', durationMs: 500 });
  expect(logClientDiagnostic).toHaveBeenCalledWith('note.collect.phase', { stage: 'request', durationMs: 1500 });
  expect(recordMetric).toHaveBeenCalledWith('app.operation.duration', 2000, { operation: 'noteCollect', outcome: 'success' });
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

test('keeps all card sections, nested inline cards and avatar actions private for an uncollected shared note', async () => {
  mockParams.ownerId = 'me'; // Navigation params cannot grant card visibility.
  jest.mocked(fetchNoteDetail).mockResolvedValue({ ...note, sections: {
    text: { content: 'Visible', contentJson: [{ type: 'noteLayout', props: {
      blocks: [{ id: 'body', kind: 'text' }], textBlocks: [{ id: 'body', content: [{ type: 'group', props: { id: 'private-group' } }] }],
    } }] },
    contacts: { items: [{ id: 'private-person', name: 'Private person' }] },
    groups: { items: [{ id: 'private-group', name: 'Private group' }] },
  } } as any);
  render(<NoteDetailScreen />);
  await screen.findByRole('button', { name: 'notes.actions.share' });
  expect(mockBodyProps.sections.contacts.items).toEqual([]);
  expect(mockBodyProps.sections.groups.items).toEqual([]);
  expect(JSON.stringify(mockBodyProps.layout)).not.toContain('private-group');
  expect(screen.queryByTestId('note-contact-chat')).toBeNull();
  expect(screen.queryByTestId('note-group-chat')).toBeNull();
});

const privateCards = {
  conversationType: 'group', conversationID: 'group-chat', clientMsgID: 'original-message', sourceNoteId: 'note',
  sender: { id: 'sender', name: 'Saved person', faceURL: 'https://cdn/person.jpg' },
  group: { id: 'circle', name: 'Saved group', faceURL: 'https://cdn/group.jpg' },
};
const savedCopy = { ...note, id: 'saved-copy', ownerId: 'me', canEdit: true, collectedFrom: privateCards, cardPreview: null };

test.each(['created', 'collected'])('an owned %s note shows its group card and circular avatar actions linked to the same chats', async (kind) => {
  const owned = kind === 'collected' ? { ...savedCopy, id: 'note' } : { ...note, ownerId: 'me', canEdit: true,
    sections: { contacts: { items: [privateCards.sender] }, groups: { items: [{ ...privateCards.group, conversationID: 'group-chat' }] } } };
  jest.mocked(fetchNoteDetail).mockResolvedValue(owned as any);
  render(<NoteDetailScreen />);
  const person = await screen.findByTestId('note-contact-chat');
  const group = screen.getByTestId('note-group-chat');
  expect(mockBodyProps.sections.groups.items[0]).toMatchObject({ ...privateCards.group, conversationID: 'group-chat' });
  expect(mockBodyProps.order).toContain('group');
  expect(screen.UNSAFE_getByType(Avatar).props.uri).toBe(privateCards.sender.faceURL);
  expect(screen.UNSAFE_getByType(GroupChatAvatar).props.uri).toBe(privateCards.group.faceURL);
  expect(person).toHaveStyle({ width: 48, height: 48, borderRadius: 50 });
  expect(StyleSheet.flatten(group.findByType(View).props.style)).toMatchObject({ borderRadius: 50, overflow: 'hidden' });
  fireEvent.press(person);
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/chat-detail', params: {
    sourceID: 'sender', title: 'Saved person', avatarUrl: privateCards.sender.faceURL, conversationType: 'private',
  } });
  fireEvent.press(group);
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/group-entry', params: {
    groupId: 'group-chat', ...(kind === 'collected' ? { searchedMsgID: 'original-message' } : {}),
  } });
  expect(findCollectedNote).not.toHaveBeenCalled();
});

test('a previously added shared note uses the current viewer copy instead of the sender cards', async () => {
  jest.mocked(findCollectedNote).mockResolvedValue(savedCopy as any);
  render(<NoteDetailScreen />);
  await screen.findByTestId('note-group-chat');
  expect(mockBodyProps.sections.groups.items[0].name).toBe('Saved group');
  expect(screen.UNSAFE_getByType(Avatar).props.name).toBe('Saved person');
});

test('successful collection reveals the returned copy cards immediately', async () => {
  jest.mocked(collectNote).mockResolvedValue({ alreadyCollected: false, note: savedCopy } as any);
  render(<NoteDetailScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'chat.messageActions.addToNotes' }));
  await screen.findByTestId('note-group-chat');
  expect(mockBodyProps.sections.groups.items[0].name).toBe('Saved group');
});

test('a late saved-copy lookup cannot overwrite the cards returned by collection', async () => {
  let finish!: (value: any) => void;
  jest.mocked(findCollectedNote).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  jest.mocked(collectNote).mockResolvedValue({ alreadyCollected: false, note: savedCopy } as any);
  render(<NoteDetailScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'chat.messageActions.addToNotes' }));
  await screen.findByTestId('note-group-chat');
  await act(async () => finish(null));
  expect(screen.getByTestId('note-group-chat')).toBeTruthy();
});

test('saved-copy lookup and route changes cannot show another account or note cards', async () => {
  let finish!: (value: any) => void;
  jest.mocked(findCollectedNote).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue(null);
  const view = render(<NoteDetailScreen />);
  await waitFor(() => expect(findCollectedNote).toHaveBeenCalled());
  mockAuth = { user: { id: 'other' }, sessionEpoch: 2 };
  mockParams = { id: 'another-note' };
  jest.mocked(fetchNoteDetail).mockResolvedValue({ ...note, id: 'another-note' } as any);
  view.rerender(<NoteDetailScreen />);
  await act(async () => finish(savedCopy));
  expect(screen.queryByTestId('note-contact-chat')).toBeNull();
  expect(screen.queryByTestId('note-group-chat')).toBeNull();
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
