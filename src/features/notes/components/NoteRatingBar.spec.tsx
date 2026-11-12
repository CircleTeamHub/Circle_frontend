import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { NoteRatingBar } from './NoteRatingBar';
import { describeRatingBlock, ratingButtonBlock } from '@/features/notes/utils/note-rating';
import { ApiError } from '@/services/api/api-error';
import { fetchNoteRatingSummary, rateNote, type NoteRatingSummary } from '@/services/api/note-ratings';
import { reportHandledFailure } from '@/observability/report-failure';

const mockTranslate = (key: string, options?: Record<string, unknown>) =>
  options && 'count' in options ? `${key}:${String(options.count)}` : key;
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/theme', () => ({
  Radius: { full: 999, lg: 16, md: 12, xl: 20, pill: 26 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { small: {}, caption: {}, body: {}, bodyRegular: {}, h3: {} },
  useTheme: () => ({
    colors: {
      surfaceMuted: '#eee', surface: '#fff', surfaceBorder: '#ccc', text: '#111', textSecondary: '#666',
      primary: '#63f', primaryLight: '#ddf', white: '#fff', background: '#fff', overlay: '#0008',
    },
  }),
}));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View testID="sheet">{children}</View> : null,
  };
});
jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));
jest.mock('@/services/api/note-ratings', () => ({
  ...jest.requireActual('@/services/api/note-ratings'),
  fetchNoteRatingSummary: jest.fn(),
  rateNote: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (error: { errorCode?: string }, fallback: string) =>
    error?.errorCode ? `serverErrors.${error.errorCode}` : fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const NOW = new Date('2026-11-11T04:00:00.000Z').getTime();

const summary = (over: Partial<NoteRatingSummary> = {}): NoteRatingSummary => ({
  noteId: 'root-1',
  month: '2026-11',
  goodCount: 4,
  badCount: 1,
  canRate: true,
  reason: null,
  nextRatableAt: null,
  goodFull: false,
  badFull: false,
  ...over,
});

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alert.mockRestore());

function renderBar(onOpenBadRatings = jest.fn()) {
  render(<NoteRatingBar noteId="copy-1" onOpenBadRatings={onOpenBadRatings} />);
  return onOpenBadRatings;
}

test("shows this month's counters and rates good in one tap", async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary());
  jest.mocked(rateNote).mockResolvedValue({
    noteId: 'root-1', month: '2026-11', goodCount: 5, badCount: 1,
    ratingId: 'r1', status: 'COUNTED', nextRatableAt: '2026-11-14T04:00:00.000Z',
  });
  renderBar();

  expect(await screen.findByText('notes.rating.monthLabel')).toBeTruthy();
  expect(screen.getByText('👍 notes.rating.good:4')).toBeTruthy();
  expect(screen.getByText('👎 notes.rating.bad:1')).toBeTruthy();
  expect(fetchNoteRatingSummary).toHaveBeenCalledWith('copy-1');

  await act(async () => {
    fireEvent.press(screen.getByTestId('note-rating-GOOD'));
  });

  expect(rateNote).toHaveBeenCalledWith('copy-1', { value: 'GOOD' });
  expect(screen.getByText('👍 notes.rating.good:5')).toBeTruthy();
  // Now blocked: a second tap explains instead of rating again.
  fireEvent.press(screen.getByTestId('note-rating-GOOD'));
  expect(rateNote).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenLastCalledWith('notes.rating.blockedTitle', expect.stringContaining('notes.rating.blocked.cooldownDays'));
});

test('greyed-out buttons stay actionable for screen readers and carry the reason as a hint', async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary({ canRate: false, reason: 'NOTE_RATING_LOW_CREDIT' }));
  renderBar();

  const good = await screen.findByTestId('note-rating-GOOD');
  expect(good.props.accessibilityState).toMatchObject({ disabled: false, busy: false });
  expect(good.props.accessibilityHint).toBe('notes.rating.blocked.NOTE_RATING_LOW_CREDIT');
});

