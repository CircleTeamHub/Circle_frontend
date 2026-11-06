import { act, renderHook } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/chat-core/store';
import type { ChatMessage } from '@/types';
import { useCollectMessage, type CollectMessageParams } from './use-collect-message';
import { useNoteCollectPreferencesStore } from '@/features/notes/store/use-note-collect-preferences-store';

const mockCreateCollection = jest.fn();
const mockCollectNote = jest.fn();
const mockFetchGroups = jest.fn();
const mockFindCollectedNote = jest.fn();
const mockCreateNoteGroup = jest.fn();
const mockBump = jest.fn();
const mockReportFailure = jest.fn();
const mockRecordMetric = jest.fn();
let mockClock = 0;
jest.mock('@/observability/metrics', () => ({ recordMetric: (...args: unknown[]) => mockRecordMetric(...args) }));
jest.mock('@/observability/http-diagnostics', () => ({ diagnosticNow: () => mockClock }));
jest.mock('@/services/api/collections', () => ({ createCollection: (...args: unknown[]) => mockCreateCollection(...args) }));
jest.mock('@/services/api/notes', () => ({ collectNote: (...args: unknown[]) => mockCollectNote(...args), fetchNoteGroups: () => mockFetchGroups(), findCollectedNote: (...args: unknown[]) => mockFindCollectedNote(...args), createNoteGroup: (...args: unknown[]) => mockCreateNoteGroup(...args) }));
jest.mock('@/features/notes/store/use-note-collect-preferences-store', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useNoteCollectPreferencesStore: create((set: (partial: object) => void) => ({
      chooseGroup: true,
      editTitle: true,
      setChooseGroup: (chooseGroup: boolean) => set({ chooseGroup }),
      setEditTitle: (editTitle: boolean) => set({ editTitle }),
    })),
  };
});
jest.mock('@/features/notes/store/use-note-list-signal-store', () => ({ useNoteListSignalStore: { getState: () => ({ bump: mockBump }) } }));
jest.mock('@/features/notes/components/AddNoteToNotesSheet', () => ({ AddNoteToNotesSheet: () => null }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: (...args: unknown[]) => mockReportFailure(...args) }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/i18n', () => ({ t: (key: string) => key }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/stores/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return { useAuthStore: create(() => ({ user: { id: 'me' }, sessionEpoch: 1 })) };
});
jest.mock('@/chat-core/store', () => {
  const { create } = jest.requireActual('zustand');
  return { useChatStore: create(() => ({ activeConversationId: 'c1', messagesByConversation: {} })) };
});

const textMessage: ChatMessage = { id: 'm1', type: 'received', text: 'hello' };
const noteMessage: ChatMessage = {
  id: 'note-message', type: 'note-card',
  noteCard: { noteId: 'n1', ownerId: 'peer', title: 'Original title' } as ChatMessage['noteCard'],
};
let params: CollectMessageParams;
type SheetProps = {
  visible: boolean;
  noteTitle: string;
  groups: unknown[];
  loading: boolean;
  chooseGroup: boolean;
  editTitle: boolean;
  onClose: () => void;
  onCreateGroup: (name: string) => Promise<{ id: string; name: string } | null>;
  onConfirm: (selection: { targetNoteGroupId: string | null; title: string; disableTitleEditing?: boolean }) => Promise<void>;
};
const sheet = (value: ReturnType<typeof useCollectMessage>) => (value.noteCollectSheet as ReactElement<SheetProps>).props;

