import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { NoteRatingFlowHost } from './NoteRatingFlowHost';
import {
  cancelBadNoteRating,
  MENU_HANDOFF_MS,
  rateNoteGood,
  startBadNoteRating,
  useNoteRatingFlowStore,
} from './note-rating-flow';
import { describeRatingBlock, ratingButtonBlock } from '@/features/notes/utils/note-rating';
import { showTopNotice } from '@/components/app/top-notice-store';
import { ApiError } from '@/services/api/api-error';
import {
  fetchNoteRatingSummary,
  rateNote,
  type NoteRatingResult,
  type NoteRatingSummary,
} from '@/services/api/note-ratings';
import { reportHandledFailure } from '@/observability/report-failure';

const mockTranslate = (key: string, options?: Record<string, unknown>) =>
  options && 'count' in options ? `${key}:${String(options.count)}` : key;
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string, options?: Record<string, unknown>) => mockTranslate(key, options) } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/theme', () => ({
  Radius: { full: 999, lg: 16, md: 12, xl: 20, pill: 26 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { small: {}, caption: {}, body: {}, bodyRegular: {}, h3: {} },
  useTheme: () => ({
    colors: {
      surface: '#fff', surfaceBorder: '#ccc', text: '#111', textSecondary: '#666',
      primary: '#63f', primaryLight: '#ddf', white: '#fff', background: '#fff', overlay: '#0008',
    },
  }),
}));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { TextInput, View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? <View testID="sheet">{children}</View> : null,
    BottomSheetTextInput: TextInput,
  };
});
jest.mock('@/components/app/top-notice-store', () => ({ showTopNotice: jest.fn() }));
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
  noteId: 'root-1', month: '2026-11', goodCount: 4, badCount: 1, canRate: true,
  reason: null, nextRatableAt: null, goodFull: false, badFull: false, ...over,
});
const result = (over: Partial<NoteRatingResult> = {}): NoteRatingResult => ({
  noteId: 'root-1', month: '2026-11', goodCount: 5, badCount: 1, ratingId: 'r1',
  status: 'COUNTED', nextRatableAt: '2026-11-14T04:00:00.000Z', ...over,
});

/** Lets the request settle and the menu hand-off delay run out. */
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(MENU_HANDOFF_MS);
  });
}

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useNoteRatingFlowStore.setState({ badRequest: null });
});
afterEach(() => {
  alert.mockRestore();
  jest.useRealTimers();
});

describe('好评 from a menu', () => {
  test('rates the note at once and reports the new counters', async () => {
    jest.mocked(rateNote).mockResolvedValue(result());
    const onRated = jest.fn();

    const done = rateNoteGood('copy-1', onRated);
    await settle();
    await done;

    expect(rateNote).toHaveBeenCalledWith('copy-1', { value: 'GOOD' });
    expect(onRated).toHaveBeenCalledWith(expect.objectContaining({ goodCount: 5, badCount: 1 }));
    expect(showTopNotice).toHaveBeenCalledWith({ type: 'success', title: 'notes.rating.ratedTitle', message: 'notes.rating.countsA11y' });
  });

  test('a held rating says it is under review instead', async () => {
    jest.mocked(rateNote).mockResolvedValue(result({ status: 'HELD' }));

    const done = rateNoteGood('copy-1');
    await settle();
    await done;

    expect(showTopNotice).toHaveBeenCalledWith({ type: 'info', title: 'notes.rating.heldNotice' });
  });

  test('a rejection explains why, with the cooldown in days', async () => {
    jest.mocked(rateNote).mockRejectedValue(
      new ApiError('cooldown', {
        status: 409,
        errorCode: 'NOTE_RATING_COOLDOWN',
        data: { nextRatableAt: new Date(NOW + 49 * 3600_000).toISOString() },
      } as never),
    );
    const onRated = jest.fn();

    const done = rateNoteGood('copy-1', onRated);
    await settle();
    await done;

    expect(onRated).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('notes.rating.blockedTitle', 'notes.rating.blocked.cooldownDays:3');
    expect(reportHandledFailure).toHaveBeenCalledWith('noteRating', 'rate', expect.any(ApiError));
  });

  test('waits for the menu to finish closing before showing an alert', async () => {
    jest.mocked(rateNote).mockRejectedValue(
      new ApiError('not in group', { status: 403, errorCode: 'NOTE_RATING_NOT_IN_GROUP' } as never),
    );

    const done = rateNoteGood('copy-1');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(MENU_HANDOFF_MS - 1);
    });
    expect(alert).not.toHaveBeenCalled();
    await settle();
    await done;

    expect(alert).toHaveBeenCalledWith('notes.rating.blockedTitle', 'notes.rating.blocked.NOTE_RATING_NOT_IN_GROUP');
  });

  test('a second tap while the first is in flight is ignored', async () => {
    jest.mocked(rateNote).mockResolvedValue(result());

    const first = rateNoteGood('copy-1');
    const second = rateNoteGood('copy-1');
    await settle();
    await Promise.all([first, second]);

    expect(rateNote).toHaveBeenCalledTimes(1);
  });

  test('a network failure keeps the generic retry copy', async () => {
    jest.mocked(rateNote).mockRejectedValue(new Error('offline'));

    const done = rateNoteGood('copy-1');
    await settle();
    await done;

    expect(alert).toHaveBeenCalledWith('notes.rating.failedTitle', 'common.retryLater');
  });
});