test('a wait that ended while the page was open re-checks with the server instead of explaining', async () => {
  jest.mocked(fetchNoteRatingSummary)
    .mockResolvedValueOnce(summary({ canRate: false, reason: 'NOTE_RATING_COOLDOWN', nextRatableAt: '2000-01-01T00:00:00.000Z' }))
    .mockResolvedValueOnce(summary());
  renderBar();

  fireEvent.press(await screen.findByTestId('note-rating-GOOD'));

  await waitFor(() => expect(fetchNoteRatingSummary).toHaveBeenCalledTimes(2));
  expect(alert).not.toHaveBeenCalled();
  expect(rateNote).not.toHaveBeenCalled();
});

test('a summary that was in flight when the user rated cannot undo the rating state', async () => {
  let resolveLate!: (value: NoteRatingSummary) => void;
  jest.mocked(fetchNoteRatingSummary)
    .mockResolvedValueOnce(summary())
    .mockReturnValueOnce(new Promise((resolve) => { resolveLate = resolve; }));
  jest.mocked(rateNote).mockResolvedValue({
    noteId: 'root-1', month: '2026-11', goodCount: 5, badCount: 1,
    ratingId: 'r1', status: 'COUNTED', nextRatableAt: '2099-01-01T00:00:00.000Z',
  });
  const { rerender } = render(<NoteRatingBar noteId="copy-1" onOpenBadRatings={jest.fn()} />);
  const good = await screen.findByTestId('note-rating-GOOD');
  // The note was just added: eligibility reloads while the user taps 👍.
  rerender(<NoteRatingBar noteId="copy-1" refreshKey="added" onOpenBadRatings={jest.fn()} />);
  await act(async () => {
    fireEvent.press(good);
  });
  await act(async () => {
    resolveLate(summary({ goodCount: 4 }));
  });

  expect(screen.getByText('👍 notes.rating.good:5')).toBeTruthy();
  expect(screen.getByTestId('note-rating-GOOD').props.accessibilityHint).toBeDefined();
});

test('a note without group cards shows no rating UI', async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary({ canRate: false, reason: 'NOTE_RATING_NO_GROUP' }));
  renderBar();

  await waitFor(() => expect(fetchNoteRatingSummary).toHaveBeenCalled());
  expect(screen.queryByTestId('note-rating-bar')).toBeNull();
});

test('the owner sees the counters and a link to the bad ratings of the source note', async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary({ canRate: false, reason: 'NOTE_RATING_OWNER' }));
  const onOpen = renderBar();

  fireEvent.press(await screen.findByTestId('note-rating-view-bad'));

  expect(onOpen).toHaveBeenCalledWith('root-1');
  expect(screen.queryByTestId('note-rating-GOOD')).toBeNull();
  expect(screen.getByTestId('note-rating-count-GOOD')).toBeTruthy();
});

test('greyed-out buttons explain why instead of rating', async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(
    summary({ canRate: false, reason: 'NOTE_RATING_NOT_IN_GROUP' }),
  );
  renderBar();

  fireEvent.press(await screen.findByTestId('note-rating-BAD'));

  expect(alert).toHaveBeenCalledWith('notes.rating.blockedTitle', 'notes.rating.blocked.NOTE_RATING_NOT_IN_GROUP');
  expect(rateNote).not.toHaveBeenCalled();
  expect(screen.queryByTestId('sheet')).toBeNull();
});

test("a full good quota only blocks 👍; 👎 asks for a reason and text for OTHER", async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary({ goodFull: true }));
  jest.mocked(rateNote).mockResolvedValue({
    noteId: 'root-1', month: '2026-11', goodCount: 4, badCount: 2,
    ratingId: 'r2', status: 'COUNTED', nextRatableAt: '2026-11-14T04:00:00.000Z',
  });
  renderBar();

  fireEvent.press(await screen.findByTestId('note-rating-GOOD'));
  expect(alert).toHaveBeenCalledWith('notes.rating.blockedTitle', 'notes.rating.blocked.NOTE_RATING_NOTE_GOOD_FULL');

  fireEvent.press(screen.getByTestId('note-rating-BAD'));
  fireEvent.press(screen.getByTestId('note-rating-reason-OTHER'));
  // OTHER without text cannot be submitted.
  expect(screen.getByTestId('note-rating-reason-submit')).toBeDisabled();
  fireEvent.changeText(screen.getByTestId('note-rating-comment'), '  Moved away  ');
  await act(async () => {
    fireEvent.press(screen.getByTestId('note-rating-reason-submit'));
  });

  expect(rateNote).toHaveBeenCalledWith('copy-1', { value: 'BAD', reason: 'OTHER', comment: 'Moved away' });
  expect(screen.queryByTestId('sheet')).toBeNull();
  expect(screen.getByText('👎 notes.rating.bad:2')).toBeTruthy();
});