beforeEach(() => {
  jest.useFakeTimers();
  mockCreateCollection.mockReset().mockResolvedValue({ id: 'collection' });
  mockCollectNote.mockReset().mockResolvedValue({ note: { id: 'copy' }, alreadyCollected: false });
  mockFetchGroups.mockReset().mockResolvedValue([{ id: 'private-group', name: 'Private' }]);
  mockFindCollectedNote.mockReset().mockResolvedValue(null);
  mockCreateNoteGroup.mockReset().mockResolvedValue({ id: 'new-group', name: '新分组' });
  useNoteCollectPreferencesStore.setState({ chooseGroup: true, editTitle: true });
  mockBump.mockReset(); mockReportFailure.mockReset();
  mockRecordMetric.mockReset(); mockClock = 0;
  useAuthStore.setState({ user: { id: 'me' } as never, sessionEpoch: 1 });
  useChatStore.setState({ activeConversationId: 'c1', messagesByConversation: {} });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  params = {
    t: ((key: string) => key) as CollectMessageParams['t'], currentUserID: 'me', sourceID: 'peer',
    conversationID: 'c1', isGroupChat: false, conversationTitle: 'Peer', avatarUrl: undefined,
    selfAvatarUri: undefined, selfName: 'Me',
  };
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

async function showSheet() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { jest.advanceTimersByTime(32); });
}

test('silent collection returns success using the confirmed message snapshot source and shows no alert', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  let outcome: unknown;
  await act(async () => { outcome = await result.current.handleCollectMessage(textMessage, { silent: true }); });
  expect(outcome).toBe('collected');
  expect(mockCreateCollection).toHaveBeenCalledWith(expect.objectContaining({
    sourceID: 'm1', payload: expect.objectContaining({ messageID: 'm1', conversationID: 'c1', sourceID: 'peer' }),
  }));
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('silent collection returns failure once and retains redacted diagnostics without alerting', async () => {
  const error = new Error('offline'); mockCreateCollection.mockRejectedValue(error);
  const { result } = renderHook(() => useCollectMessage(params));
  let outcome: unknown;
  await act(async () => { outcome = await result.current.handleCollectMessage(textMessage, { silent: true }); });
  expect(outcome).toBe('failed');
  expect(mockCreateCollection).toHaveBeenCalledTimes(1);
  expect(mockReportFailure).toHaveBeenCalledWith('chatDetail', 'collectMessage', error);
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('ordinary single collection keeps its success alert and returns collected', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  let outcome: unknown;
  await act(async () => { outcome = await result.current.handleCollectMessage(textMessage); });
  expect(outcome).toBe('collected');
  expect(Alert.alert).toHaveBeenCalledWith('chat.messageActions.collected', 'chat.messageActions.collectedHint');
});

test.each([
  { id: 'local:unconfirmed', type: 'received' },
  { id: 'date', type: 'date' },
  { ...noteMessage, noteCard: undefined },
  { ...noteMessage, noteCard: { ...noteMessage.noteCard, ownerId: 'me' } },
] as ChatMessage[])('silent unsupported, local, or owned item is skipped (%o)', async (message) => {
  const { result } = renderHook(() => useCollectMessage(params));
  let outcome: unknown;
  await act(async () => { outcome = await result.current.handleCollectMessage(message, { silent: true }); });
  expect(outcome).toBe('skipped');
  expect(mockCreateCollection).not.toHaveBeenCalled(); expect(mockCollectNote).not.toHaveBeenCalled();
  expect(result.current.noteCollectVisible).toBe(false); expect(Alert.alert).not.toHaveBeenCalled();
});

test('silent note waits for the existing group and title confirmation before resolving collected', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  let settled = false; let pending!: Promise<unknown>;
  act(() => { pending = result.current.handleCollectMessage(noteMessage, { silent: true }); void pending.then(() => { settled = true; }); });
  await showSheet();
  expect(settled).toBe(false);
  expect(sheet(result.current)).toEqual(expect.objectContaining({ visible: true, noteTitle: 'Original title', groups: [{ id: 'private-group', name: 'Private' }] }));
  expect(mockCollectNote).not.toHaveBeenCalled();
  mockCollectNote.mockImplementation(async () => {
    mockClock += 1500;
    return { note: { id: 'copy' }, alreadyCollected: false };
  });
  await act(async () => { await sheet(result.current).onConfirm({ targetNoteGroupId: 'private-group', title: 'Edited title' }); });
  expect(mockRecordMetric).toHaveBeenCalledWith('app.operation.duration', 1500, { operation: 'noteCollect', outcome: 'success' });
  await expect(pending).resolves.toBe('collected');
  expect(mockCollectNote).toHaveBeenCalledWith('n1', expect.objectContaining({ clientMsgID: 'note-message', conversationID: 'c1' }), { targetNoteGroupId: 'private-group', title: 'Edited title' });
  expect(mockBump).toHaveBeenCalledTimes(1); expect(Alert.alert).not.toHaveBeenCalled();
  expect(result.current.noteCollectVisible).toBe(false);
});

test('closing a silent note resolves cancellation and performs no collection write', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.handleCollectMessage(noteMessage, { silent: true }); });
  await showSheet();
  act(() => sheet(result.current).onClose());
  await expect(pending).resolves.toBe('cancelled');
  expect(mockCollectNote).not.toHaveBeenCalled(); expect(result.current.noteCollectVisible).toBe(false);
});

