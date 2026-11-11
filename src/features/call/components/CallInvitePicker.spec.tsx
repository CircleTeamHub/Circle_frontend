import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CallInvitePicker } from './CallInvitePicker';
import { fetchChatMembers } from '@/chat-core/api';
import { fetchFriends } from '@/services/api/friends';
import { inviteCallParticipants } from '@/services/api/calls';
import type { CallSession, CallParticipantStatus } from '@/features/call/types';

const mockClose = jest.fn();
const mockInvited = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/bottom-sheet-modal', () => {
  const { FlatList } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    BottomSheetModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? children : null,
    BottomSheetFlatList: (props: React.ComponentProps<typeof FlatList>) => <FlatList {...props} />,
  };
});
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: string } }) => unknown) => selector({ user: { id: 'me' } }),
}));
jest.mock('@/chat-core/api', () => ({ fetchChatMembers: jest.fn() }));
jest.mock('@/services/api/friends', () => ({ fetchFriends: jest.fn() }));
jest.mock('@/services/api/calls', () => ({ inviteCallParticipants: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/services/api/utils', () => ({ allowPeerMediaUrl: (value: string | null) => value }));
jest.mock('@/utils/idempotency-key', () => ({ generateIdempotencyKey: () => 'invite-key' }));
jest.mock('@/components/app/top-notice-store', () => ({
  topNotice: { success: jest.fn() },
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

function participant(id: string, status: CallParticipantStatus) {
  return {
    user: { id, nickname: id, avatarUrl: null },
    status, invitedAt: null, joinedAt: null, leftAt: null,
  };
}

const call: CallSession = {
  id: 'call-1', conversationID: 'group-1', sessionType: 'group', invitationMode: 'members',
  callType: 'AUDIO', status: 'ACTIVE',
  initiator: { id: 'me', nickname: 'Me', avatarUrl: null },
  startedAt: null, endedAt: null, expiresAt: '2020-01-01T00:00:00.000Z',
  durationSeconds: null, endReason: null,
  participants: [
    participant('me', 'JOINED'), participant('joined', 'JOINED'),
    participant('invited', 'INVITED'), participant('departed', 'LEFT'),
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(fetchChatMembers).mockResolvedValue(
    ['me', 'joined', 'invited', 'departed', 'new'].map((userId) => ({
      userId, nickname: userId, avatarUrl: null, role: 'MEMBER' as const,
    })),
  );
  jest.mocked(inviteCallParticipants).mockResolvedValue(call);
});

test('disables current participants and permits inviting a departed member after the original ring deadline', async () => {
  render(<CallInvitePicker visible onClose={mockClose} call={call} onInvited={mockInvited} />);
  await screen.findByRole('checkbox', { name: 'departed' });

  for (const name of ['me', 'joined', 'invited']) {
    expect(screen.getByRole('checkbox', { name }).props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByRole('checkbox', { name }));
  }
  fireEvent.changeText(screen.getByPlaceholderText('call.invite.searchPlaceholder'), 'depart');
  fireEvent.press(screen.getByRole('checkbox', { name: 'departed' }));
  fireEvent.press(screen.getByRole('button', { name: 'call.invite.submit:1' }));

  await waitFor(() => expect(mockInvited).toHaveBeenCalledWith(call));
  expect(inviteCallParticipants).toHaveBeenCalledWith('call-1', ['departed'], { idempotencyKey: 'invite-key' });
  expect(mockClose).toHaveBeenCalledTimes(1);
});

test('conference calls load contacts and search friend remarks', async () => {
  jest.mocked(fetchFriends).mockResolvedValue([{
    id: 'friend', nickname: 'Alice', remark: 'Doctor', accountId: '123',
    avatarUrl: null, avatarFrameAppearance: null, friendsSince: '',
  }]);
  render(<CallInvitePicker visible onClose={mockClose} call={{
    ...call, invitationMode: 'contacts', conversationID: 'conference:call-1',
  }} onInvited={mockInvited} />);
  await screen.findByRole('checkbox', { name: 'Doctor' });
  fireEvent.changeText(screen.getByPlaceholderText('call.invite.searchPlaceholder'), 'Alice');

  expect(screen.getByRole('checkbox', { name: 'Doctor' })).toBeTruthy();
  expect(fetchChatMembers).not.toHaveBeenCalled();
});

test('failed invites keep the selection and can be retried with the same intent key', async () => {
  jest.mocked(inviteCallParticipants).mockRejectedValueOnce(new Error('private internal URL'));
  render(<CallInvitePicker visible onClose={mockClose} call={call} onInvited={mockInvited} />);
  fireEvent.press(await screen.findByRole('checkbox', { name: 'new' }));
  fireEvent.press(screen.getByRole('button', { name: 'call.invite.submit:1' }));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('call.invite.failed'));
  expect(mockClose).not.toHaveBeenCalled();
  expect(mockInvited).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'call.invite.submit:1' }));
  await waitFor(() => expect(mockInvited).toHaveBeenCalledTimes(1));
  expect(inviteCallParticipants).toHaveBeenNthCalledWith(2, 'call-1', ['new'], { idempotencyKey: 'invite-key' });
});

test('rapid send presses produce one request while an invite is pending', async () => {
  let resolveInvite!: (value: CallSession) => void;
  jest.mocked(inviteCallParticipants).mockReturnValue(new Promise((resolve) => { resolveInvite = resolve; }));
  render(<CallInvitePicker visible onClose={mockClose} call={call} onInvited={mockInvited} />);
  fireEvent.press(await screen.findByRole('checkbox', { name: 'new' }));
  const send = screen.getByRole('button', { name: 'call.invite.submit:1' });
  fireEvent.press(send);
  fireEvent.press(send);
  expect(inviteCallParticipants).toHaveBeenCalledTimes(1);
  await act(async () => resolveInvite(call));
  expect(mockInvited).toHaveBeenCalledTimes(1);
});
