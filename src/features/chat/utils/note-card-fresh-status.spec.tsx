import { mergeNoteSourceStates, withFreshNoteSourceStatus } from './note-card-fresh-status';

const mockFetchNoteSourceStates = jest.fn();
jest.mock('@/services/api/notes', () => ({
  fetchNoteSourceStates: (...args: unknown[]) => mockFetchNoteSourceStates(...args),
}));
const mockReport = jest.fn();
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: (...args: unknown[]) => mockReport(...args),
}));

const card = (noteId: string, over: Record<string, unknown> = {}) => ({
  noteId,
  title: noteId,
  workStatus: 'WORKING' as const,
  publicationStatus: 'ACTIVE' as const,
  ...over,
});

beforeEach(() => {
  mockFetchNoteSourceStates.mockReset();
  mockReport.mockReset();
});

test('mergeNoteSourceStates overwrites stale snapshots and keeps unmatched cards', () => {
  const a = card('a');
  const b = card('b');
  const merged = mergeNoteSourceStates([a, b], [
    { noteId: 'a', workStatus: 'CLOSED', publicationStatus: 'UNLISTED' },
  ]);
  expect(merged[0]).toEqual({ ...a, workStatus: 'CLOSED', publicationStatus: 'UNLISTED' });
  expect(merged[1]).toBe(b);
});

test('withFreshNoteSourceStatus re-reads the source before a warning is decided', async () => {
  mockFetchNoteSourceStates.mockResolvedValueOnce([
    { noteId: 'a', workStatus: 'CLOSED', publicationStatus: 'ACTIVE' },
  ]);
  const [fresh] = await withFreshNoteSourceStatus([card('a')]);
  expect(mockFetchNoteSourceStates).toHaveBeenCalledWith(['a']);
  expect(fresh.workStatus).toBe('CLOSED');
});

test('withFreshNoteSourceStatus falls back to the snapshot and reports when offline', async () => {
  mockFetchNoteSourceStates.mockRejectedValueOnce(new Error('offline'));
  const input = [card('a', { workStatus: 'CLOSED' })];
  const result = await withFreshNoteSourceStatus(input);
  expect(result).toEqual(input);
  expect(mockReport).toHaveBeenCalledWith(
    'noteCardStatus',
    'fetchSourceStates',
    expect.any(Error),
    { count: 1 },
  );
});