test('single note returns pending and keeps the existing confirmation success alert', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.handleCollectMessage(noteMessage); });
  await showSheet();
  await expect(pending).resolves.toBe('pending');
  await act(async () => { await sheet(result.current).onConfirm({ targetNoteGroupId: null, title: 'Saved' }); });
  expect(Alert.alert).toHaveBeenCalledWith('chat.messageActions.noteCollected', 'chat.messageActions.noteCollectedHint', expect.any(Array));
});

test('silent note write failure resolves failed, closes the sheet, and reports without an item alert', async () => {
  const error = new Error('offline'); mockCollectNote.mockRejectedValue(error);
  const { result } = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>;
  act(() => { pending = result.current.handleCollectMessage(noteMessage, { silent: true }); });
  await showSheet();
  await act(async () => { await sheet(result.current).onConfirm({ targetNoteGroupId: null, title: 'Saved' }); });
  await expect(pending).resolves.toBe('failed');
  expect(mockCollectNote).toHaveBeenCalledTimes(1); expect(mockBump).not.toHaveBeenCalled();
  expect(mockReportFailure).toHaveBeenCalledWith('chatDetail', 'collectNote', error);
  expect(mockRecordMetric).toHaveBeenCalledWith('app.operation.duration', 0, { operation: 'noteCollect', outcome: 'failed' });
  expect(Alert.alert).not.toHaveBeenCalled(); expect(result.current.noteCollectVisible).toBe(false);
});

test('an open note sheet is not replaced by another collection request', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  let first!: Promise<unknown>;
  act(() => { first = result.current.handleCollectMessage(noteMessage, { silent: true }); });
  await showSheet();
  let second: unknown;
  act(() => { void result.current.handleCollectMessage({ ...noteMessage, id: 'second', noteCard: { ...noteMessage.noteCard!, noteId: 'n2', title: 'Other' } }, { silent: true }).then((value) => { second = value; }); });
  await showSheet();
  expect(second).toBe('pending'); expect(sheet(result.current).noteTitle).toBe('Original title');
  act(() => sheet(result.current).onClose()); await expect(first).resolves.toBe('cancelled');
});

test.each(['account', 'conversation', 'unmount'] as const)('pending note cancels on %s and ignores late group results', async (change) => {
  let finishGroups!: (groups: unknown[]) => void;
  mockFetchGroups.mockImplementation(() => new Promise((resolve) => { finishGroups = resolve; }));
  const view = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>;
  act(() => { pending = view.result.current.handleCollectMessage(noteMessage, { silent: true }); });
  await showSheet();
  const oldConfirm = sheet(view.result.current).onConfirm;
  act(() => {
    if (change === 'account') useAuthStore.setState({ sessionEpoch: 2, user: { id: 'other' } as never });
    if (change === 'conversation') useChatStore.setState({ activeConversationId: 'c2' });
    if (change === 'unmount') view.unmount();
  });
  let outcome: unknown = 'unresolved'; void pending.then((value) => { outcome = value; });
  await act(async () => { await Promise.resolve(); });
  expect(outcome).toBe('cancelled');
  await act(async () => { finishGroups([{ id: 'old-private-group' }]); await oldConfirm({ targetNoteGroupId: null, title: 'Stale' }); });
  expect(mockCollectNote).not.toHaveBeenCalled(); expect(mockBump).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
  if (change !== 'unmount') { expect(view.result.current.noteCollectVisible).toBe(false); expect(sheet(view.result.current).groups).toEqual([]); }
});

