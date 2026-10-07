import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import DraftsScreen from './DraftsScreen';
import { fetchNoteDrafts, deleteNoteDraft } from '@/services/api/notes';
import { loadLocalNoteDraft, loadPendingNoteDraftDeletions, saveLocalNoteDraft, type NoteEditorDraftRecord } from '@/features/notes/utils/note-editor-drafts';
import { storage } from '@/storage';

const mockAuth = { user: { id: 'a' }, sessionEpoch: 0 };
const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockTranslate = (key: string) => key;
const mockValues = new Map<string, string>();
const mockRemoveRecording = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/storage', () => ({ storage: {
  getString: (key: string) => mockValues.get(key),
  set: jest.fn((key: string, value: unknown) => { mockValues.set(key, String(value)); }),
  remove: (key: string) => { mockValues.delete(key); },
} }));
jest.mock('@/features/notes/utils/note-recording-storage', () => ({
  isNoteRecordingId: (id: unknown) => typeof id === 'string' && /^recording-[a-z0-9-]{1,80}\.(m4a|webm)$/.test(id),
  removeNoteRecording: (...args: unknown[]) => mockRemoveRecording(...args),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (state: typeof mockAuth) => unknown) => selector(mockAuth), { getState: () => mockAuth }),
}));
jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return { useRouter: () => mockRouter, useFocusEffect: (effect: () => void | (() => void)) => ReactModule.useEffect(effect, [effect]) };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/theme', () => ({
  Spacing: { sm: 8, md: 12, lg: 16, xl: 24 }, Typography: { h2: {}, body: {}, bodyRegular: {}, caption: {} },
  useTheme: () => ({ colors: { background: '#fff', surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666', primary: '#6200ee' } }),
}));
jest.mock('@/features/notes/utils/note-format', () => ({ formatNoteDate: () => 'date' }));
jest.mock('@/services/api/notes', () => ({ fetchNoteDrafts: jest.fn(), deleteNoteDraft: jest.fn() }));

function draft(id: string) {
  return { id, title: id, contentPreview: '', mediaCount: 0, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z' };
}
function localDraft(id: string, overrides: Partial<NoteEditorDraftRecord> = {}): NoteEditorDraftRecord {
  return { version: 1, id, noteId: null, title: id, content: 'Private body', contentJson: [], sections: {}, groupIds: [], mediaKeys: [],
    composerBlocks: [], textBlocksById: {}, mediaItems: [], showcaseItems: [], audioItems: [], mediaOwnerByClientId: {}, contactItems: [], groupCardItems: [],
    location: { title: '', address: '', latitude: null, longitude: null }, createdAt: 0, updatedAt: 1, ...overrides };
}
function confirmDelete(alert: jest.SpyInstance) {
  fireEvent.press(screen.getAllByLabelText('notes.drafts.deleteLabel')[0]);
  act(() => { alert.mock.calls.at(-1)?.[2]?.find((button: { text: string }) => button.text === 'common.delete')?.onPress?.(); });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  jest.clearAllMocks(); mockValues.clear(); mockAuth.user = { id: 'a' }; mockAuth.sessionEpoch = 0;
  jest.mocked(storage.set).mockReset().mockImplementation((key, value) => { mockValues.set(key, String(value)); });
  jest.mocked(fetchNoteDrafts).mockReset().mockResolvedValue([]); jest.mocked(deleteNoteDraft).mockReset().mockResolvedValue(undefined);
  mockRemoveRecording.mockReset().mockResolvedValue(undefined);
});

test('a prior account response cannot populate the next account draft list', async () => {
  const pending = deferred<ReturnType<typeof draft>[]>();
  jest.mocked(fetchNoteDrafts).mockReturnValueOnce(pending.promise).mockResolvedValueOnce([draft('b-draft')]);
  const view = render(<DraftsScreen />);
  await waitFor(() => expect(fetchNoteDrafts).toHaveBeenCalledTimes(1));
  mockAuth.user = { id: 'b' }; mockAuth.sessionEpoch += 1; view.rerender(<DraftsScreen />);
  await screen.findByText('b-draft');
  await act(async () => { pending.resolve([draft('a-private-draft')]); });
  expect(screen.queryByText('a-private-draft')).toBeNull(); expect(screen.getByText('b-draft')).toBeTruthy();
});