test('a held rating tells the rater it is under review', async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary());
  jest.mocked(rateNote).mockResolvedValue({
    noteId: 'root-1', month: '2026-11', goodCount: 4, badCount: 1,
    ratingId: 'r3', status: 'HELD', nextRatableAt: '2026-11-14T04:00:00.000Z',
  });
  renderBar();

  const good = await screen.findByTestId('note-rating-GOOD');
  await act(async () => {
    fireEvent.press(good);
  });

  expect(alert).toHaveBeenCalledWith('notes.rating.heldNotice');
  expect(screen.getByText('👍 notes.rating.good:4')).toBeTruthy();
});

test('a rejected rating shows the server reason and reloads eligibility', async () => {
  jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary());
  jest.mocked(rateNote).mockRejectedValue(
    new ApiError('cooldown', { status: 409, errorCode: 'NOTE_RATING_COOLDOWN' } as never),
  );
  renderBar();

  const good = await screen.findByTestId('note-rating-GOOD');
  await act(async () => {
    fireEvent.press(good);
  });

  expect(alert).toHaveBeenCalledWith('notes.rating.failedTitle', 'serverErrors.NOTE_RATING_COOLDOWN');
  expect(reportHandledFailure).toHaveBeenCalledWith('noteRating', 'rate', expect.any(ApiError));
  await waitFor(() => expect(fetchNoteRatingSummary).toHaveBeenCalledTimes(2));
});

test('a failed summary load hides the bar and reports the failure', async () => {
  const error = new Error('offline');
  jest.mocked(fetchNoteRatingSummary).mockRejectedValue(error);
  renderBar();

  await waitFor(() => expect(reportHandledFailure).toHaveBeenCalledWith('noteRating', 'loadSummary', error));
  expect(screen.queryByTestId('note-rating-bar')).toBeNull();
});

describe('rating block helpers', () => {
  const t = mockTranslate as never;

  test('only the value whose daily quota is full is blocked', () => {
    expect(ratingButtonBlock(summary({ badFull: true }), 'GOOD')).toBeNull();
    expect(ratingButtonBlock(summary({ badFull: true }), 'BAD')).toBe('NOTE_RATING_NOTE_BAD_FULL');
    expect(ratingButtonBlock(summary({ reason: 'NOTE_RATING_LOW_CREDIT', goodFull: true }), 'GOOD')).toBe(
      'NOTE_RATING_LOW_CREDIT',
    );
  });

  test('turns the cooldown into days or hours left', () => {
    expect(
      describeRatingBlock(t, 'NOTE_RATING_COOLDOWN', new Date(NOW + 49 * 3600_000).toISOString(), NOW),
    ).toBe('notes.rating.blocked.cooldownDays:3');
    expect(
      describeRatingBlock(t, 'NOTE_RATING_COOLDOWN', new Date(NOW + 5.5 * 3600_000).toISOString(), NOW),
    ).toBe('notes.rating.blocked.cooldownHours:6');
    // Rated another note today: tomorrow is the answer.
    expect(
      describeRatingBlock(t, 'NOTE_RATING_RATER_DAILY_LIMIT', new Date(NOW + 12 * 3600_000).toISOString(), NOW),
    ).toBe('notes.rating.blocked.NOTE_RATING_RATER_DAILY_LIMIT');
    expect(describeRatingBlock(t, 'SOMETHING_NEW', null, NOW)).toBe('notes.rating.blocked.unknown');
  });
});