test('unmount while waiting for keyboard closes its timer and cancels before mounting a sheet', async () => {
  const view = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>;
  act(() => { pending = view.result.current.handleCollectMessage(noteMessage, { silent: true }); });
  act(() => view.unmount());
  expect(jest.getTimerCount()).toBe(0);
  await expect(pending).resolves.toBe('cancelled'); expect(mockFetchGroups).not.toHaveBeenCalled();
});

test.each(['account', 'conversation', 'unmount'] as const)('normal write completion after %s returns cancelled and cannot show stale success', async (change) => {
  let finish!: () => void; mockCreateCollection.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const view = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>;
  act(() => { pending = view.result.current.handleCollectMessage(textMessage); });
  act(() => {
    if (change === 'account') useAuthStore.setState({ sessionEpoch: 2 });
    if (change === 'conversation') useChatStore.setState({ activeConversationId: 'c2' });
    if (change === 'unmount') view.unmount();
  });
  await act(async () => { finish(); });
  await expect(pending).resolves.toBe('cancelled'); expect(Alert.alert).not.toHaveBeenCalled();
});

test('note saved after account change cannot dirty the next account notes or show an alert', async () => {
  let finish!: (value: unknown) => void; mockCollectNote.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>; let confirmation!: Promise<void>;
  act(() => { pending = result.current.handleCollectMessage(noteMessage, { silent: true }); });
  await showSheet();
  act(() => { confirmation = sheet(result.current).onConfirm({ targetNoteGroupId: null, title: 'Saved' }); });
  act(() => useAuthStore.setState({ sessionEpoch: 2 }));
  await act(async () => { finish({ note: { id: 'copy' } }); await confirmation; });
  await expect(pending).resolves.toBe('cancelled'); expect(mockBump).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
});


test('a callback retained across account change cannot create a collection for the next account', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  const oldCollect = result.current.handleCollectMessage;
  act(() => useAuthStore.setState({ sessionEpoch: 2, user: { id: 'other' } as never }));
  let outcome: unknown;
  await act(async () => { outcome = await oldCollect(textMessage, { silent: true }); });
  expect(outcome).toBe('cancelled'); expect(mockCreateCollection).not.toHaveBeenCalled();
});

test('cancelling a visible-keyboard wait removes both native listeners and its fallback timer', async () => {
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
  const remove = jest.fn(); jest.spyOn(Keyboard, 'addListener').mockReturnValue({ remove } as unknown as ReturnType<typeof Keyboard.addListener>);
  const view = renderHook(() => useCollectMessage(params));
  let pending!: Promise<unknown>;
  act(() => { pending = view.result.current.handleCollectMessage(noteMessage, { silent: true }); });
  await act(async () => { await Promise.resolve(); });
  act(() => { jest.advanceTimersByTime(32); });
  act(() => view.unmount());
  await expect(pending).resolves.toBe('cancelled');
  expect(remove).toHaveBeenCalledTimes(2); expect(jest.getTimerCount()).toBe(0);
  expect(mockFetchGroups).not.toHaveBeenCalled();
});

test('duplicate notes report already added without reopening group and title entry', async () => {
 mockFindCollectedNote.mockResolvedValue({id:'copy'});
 const {result}=renderHook(()=>useCollectMessage(params));
 await act(async()=>{await result.current.handleCollectMessage(noteMessage);});
 expect(Alert.alert).toHaveBeenCalledWith('chat.messageActions.noteAlreadyCollected');
 expect(result.current.noteCollectVisible).toBe(false); expect(mockCollectNote).not.toHaveBeenCalled();
});