test('offline server deletion removes private local content immediately and retries after reopening', async () => {
  saveLocalNoteDraft('a', localDraft('offline-delete'));
  jest.mocked(fetchNoteDrafts).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([draft('offline-delete')]);
  jest.mocked(deleteNoteDraft).mockRejectedValueOnce(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('offline-delete'); confirmDelete(alert);
    expect(screen.queryByText('offline-delete')).toBeNull(); expect(loadLocalNoteDraft('a', 'offline-delete')).toBeNull();
    expect([...mockValues.values()].join('')).not.toContain('Private body');
    await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledWith('offline-delete'));
    await screen.findByText('notes.drafts.deletePending'); expect(loadPendingNoteDraftDeletions('a')).toEqual(['offline-delete']);
    view.unmount(); const reopened = render(<DraftsScreen />);
    await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('notes.drafts.deletePending')).toBeNull());
    expect(screen.queryByText('offline-delete')).toBeNull(); expect(loadPendingNoteDraftDeletions('a')).toEqual([]); reopened.unmount();
  } finally { view.unmount(); alert.mockRestore(); }
});

test('a delayed remote list and later refresh cannot resurrect a deleted local draft', async () => {
  saveLocalNoteDraft('a', localDraft('late-list-delete')); const list = deferred<ReturnType<typeof draft>[]>();
  jest.mocked(fetchNoteDrafts).mockReturnValueOnce(list.promise).mockResolvedValue([draft('late-list-delete'), draft('retained-remote')]);
  jest.mocked(deleteNoteDraft).mockRejectedValue(new Error('offline'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('late-list-delete'); confirmDelete(alert);
    await act(async () => { list.resolve([draft('late-list-delete')]); });
    expect(screen.queryByText('late-list-delete')).toBeNull(); view.unmount();
    const reopened = render(<DraftsScreen />); await screen.findByText('retained-remote');
    expect(screen.queryByText('late-list-delete')).toBeNull(); reopened.unmount();
  } finally { view.unmount(); alert.mockRestore(); }
});

test('deletion re-reads a latest pending publication instead of trusting the old displayed summary', async () => {
  saveLocalNoteDraft('a', localDraft('pending-result')); const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('pending-result');
    saveLocalNoteDraft('a', localDraft('pending-result', { pendingSubmission: { noteId: null, input: { title: 'Original write', media: [], clientDraftID: 'pending-result' } } }));
    confirmDelete(alert);
    expect(alert).toHaveBeenCalledWith('common.errorOccurred', 'notes.drafts.pendingSubmitDeleteBlocked');
    expect(loadLocalNoteDraft('a', 'pending-result')?.pendingSubmission).toBeTruthy(); expect(deleteNoteDraft).not.toHaveBeenCalled();
  } finally { view.unmount(); alert.mockRestore(); }
});

test('local storage failure leaves the draft available and reports failed deletion', async () => {
  saveLocalNoteDraft('a', localDraft('storage-delete')); const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('storage-delete'); jest.mocked(storage.set).mockImplementation(() => { throw new Error('storage unavailable'); });
    confirmDelete(alert); expect(screen.getByText('storage-delete')).toBeTruthy(); expect(loadLocalNoteDraft('a', 'storage-delete')).toBeTruthy();
    expect(deleteNoteDraft).not.toHaveBeenCalled(); expect(alert).toHaveBeenCalledWith('common.errorOccurred', 'notes.drafts.deleteFailed');
  } finally { view.unmount(); alert.mockRestore(); }
});

test('recording cleanup failure keeps the durable retry intent and never acknowledges server deletion', async () => {
  saveLocalNoteDraft('a', localDraft('recording-delete', { audioItems: [{ type: 'AUDIO', objectKey: '', uploadStatus: 'PENDING', clientId: 'recording:private', localRecordingId: 'recording-private.m4a', previewUri: 'file:///documents/private.m4a', sortOrder: 0 }] }));
  mockRemoveRecording.mockRejectedValueOnce(new Error('disk unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('recording-delete'); confirmDelete(alert);
    await waitFor(() => expect(mockRemoveRecording).toHaveBeenCalledTimes(1));
    expect(deleteNoteDraft).not.toHaveBeenCalled(); expect(loadPendingNoteDraftDeletions('a')).toEqual(['recording-delete']);
    fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledWith('recording-delete'));
    await waitFor(() => expect(loadPendingNoteDraftDeletions('a')).toEqual([])); expect(mockRemoveRecording).toHaveBeenCalledTimes(2);
  } finally { view.unmount(); alert.mockRestore(); }
});