describe('差评 from a menu', () => {
  test('checks eligibility first and explains a block without asking for a reason', async () => {
    jest.mocked(fetchNoteRatingSummary).mockResolvedValue(
      summary({ canRate: false, reason: 'NOTE_RATING_RATER_DAILY_LIMIT', nextRatableAt: new Date(NOW + 12 * 3600_000).toISOString() }),
    );
    render(<NoteRatingFlowHost />);

    const done = startBadNoteRating('copy-1');
    await settle();
    await done;

    expect(alert).toHaveBeenCalledWith('notes.rating.blockedTitle', 'notes.rating.blocked.NOTE_RATING_RATER_DAILY_LIMIT');
    expect(screen.queryByTestId('sheet')).toBeNull();
  });

  test('a full bad quota for today is explained too', async () => {
    jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary({ badFull: true }));

    const done = startBadNoteRating('copy-1');
    await settle();
    await done;

    expect(alert).toHaveBeenCalledWith('notes.rating.blockedTitle', 'notes.rating.blocked.NOTE_RATING_NOTE_BAD_FULL');
  });

  test('asks for a reason in the root sheet, then rates and reports the counters', async () => {
    jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary());
    jest.mocked(rateNote).mockResolvedValue(result({ goodCount: 4, badCount: 2 }));
    const onRated = jest.fn();
    render(<NoteRatingFlowHost />);

    const started = startBadNoteRating('copy-1', onRated);
    await settle();
    await started;

    expect(await screen.findByTestId('sheet')).toBeTruthy();
    fireEvent.press(screen.getByTestId('note-rating-reason-OTHER'));
    expect(screen.getByTestId('note-rating-reason-submit')).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('note-rating-comment'), '  Moved away  ');
    fireEvent.press(screen.getByTestId('note-rating-reason-submit'));
    // The sheet closes before the request, so its own dismissal never races the result.
    expect(screen.queryByTestId('sheet')).toBeNull();
    await settle();

    expect(rateNote).toHaveBeenCalledWith('copy-1', { value: 'BAD', reason: 'OTHER', comment: 'Moved away' });
    expect(onRated).toHaveBeenCalledWith(expect.objectContaining({ badCount: 2 }));
    expect(showTopNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('closing the sheet without a reason rates nothing', async () => {
    jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary());
    render(<NoteRatingFlowHost />);

    const started = startBadNoteRating('copy-1');
    await settle();
    await started;
    expect(screen.getByTestId('sheet')).toBeTruthy();
    // What the sheet's backdrop / drag-to-close calls.
    act(() => cancelBadNoteRating());

    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(rateNote).not.toHaveBeenCalled();
  });

  test('a failed eligibility check is reported and explained', async () => {
    jest.mocked(fetchNoteRatingSummary).mockRejectedValue(
      new ApiError('gone', { status: 404, errorCode: 'NOTE_NOT_FOUND' } as never),
    );

    const done = startBadNoteRating('copy-1');
    await settle();
    await done;

    expect(reportHandledFailure).toHaveBeenCalledWith('noteRating', 'checkBadRating', expect.any(ApiError));
    expect(alert).toHaveBeenCalledWith('notes.rating.failedTitle', 'serverErrors.NOTE_NOT_FOUND');
  });
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

  // 好评、差评每天各一次：今天打过好评，差评仍可以打；反之亦然。
  test('a used 好评 only greys out 好评 today, a used 差评 only 差评', () => {
    expect(ratingButtonBlock(summary({ goodRatedToday: true }), 'GOOD')).toBe('RATER_DAILY_GOOD_USED');
    expect(ratingButtonBlock(summary({ goodRatedToday: true }), 'BAD')).toBeNull();
    expect(ratingButtonBlock(summary({ badRatedToday: true }), 'BAD')).toBe('RATER_DAILY_BAD_USED');
    expect(ratingButtonBlock(summary({ badRatedToday: true }), 'GOOD')).toBeNull();
    expect(describeRatingBlock(t, 'RATER_DAILY_GOOD_USED', null, NOW)).toBe('notes.rating.blocked.RATER_DAILY_GOOD_USED');
    expect(describeRatingBlock(t, 'RATER_DAILY_BAD_USED', null, NOW)).toBe('notes.rating.blocked.RATER_DAILY_BAD_USED');
  });

  test('a 差评 is still offered after today\'s 好评', async () => {
    jest.mocked(fetchNoteRatingSummary).mockResolvedValue(summary({ goodRatedToday: true }));
    render(<NoteRatingFlowHost />);

    const started = startBadNoteRating('copy-1');
    await settle();
    await started;

    expect(alert).not.toHaveBeenCalled();
    expect(await screen.findByTestId('sheet')).toBeTruthy();
  });

  test('turns the wait into days or hours, and covers every code', () => {
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
    expect(describeRatingBlock(t, 'NOTE_RATING_OWNER', null, NOW)).toBe('serverErrors.NOTE_RATING_OWNER');
    expect(describeRatingBlock(t, 'NOTE_RATING_NO_GROUP', null, NOW)).toBe('serverErrors.NOTE_RATING_NO_GROUP');
    expect(describeRatingBlock(t, 'SOMETHING_NEW', null, NOW)).toBe('notes.rating.blocked.unknown');
  });
});