test('with both confirmation steps turned off a note is saved straight into ungrouped with its own title', async () => {
  useNoteCollectPreferencesStore.setState({ chooseGroup: false, editTitle: false });
  const { result } = renderHook(() => useCollectMessage(params));
  let outcome: unknown;
  await act(async () => { outcome = await result.current.handleCollectMessage(noteMessage, { silent: true }); });
  expect(outcome).toBe('collected');
  expect(mockCollectNote).toHaveBeenCalledWith('n1', expect.any(Object), { targetNoteGroupId: null, title: 'Original title' });
  expect(mockFetchGroups).not.toHaveBeenCalled();
  expect(result.current.noteCollectVisible).toBe(false);
});

test('a failed direct save alerts and frees the request so the next collect can start', async () => {
  useNoteCollectPreferencesStore.setState({ chooseGroup: false, editTitle: false });
  mockCollectNote.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useCollectMessage(params));
  await act(async () => { await result.current.handleCollectMessage(noteMessage); await Promise.resolve(); });
  expect(Alert.alert).toHaveBeenCalledWith('chat.messageActions.collectFailed', 'chat.messageActions.collectFailedHint');
  let second: unknown;
  await act(async () => { second = await result.current.handleCollectMessage(noteMessage, { silent: true }); });
  expect(second).toBe('collected');
  expect(mockCollectNote).toHaveBeenCalledTimes(2);
});

test('the sheet receives the saved confirmation preferences', async () => {
  useNoteCollectPreferencesStore.setState({ chooseGroup: false, editTitle: true });
  const { result } = renderHook(() => useCollectMessage(params));
  act(() => { void result.current.handleCollectMessage(noteMessage); });
  await showSheet();
  expect(sheet(result.current)).toEqual(expect.objectContaining({ visible: true, chooseGroup: false, editTitle: true }));
});

test('ticking "do not edit the title next time" turns title editing off after this save', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  act(() => { void result.current.handleCollectMessage(noteMessage); });
  await showSheet();
  await act(async () => {
    await sheet(result.current).onConfirm({ targetNoteGroupId: null, title: 'Saved', disableTitleEditing: true });
  });
  expect(useNoteCollectPreferencesStore.getState().editTitle).toBe(false);
  expect(mockCollectNote).toHaveBeenCalledWith('n1', expect.any(Object), { targetNoteGroupId: null, title: 'Saved' });
});

test('creating a group from the sheet adds it to the list and hands it back', async () => {
  const { result } = renderHook(() => useCollectMessage(params));
  act(() => { void result.current.handleCollectMessage(noteMessage); });
  await showSheet();
  let created: unknown;
  await act(async () => { created = await sheet(result.current).onCreateGroup('新分组'); });
  expect(mockCreateNoteGroup).toHaveBeenCalledWith('新分组');
  expect(created).toEqual({ id: 'new-group', name: '新分组' });
  expect(sheet(result.current).groups).toEqual([
    { id: 'private-group', name: 'Private' },
    { id: 'new-group', name: '新分组' },
  ]);
});

test('a failed group creation alerts and returns nothing to select', async () => {
  mockCreateNoteGroup.mockRejectedValueOnce(new Error('dup'));
  const { result } = renderHook(() => useCollectMessage(params));
  act(() => { void result.current.handleCollectMessage(noteMessage); });
  await showSheet();
  let created: unknown = 'unset';
  await act(async () => { created = await sheet(result.current).onCreateGroup('重复'); });
  expect(created).toBeNull();
  expect(Alert.alert).toHaveBeenCalledWith('notes.collect.createGroupFailed', 'notes.collect.createGroupFailedHint');
  expect(sheet(result.current).groups).toEqual([{ id: 'private-group', name: 'Private' }]);
});