test('an old DELETE response cannot clear another account retry queue or hide its draft', async () => {
  saveLocalNoteDraft('a', localDraft('same-draft')); saveLocalNoteDraft('b', localDraft('same-draft')); const deletion = deferred<void>();
  jest.mocked(deleteNoteDraft).mockReturnValueOnce(deletion.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('same-draft'); confirmDelete(alert); await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledTimes(1));
    mockAuth.user = { id: 'b' }; mockAuth.sessionEpoch += 1; view.rerender(<DraftsScreen />); await screen.findByText('same-draft');
    await act(async () => { deletion.resolve(); await deletion.promise; });
    expect(screen.getByText('same-draft')).toBeTruthy(); expect(loadLocalNoteDraft('b', 'same-draft')).toBeTruthy();
    expect(loadPendingNoteDraftDeletions('a')).toEqual(['same-draft']); expect(loadPendingNoteDraftDeletions('b')).toEqual([]);
    expect(screen.queryByText('notes.drafts.deletePending')).toBeNull();
  } finally { deletion.resolve(); view.unmount(); alert.mockRestore(); }
});

test('multiple retry clicks and queued deletions issue one server DELETE at a time', async () => {
  saveLocalNoteDraft('a', localDraft('serial-first')); saveLocalNoteDraft('a', localDraft('serial-second'));
  const first = deferred<void>(); jest.mocked(deleteNoteDraft).mockReturnValueOnce(first.promise);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('serial-first'); confirmDelete(alert); await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledTimes(1));
    confirmDelete(alert); fireEvent.press(screen.getByRole('button', { name: 'common.retry' })); fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    expect(deleteNoteDraft).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); await first.promise; });
    await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledTimes(2)); await waitFor(() => expect(loadPendingNoteDraftDeletions('a')).toEqual([]));
  } finally { first.resolve(); view.unmount(); alert.mockRestore(); }
});

test('partial local content cleanup reports failure and retries before sending DELETE', async () => {
  saveLocalNoteDraft('a', localDraft('partial-storage-delete'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  const remove = jest.spyOn(storage, 'remove').mockImplementation(() => false);
  try {
    await screen.findByText('partial-storage-delete'); confirmDelete(alert);
    expect(screen.queryByText('partial-storage-delete')).toBeNull(); expect(deleteNoteDraft).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('common.errorOccurred', 'notes.drafts.deleteFailed');
    expect([...mockValues.values()].join('')).toContain('Private body');
    remove.mockRestore(); fireEvent.press(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(deleteNoteDraft).toHaveBeenCalledWith('partial-storage-delete'));
    await waitFor(() => expect(loadPendingNoteDraftDeletions('a')).toEqual([]));
    expect([...mockValues.values()].join('')).not.toContain('Private body');
  } finally { remove.mockRestore(); view.unmount(); alert.mockRestore(); }
});

test('an old confirmation cannot delete the next account or epoch draft', async () => {
  saveLocalNoteDraft('a', localDraft('old-confirmation')); saveLocalNoteDraft('b', localDraft('old-confirmation'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); const view = render(<DraftsScreen />);
  try {
    await screen.findByText('old-confirmation'); fireEvent.press(screen.getByLabelText('notes.drafts.deleteLabel'));
    const oldConfirmation = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === 'common.delete');
    mockAuth.user = { id: 'b' }; mockAuth.sessionEpoch += 1; view.rerender(<DraftsScreen />); await screen.findByText('old-confirmation');
    act(() => oldConfirmation?.onPress?.());
    expect(loadLocalNoteDraft('a', 'old-confirmation')).toBeTruthy(); expect(loadLocalNoteDraft('b', 'old-confirmation')).toBeTruthy();
    expect(deleteNoteDraft).not.toHaveBeenCalled(); expect(loadPendingNoteDraftDeletions('b')).toEqual([]);
  } finally { view.unmount(); alert.mockRestore(); }
});
