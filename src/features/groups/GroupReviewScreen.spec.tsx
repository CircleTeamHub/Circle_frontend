import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupReviewScreen from './GroupReviewScreen';
import { actOnGroupReviews, fetchGroupReviews, type GroupReviewItem } from '@/services/api/group-reviews';
import { router } from 'expo-router';

const mockAuth = { user: { id: 'me' }, sessionEpoch: 1 };
const mockGate = { shouldSkip: () => false, markLoaded: () => {} };
const mockT = (key: string, values?: Record<string, unknown>) => values?.name ? `${key}:${values.name}` : key;
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useSegments: () => ['(tabs)', 'messages'],
  useLocalSearchParams: () => ({ conversationID: 'group-1', title: 'Test group' }),
  useFocusEffect: (callback: () => void) => { const { useEffect } = jest.requireActual('react'); useEffect(callback, [callback]); },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/theme', () => ({
  Radius: { lg: 16, xl: 20, full: 999 }, Spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  Typography: { body: {}, bodyRegular: {}, caption: {}, small: {}, h3: {} },
  useTheme: () => ({ colors: { background: '#f5f5f5', surface: '#fff', surfaceBorder: '#ddd', text: '#111', textSecondary: '#666', primary: '#66f', white: '#fff', success: '#0a0', error: '#f00' } }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/member-name', () => {
  const { Text } = jest.requireActual('react-native');
  return { MemberName: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: ({ rightSlot }: { rightSlot: React.ReactNode }) => <>{rightSlot}</> }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({ KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: Object.assign((select: (s: unknown) => unknown) => select(mockAuth), { getState: () => mockAuth }) }));
jest.mock('@/services/api/group-reviews', () => ({ fetchGroupReviews: jest.fn(), actOnGroupReviews: jest.fn() }));
jest.mock('@/services/api/circles', () => ({ markCircleWrite: (promise: Promise<unknown>) => promise }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/hooks/use-focus-reload-gate', () => ({ useFocusReloadGate: () => mockGate }));
jest.mock('@/features/chat/utils/group-reload-key', () => ({ groupOrCircleMutatedSince: () => false }));

const item = (id: string, status: GroupReviewItem['status'] = 'PENDING'): GroupReviewItem => ({
  id, conversationId: 'group-1', applicant: { id: `user-${id}`, nickname: `Person ${id}`, accountId: id, avatarUrl: null },
  inviter: { id: 'inviter', nickname: 'Inviter', accountId: '999', avatarUrl: null }, source: 'INVITE', status, reason: '',
  createdAt: '2026-11-01T01:00:00Z', updatedAt: '2026-11-01T01:00:00Z',
});
const page = (items = [item('pending'), item('done', 'JOINED'), item('consent', 'INVITED')], cursor: string | null = null) => ({ group: { id: 'group-1', name: 'Test group', circleId: null }, items, nextCursor: cursor });
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchGroupReviews).mockResolvedValue(page());
  jest.mocked(actOnGroupReviews).mockResolvedValue({ results: [] });
});

test('selects only pending decisions and never approves an unaccepted invitation', async () => {
  render(<GroupReviewScreen />);
  await screen.findByText('Person pending');
  fireEvent.press(screen.getByLabelText('groupReview.selectAll'));
  expect(screen.getByTestId('group-review-select-pending').props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('group-review-select-done').props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId('group-review-select-consent').props.accessibilityState.disabled).toBe(true);
});

test('keeps failed items selected after partial success and never silently retries', async () => {
  jest.mocked(fetchGroupReviews).mockResolvedValue(page([item('one'), item('two')]));
  jest.mocked(actOnGroupReviews).mockResolvedValue({ results: [{ id: 'one', ok: true }, { id: 'two', ok: false, errorCode: 'CHAT_GROUP_FULL' }] });
  const confirm = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<GroupReviewScreen />);
  await screen.findByText('Person one');
  fireEvent.press(screen.getByLabelText('groupReview.selectAll'));
  fireEvent.press(screen.getByTestId('group-review-approve'));
  const buttons = confirm.mock.calls[0][2]!;
  await act(async () => { await buttons[buttons.length - 1].onPress!(); });
  expect(actOnGroupReviews).toHaveBeenCalledTimes(1);
  expect(actOnGroupReviews).toHaveBeenCalledWith('group-1', ['one', 'two'], 'approve');
  expect(screen.getByTestId('group-review-select-two').props.accessibilityState.checked).toBe(true);
  expect(screen.getByTestId('group-review-select-one').props.accessibilityState.disabled).toBe(true);
  confirm.mockRestore();
});

test('shows invite source and opens logs in the same messages stack', async () => {
  render(<GroupReviewScreen />);
  await screen.findByText('Person pending');
  expect(screen.getAllByText('groupReview.invitedBy:Inviter').length).toBeGreaterThan(0);
  fireEvent.press(screen.getByLabelText('groupReview.log'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/messages/group-log', params: { conversationID: 'group-1', title: 'Test group' } });
});

test('searches the server for account IDs rather than filtering the loaded page', async () => {
  render(<GroupReviewScreen />);
  await screen.findByText('Person pending');
  fireEvent.changeText(screen.getByTestId('group-review-search'), '144442');
  fireEvent(screen.getByTestId('group-review-search'), 'submitEditing');
  await waitFor(() => expect(fetchGroupReviews).toHaveBeenLastCalledWith('group-1', { keyword: '144442' }));
});

test('does not page using an old cursor while refreshing the first page', async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  jest.mocked(fetchGroupReviews).mockResolvedValueOnce(page([item('one')], 'old-cursor'))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<GroupReviewScreen />);
  await screen.findByText('Person one');
  fireEvent(screen.getByTestId('group-review-list'), 'refresh');
  fireEvent(screen.getByTestId('group-review-list'), 'endReached');
  expect(fetchGroupReviews).toHaveBeenCalledTimes(2);
  await act(async () => { finish(page([item('two')])); });
  expect(await screen.findByText('Person two')).toBeTruthy();
});
