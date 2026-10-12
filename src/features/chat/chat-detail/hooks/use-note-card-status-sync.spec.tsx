import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { useNoteStatusSignalStore } from '@/features/notes/store/use-note-status-signal-store';
import { collectNoteCardIds, useNoteCardStatusSync } from './use-note-card-status-sync';

const mockFetch = jest.fn();
jest.mock('@/services/api/notes', () => ({
  NOTE_SOURCE_STATES_MAX: 100,
  fetchNoteSourceStates: (...args: unknown[]) => mockFetch(...args),
}));
const mockApply = jest.fn();
jest.mock('@/chat-core/store', () => ({
  useChatStore: { getState: () => ({ applyNoteSourceStatus: mockApply }) },
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

const noteCard = (id: string, noteId: string) =>
  ({ id, type: 'note-card', content: { noteId } }) as unknown as ChatMessageDto;
const text = (id: string) =>
  ({ id, type: 'text', content: { text: 'hi' } }) as unknown as ChatMessageDto;

beforeEach(() => {
  mockFetch.mockReset();
  mockApply.mockReset();
  useNoteStatusSignalStore.getState().reset();
});

test('collectNoteCardIds walks newest first, dedupes and caps the batch', () => {
  const messages = [noteCard('m1', 'a'), text('m2'), noteCard('m3', 'b'), noteCard('m4', 'a')];
  expect(collectNoteCardIds(messages)).toEqual(['a', 'b']);
  expect(collectNoteCardIds(messages, 1)).toEqual(['a']);
  expect(collectNoteCardIds(undefined)).toEqual([]);
});

test('reconciles card status on open and again after a reconnect recovery', async () => {
  mockFetch.mockResolvedValue([
    { noteId: 'a', workStatus: 'UNSET', publicationStatus: 'UNLISTED' },
  ]);
  const messages = [noteCard('m1', 'a')];
  const { rerender } = renderHook(
    ({ list }: { list: ChatMessageDto[] }) => useNoteCardStatusSync('conv-1', list),
    { initialProps: { list: messages } },
  );

  await waitFor(() => expect(mockApply).toHaveBeenCalledWith('a', null, 'UNLISTED'));
  expect(mockFetch).toHaveBeenCalledTimes(1);

  // Same cards re-rendered: no duplicate request inside one recovery epoch.
  rerender({ list: [...messages] });
  expect(mockFetch).toHaveBeenCalledTimes(1);

  // Missed events during a disconnect: recovery forces a fresh reconcile.
  act(() => {
    useNoteStatusSignalStore.getState().bump();
  });
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
});

test('only fetches newly loaded cards and retries ids whose fetch failed', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline'));
  const { rerender } = renderHook(
    ({ list }: { list: ChatMessageDto[] }) => useNoteCardStatusSync('conv-1', list),
    { initialProps: { list: [noteCard('m1', 'a')] } },
  );
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

  mockFetch.mockResolvedValue([]);
  rerender({ list: [noteCard('m1', 'a'), noteCard('m2', 'b')] });
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  // 'a' failed before, so it is retried together with the new 'b'.
  expect(mockFetch.mock.calls[1][0].sort()).toEqual(['a', 'b']);
});
