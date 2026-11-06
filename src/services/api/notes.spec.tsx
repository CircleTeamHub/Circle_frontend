import { apiClient } from './client';
import { createNote, updateNote, fetchNotes, findCollectedNote, togglePinNote } from './notes';
import type { CreateNoteInput, NoteSummary } from '@/features/notes/types';

jest.mock('./client', () => ({ apiClient: jest.fn(), ApiError: class extends Error {} }));
jest.mock('@/services/api/utils', () => ({ allowPeerMediaUrl: (url: string) => url }));

const copy = { id: 'copy', title: 'Saved', cover: null, collectedFrom: { sourceNoteId: 'source' } } as NoteSummary;

beforeEach(async () => {
  jest.mocked(apiClient).mockReset().mockResolvedValue(undefined);
  // A successful mutation invalidates the previous test's lookup snapshot.
  await togglePinNote('reset', false);
  jest.mocked(apiClient).mockReset().mockResolvedValue([copy]);
});

test.each(['create', 'update'] as const)('%s sends structured rich text once and keeps the frozen write intact', async (operation) => {
  const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'Body', styles: {} }] }];
  const input: CreateNoteInput = { title: 'Note', contentJson: blocks, media: [], sections: { text: { content: 'Body', contentJson: blocks } } };
  if (operation === 'create') await createNote(input);
  else await updateNote('note', input);
  const body = jest.mocked(apiClient).mock.calls[0][1]?.body as CreateNoteInput;
  expect(body.contentJson).toBeUndefined();
  expect(body.sections?.text?.contentJson).toBe(blocks);
  expect(input.contentJson).toBe(blocks);
});

test('legacy top-level text remains available when no structured text is supplied', async () => {
  const input: CreateNoteInput = { title: 'Legacy', media: [], contentJson: [{ type: 'paragraph' }] };
  await createNote(input);
  expect(jest.mocked(apiClient).mock.calls[0][1]?.body).toBe(input);
});

test('concurrent and consecutive saved-copy lookups share one complete list request', async () => {
  let finish!: (value: NoteSummary[]) => void;
  jest.mocked(apiClient).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const first = findCollectedNote('source', 1);
  const second = findCollectedNote('not-saved', 1);
  expect(apiClient).toHaveBeenCalledTimes(1);
  finish([copy]);
  expect(await first).toMatchObject({ id: 'copy' });
  expect(await second).toBeNull();
  expect(await findCollectedNote('source', 1)).toMatchObject({ id: 'copy' });
  expect(apiClient).toHaveBeenCalledTimes(1);
});

test('account changes, successful writes and expiry invalidate saved-copy lookup results', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    await findCollectedNote('source', 1);
    jest.mocked(apiClient).mockResolvedValue([]);
    expect(await findCollectedNote('source', 2)).toBeNull();
    await togglePinNote('copy', true);
    jest.mocked(apiClient).mockResolvedValue([copy]);
    expect(await findCollectedNote('source', 2)).not.toBeNull();
    clock.mockReturnValue(31_001);
    jest.mocked(apiClient).mockResolvedValue([]);
    expect(await findCollectedNote('source', 2)).toBeNull();
    expect(apiClient).toHaveBeenCalledTimes(5);
  } finally { clock.mockRestore(); }
});

test('a lookup response from before a completed write cannot replace fresh collection state', async () => {
  let finish!: (value: NoteSummary[]) => void;
  jest.mocked(apiClient).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  const old = findCollectedNote('source', 1);
  await togglePinNote('copy', true);
  finish([copy]);
  expect(await old).toBeNull();
  jest.mocked(apiClient).mockResolvedValue([]);
  expect(await findCollectedNote('source', 1)).toBeNull();
  expect(apiClient).toHaveBeenCalledTimes(3);
});

test('ordinary list refreshes always reach the API even while a saved-copy snapshot is fresh', async () => {
  await findCollectedNote('source', 1);
  await fetchNotes();
  await fetchNotes();
  expect(apiClient).toHaveBeenCalledTimes(3);
});

test('a failed saved-copy lookup is released so the next attempt reaches the API', async () => {
  jest.mocked(apiClient).mockRejectedValueOnce(new Error('offline'));
  await expect(findCollectedNote('source', 1)).rejects.toThrow('offline');
  expect(await findCollectedNote('source', 1)).toMatchObject({ id: 'copy' });
  expect(apiClient).toHaveBeenCalledTimes(2);
});

test('a late lookup from the previous account does not replace the current account snapshot', async () => {
  let finishPrevious!: (value: NoteSummary[]) => void;
  jest.mocked(apiClient).mockReturnValueOnce(new Promise((resolve) => { finishPrevious = resolve; })).mockResolvedValue([]);
  const previous = findCollectedNote('source', 1);
  expect(await findCollectedNote('source', 2)).toBeNull();
  finishPrevious([copy]);
  await previous;
  expect(await findCollectedNote('source', 2)).toBeNull();
  expect(apiClient).toHaveBeenCalledTimes(2);
});
