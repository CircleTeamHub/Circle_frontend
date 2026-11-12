import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NoteBadRatingsScreen from './NoteBadRatingsScreen';
import { ApiError } from '@/services/api/api-error';
import { appealNoteRating, fetchNoteBadRatings, type NoteBadRating } from '@/services/api/note-ratings';
import { reportHandledFailure } from '@/observability/report-failure';

const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockTranslate = (key: string, options?: Record<string, unknown>) =>
  options && 'count' in options ? `${key}:${String(options.count)}` : key;
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'root-1' }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate, i18n: { language: 'zh' } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Ionicons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/theme', () => ({
  Radius: { full: 999, lg: 16, md: 12, xl: 20, pill: 26 },
  Spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  Typography: { h1: {}, h3: {}, small: {}, caption: {}, body: {}, bodyRegular: {} },
  useTheme: () => ({
    colors: {
      background: '#fff', surface: '#fff', surfaceBorder: '#ccc', text: '#111', textSecondary: '#666',
      primary: '#63f', primaryLight: '#ddf', white: '#fff', overlay: '#0008', success: '#2c5',
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
  fetchNoteBadRatings: jest.fn(),
  appealNoteRating: jest.fn(),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (error: { errorCode?: string }, fallback: string) =>
    error?.errorCode ? `serverErrors.${error.errorCode}` : fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const rating = (over: Partial<NoteBadRating>): NoteBadRating => ({
  id: 'r1',
  reason: 'EXPIRED',
  comment: null,
  status: 'COUNTED',
  createdAt: '2026-11-10T02:00:00.000Z',
  appeal: null,
  canAppeal: true,
  ...over,
});

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alert.mockRestore());

test('lists reason, text, status and appeal results without any rater', async () => {
  jest.mocked(fetchNoteBadRatings).mockResolvedValue({
    items: [
      rating({ id: 'a', reason: 'OTHER', comment: 'Phone is wrong' }),
      rating({ id: 'b', status: 'HELD', canAppeal: false }),
      rating({
        id: 'c',
        status: 'VOID',
        canAppeal: false,
        appeal: { status: 'REVOKED', reason: 'fixed', createdAt: '2026-11-10T03:00:00.000Z', resolvedAt: '2026-11-11T03:00:00.000Z' },
      }),
    ],
    nextCursor: null,
    appealsRemaining: 3,
  });
  render(<NoteBadRatingsScreen />);

  expect(await screen.findByText('👎 notes.rating.reasons.OTHER')).toBeTruthy();
  expect(fetchNoteBadRatings).toHaveBeenCalledWith('root-1');
  expect(screen.getByText('Phone is wrong')).toBeTruthy();
  expect(screen.getByText('notes.rating.badList.status.HELD')).toBeTruthy();
  expect(screen.getByText('notes.rating.badList.status.VOID')).toBeTruthy();
  expect(screen.getByTestId('note-bad-rating-appeal-c')).toHaveTextContent('notes.rating.badList.appealStatus.REVOKED');
  expect(screen.getByTestId('note-bad-ratings-quota')).toHaveTextContent('notes.rating.badList.appealsRemaining:3');
  expect(screen.getByTestId('note-bad-rating-appeal-button-a')).toBeTruthy();
  expect(screen.queryByTestId('note-bad-rating-appeal-button-b')).toBeNull();
});

test('appeals a bad rating once and shows it as pending', async () => {
  jest.mocked(fetchNoteBadRatings).mockResolvedValue({
    items: [rating({ id: 'a' }), rating({ id: 'b' })],
    nextCursor: null,
    appealsRemaining: 1,
  });
  jest.mocked(appealNoteRating).mockResolvedValue(
    rating({
      id: 'a',
      canAppeal: false,
      appeal: { status: 'PENDING', reason: 'Still open', createdAt: '2026-11-11T03:00:00.000Z', resolvedAt: null },
    }),
  );
  render(<NoteBadRatingsScreen />);

  fireEvent.press(await screen.findByTestId('note-bad-rating-appeal-button-a'));
  expect(screen.getByTestId('note-bad-rating-appeal-submit')).toBeDisabled();
  fireEvent.changeText(screen.getByTestId('note-bad-rating-appeal-input'), '  Still open  ');
  await act(async () => {
    fireEvent.press(screen.getByTestId('note-bad-rating-appeal-submit'));
  });

  expect(appealNoteRating).toHaveBeenCalledWith('a', 'Still open');
  expect(screen.queryByTestId('sheet')).toBeNull();
  expect(screen.getByTestId('note-bad-rating-appeal-a')).toHaveTextContent('notes.rating.badList.appealStatus.PENDING');
  // That was the last appeal this month: no more 申诉 buttons.
  expect(screen.queryByTestId('note-bad-rating-appeal-button-b')).toBeNull();
  expect(screen.getByTestId('note-bad-ratings-quota')).toHaveTextContent('notes.rating.badList.appealsRemaining:0');
});

test('an appeal refused by the server explains why and reloads the stale list', async () => {
  jest.mocked(fetchNoteBadRatings)
    .mockResolvedValueOnce({ items: [rating({ id: 'a' })], nextCursor: null, appealsRemaining: 5 })
    .mockResolvedValueOnce({ items: [rating({ id: 'a', canAppeal: false })], nextCursor: null, appealsRemaining: 0 });
  jest.mocked(appealNoteRating).mockRejectedValue(
    new ApiError('quota', { status: 409, errorCode: 'NOTE_RATING_APPEAL_QUOTA' } as never),
  );
  render(<NoteBadRatingsScreen />);

  fireEvent.press(await screen.findByTestId('note-bad-rating-appeal-button-a'));
  fireEvent.changeText(screen.getByTestId('note-bad-rating-appeal-input'), 'please');
  await act(async () => {
    fireEvent.press(screen.getByTestId('note-bad-rating-appeal-submit'));
  });

  expect(alert).toHaveBeenCalledWith('notes.rating.badList.appealFailedTitle', 'serverErrors.NOTE_RATING_APPEAL_QUOTA');
  expect(reportHandledFailure).toHaveBeenCalledWith('noteRating', 'appeal', expect.any(ApiError));
  expect(screen.queryByTestId('sheet')).toBeNull();
  await waitFor(() => expect(screen.getByTestId('note-bad-ratings-quota')).toHaveTextContent('notes.rating.badList.appealsRemaining:0'));
  expect(screen.queryByTestId('note-bad-rating-appeal-button-a')).toBeNull();
});

test('a network failure keeps the appeal sheet open for a retry', async () => {
  jest.mocked(fetchNoteBadRatings).mockResolvedValue({ items: [rating({ id: 'a' })], nextCursor: null, appealsRemaining: 5 });
  jest.mocked(appealNoteRating).mockRejectedValue(new Error('offline'));
  render(<NoteBadRatingsScreen />);

  fireEvent.press(await screen.findByTestId('note-bad-rating-appeal-button-a'));
  fireEvent.changeText(screen.getByTestId('note-bad-rating-appeal-input'), 'please');
  await act(async () => {
    fireEvent.press(screen.getByTestId('note-bad-rating-appeal-submit'));
  });

  expect(screen.getByTestId('sheet')).toBeTruthy();
  expect(fetchNoteBadRatings).toHaveBeenCalledTimes(1);
});

test('loads the next page with the cursor', async () => {
  jest.mocked(fetchNoteBadRatings)
    .mockResolvedValueOnce({ items: [rating({ id: 'a' })], nextCursor: 'a', appealsRemaining: 5 })
    .mockResolvedValueOnce({ items: [rating({ id: 'z', reason: 'INACCURATE' })], nextCursor: null, appealsRemaining: 5 });
  render(<NoteBadRatingsScreen />);

  fireEvent.press(await screen.findByText('notes.rating.badList.loadMore'));

  await waitFor(() => expect(screen.getByTestId('note-bad-rating-z')).toBeTruthy());
  expect(fetchNoteBadRatings).toHaveBeenLastCalledWith('root-1', 'a');
  expect(screen.queryByText('notes.rating.badList.loadMore')).toBeNull();
});

test('a failed load offers a retry', async () => {
  jest.mocked(fetchNoteBadRatings)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ items: [], nextCursor: null, appealsRemaining: 5 });
  render(<NoteBadRatingsScreen />);

  fireEvent.press(await screen.findByText('common.retry'));

  expect(await screen.findByText('notes.rating.badList.empty')).toBeTruthy();
  expect(reportHandledFailure).toHaveBeenCalledWith('noteRating', 'loadBadRatings', expect.any(Error));
});
