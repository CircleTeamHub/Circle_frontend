import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import FriendActivityDetailScreen from './FriendActivityDetailScreen';
import {
  acceptFriendRequest,
  fetchFriendActivityDetail,
  rejectFriendRequest,
  sendFriendRequestMessage,
} from '@/services/api/friends';

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn() },
  useLocalSearchParams: () => ({ id: 'activity-1' }),
  useSegments: () => ['(tabs)', 'contacts'],
}));
// A stable t, like the real hook: the screen reloads the activity whenever t changes.
const mockTranslation = { t: (key: string) => key, i18n: { language: 'en' } };
jest.mock('react-i18next', () => ({
  useTranslation: () => mockTranslation,
}));
jest.mock('@/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/theme', () => ({
  Radius: {},
  Spacing: {},
  Typography: {},
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: 'me' } }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/member-name', () => ({ MemberName: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});
jest.mock('@/features/user/utils/routes', () => ({
  getUserProfileHref: () => '/profile',
  getUserProfileScopeFromSegments: () => 'contacts',
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/services/api/friends', () => ({
  acceptFriendRequest: jest.fn(),
  cancelFriendRequest: jest.fn(),
  fetchFriendActivityDetail: jest.fn(),
  fetchFriendRequestMessages: jest.fn(async () => []),
  markFriendActivityRead: jest.fn(async () => undefined),
  rejectFriendRequest: jest.fn(),
  sendFriendRequestMessage: jest.fn(),
}));

const pendingRequest = {
  id: 'activity-1',
  type: 'REQUEST_RECEIVED',
  requestId: 'request-1',
  requestState: 'PENDING',
  messageSnapshot: null,
  readAt: null,
  createdAt: '2026-11-07T00:00:00.000Z',
  counterparty: { id: 'friend-1', nickname: 'Friend', accountId: 'friend', avatarUrl: null },
};

/** Two taps landing before React re-renders: only a ref checked at handler entry stops the second. */
function pressTwiceBeforeRerender(text: string) {
  let node = screen.getByText(text);
  while (!node.props.onPress) node = node.parent!;
  const { onPress } = node.props;
  act(() => {
    onPress();
    onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(fetchFriendActivityDetail).mockResolvedValue(pendingRequest as never);
});

test.each([
  ['contacts.friendActivity.accept', acceptFriendRequest],
  ['contacts.friendActivity.reject', rejectFriendRequest],
] as const)('a double tap on %s answers the request once', async (label, decide) => {
  jest.mocked(decide).mockResolvedValue(undefined as never);
  render(<FriendActivityDetailScreen />);
  await screen.findByText(label);

  pressTwiceBeforeRerender(label);

  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect(decide).toHaveBeenCalledTimes(1);
  expect(acceptFriendRequest).toHaveBeenCalledTimes(decide === acceptFriendRequest ? 1 : 0);
  expect(rejectFriendRequest).toHaveBeenCalledTimes(decide === rejectFriendRequest ? 1 : 0);
});

test('a double tap on send posts the reply once', async () => {
  jest.mocked(sendFriendRequestMessage).mockResolvedValue({
    id: 'msg-1',
    senderId: 'me',
    content: 'hi',
    createdAt: '2026-11-07T00:00:00.000Z',
  } as never);
  render(<FriendActivityDetailScreen />);
  fireEvent.changeText(
    await screen.findByPlaceholderText('contacts.friendActivity.replyPlaceholder'),
    'hi',
  );

  pressTwiceBeforeRerender('contacts.friendActivity.send');

  await waitFor(() => expect(screen.getByText('hi')).toBeTruthy());
  expect(sendFriendRequestMessage).toHaveBeenCalledTimes(1);
});
