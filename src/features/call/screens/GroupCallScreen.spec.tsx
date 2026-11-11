import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import GroupCallScreen from './GroupCallScreen';
import { showTopNotice } from '@/components/app/top-notice-store';
import { requestJoinToken } from '@/services/api/calls';
import { useCallStore } from '@/features/call/store/use-call-store';
import type { CallSession } from '@/features/call/types';

const self = { id: 'self', nickname: 'Local Person', avatarUrl: null };
const peer = { id: 'peer', nickname: 'Riley', avatarUrl: 'https://media.test/riley.jpg' };
const mockToggleMic = jest.fn(async () => undefined);
const mockLeave = jest.fn(async () => undefined);
const mockDisconnect = jest.fn(async () => undefined);
const mockBack = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockReplace = jest.fn();
const mockSetSpeakerphone = jest.fn(async () => undefined);
const mockStopVoiceAudioRouting = jest.fn();
const mockStartVoiceAudioRouting = jest.fn(() => mockStopVoiceAudioRouting);
let mockPeerConnected = true;
let mockRoomError: ((error: Error) => void) | undefined;
const mockParticipants = [
  { identity: self.id, name: self.nickname, isSpeaking: false, isMicrophoneEnabled: true },
  { identity: peer.id, name: peer.nickname, isSpeaking: false, isMicrophoneEnabled: false },
];
const mockRoom = { disconnect: mockDisconnect };

jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack(),
    replace: (path: string) => mockReplace(path),
  },
}));
jest.mock('@/components/app/top-notice-store', () => ({ showTopNotice: jest.fn() }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));
jest.mock('@/components/ui/avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/ui/group-chat-avatar', () => ({ GroupChatAvatar: () => null }));
jest.mock('@/services/api/calls', () => ({ requestJoinToken: jest.fn() }));
jest.mock('@/services/api/utils', () => ({ allowPeerMediaUrl: (value: string | null) => value }));
jest.mock('@/observability/sentry', () => ({ reportError: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/utils/dev-log', () => ({ devWarn: jest.fn() }));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'self' } }),
}));
jest.mock('@/chat-core/store', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ conversations: [{ id: 'conversation', name: 'Project room' }] }),
}));
jest.mock('@/features/call/call-session-teardown', () => ({
  leaveActiveCall: async () => {
    const { useCallStore } = jest.requireActual<typeof import('@/features/call/store/use-call-store')>(
      '@/features/call/store/use-call-store',
    );
    const call = useCallStore.getState().activeCall;
    if (!call) return;
    await mockLeave();
    if (useCallStore.getState().activeCall === call) useCallStore.getState().resetCallState();
  },
}));
jest.mock('@/features/call/use-call-telemetry', () => ({
  useCallTelemetry: () => ({ disconnected: jest.fn() }),
  useCallRoomTelemetry: jest.fn(),
}));
jest.mock('@/features/call/livekit-module', () => ({
  getInitialLiveKitModule: () => ({
    LiveKitRoom: ({ children, onError }: {
      children: React.ReactNode;
      onError: (error: Error) => void;
    }) => {
      mockRoomError = onError;
      return children;
    },
    RoomAudioRenderer: () => null,
    VideoTrack: () => null,
    useConnectionState: () => 'connected',
    useLocalParticipant: () => ({
      localParticipant: { identity: 'self', setMicrophoneEnabled: mockToggleMic },
      isMicrophoneEnabled: true,
    }),
    useParticipants: () => mockPeerConnected ? mockParticipants : mockParticipants.slice(0, 1),
    useRoomContext: () => mockRoom,
    useTracks: () => [],
    setSpeakerphone: mockSetSpeakerphone,
    startVoiceAudioRouting: mockStartVoiceAudioRouting,
  }),
}));

function renderCall(
  sessionType: CallSession['sessionType'],
  status: CallSession['status'] = 'ACTIVE',
  withCredentials = true,
) {
  useCallStore.getState().setActiveCall(
    {
      id: 'call',
      conversationID: 'conversation',
      sessionType,
      status,
      callType: 'AUDIO',
      initiator: self,
      participants: [self, peer].map((user) => ({
        user, status: 'JOINED', invitedAt: null, joinedAt: null, leftAt: null,
      })),
      startedAt: null, endedAt: null, expiresAt: null, durationSeconds: null, endReason: null,
    },
    withCredentials ? { url: 'wss://livekit.test', token: 'token', expiresAt: '' } : null,
  );
  return render(<GroupCallScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPeerConnected = true;
  mockCanGoBack.mockReturnValue(true);
});

test('private voice calls show the peer and expose working call controls', async () => {
  renderCall('single');

  expect(screen.getByText('Riley')).toBeTruthy();
  expect(screen.queryByText('call.participantsOnline:2')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'call.voice.micOn' }));
  await waitFor(() => expect(mockToggleMic).toHaveBeenCalledWith(false));
  fireEvent.press(screen.getByRole('button', { name: 'call.voice.speaker' }));
  await waitFor(() => expect(mockSetSpeakerphone).toHaveBeenCalledWith(true));
  await screen.findByRole('button', { name: 'call.voice.speakerOn' });
});

test('local hangup closes the call once and shows a short ended notice', async () => {
  renderCall('single');

  fireEvent.press(screen.getByRole('button', { name: 'call.voice.hangUp' }));
  await waitFor(() => expect(showTopNotice).toHaveBeenCalledWith({
    title: 'chat.callRecord.ended',
  }));
  expect(showTopNotice).toHaveBeenCalledTimes(1);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(mockDisconnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('call.ended')).toBeNull();
});

test.each([true, false])('a remote end closes the call even when back availability is %s', (canGoBack) => {
  mockCanGoBack.mockReturnValue(canGoBack);
  renderCall('group');

  act(() => {
    useCallStore.getState().handleCallEnded({
      callId: 'call', status: 'ENDED', endReason: null, endedAt: null, changedAt: '',
    });
  });

  expect(mockBack).toHaveBeenCalledTimes(canGoBack ? 1 : 0);
  expect(mockReplace).toHaveBeenCalledTimes(canGoBack ? 0 : 1);
  if (!canGoBack) expect(mockReplace).toHaveBeenCalledWith('/(tabs)/messages');
  expect(showTopNotice).toHaveBeenCalledTimes(1);
  expect(showTopNotice).toHaveBeenCalledWith({ title: 'chat.callRecord.ended' });
  expect(mockLeave).not.toHaveBeenCalled();
  expect(mockDisconnect).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('call.ended')).toBeNull();
});

test('an ended call exits even when its session cleared before the screen mounted', () => {
  useCallStore.getState().resetCallState();
  render(<GroupCallScreen />);

  expect(showTopNotice).toHaveBeenCalledWith({ title: 'chat.callRecord.ended' });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('call.ended')).toBeNull();
});

test('an active session without credentials still shows invalid connection information', () => {
  renderCall('single', 'ACTIVE', false);

  expect(screen.getByText('call.ended')).toBeTruthy();
  expect(showTopNotice).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
});

test('retrying a room connection replaces the room without leaving the active call', async () => {
  renderCall('single');
  jest.mocked(requestJoinToken).mockResolvedValue({
    call: useCallStore.getState().activeCall!,
    selfParticipant: null,
    livekit: { url: 'wss://livekit.test', token: 'retried', expiresAt: '' },
  });

  act(() => mockRoomError?.(new Error('Connection failed')));
  fireEvent.press(screen.getByText('call.reconnect'));
  await waitFor(() => expect(screen.queryByText('call.reconnect')).toBeNull());

  expect(useCallStore.getState().activeCall?.id).toBe('call');
  expect(mockDisconnect).toHaveBeenCalledTimes(1);
  expect(mockLeave).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
  expect(showTopNotice).not.toHaveBeenCalled();
});

test('group voice calls show the group name, online count, and participant microphone status', () => {
  renderCall('group');

  expect(screen.getByText('Project room')).toBeTruthy();
  expect(screen.getByText('call.participantsOnline:2')).toBeTruthy();
  expect(screen.getByText('call.self')).toBeTruthy();
  expect(screen.getByText('Riley')).toBeTruthy();
  expect(screen.getByLabelText('call.voice.participantMuted')).toBeTruthy();
});

test('outgoing private calls show the peer and waiting state before they answer', () => {
  mockPeerConnected = false;
  renderCall('single', 'RINGING');

  expect(screen.getByText('Riley')).toBeTruthy();
  expect(screen.getByLabelText('call.voice.waitingPeer')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'common.cancel' })).toBeTruthy();
});

test('voice calls start the audio route on entry and release it on exit', () => {
  const { unmount } = renderCall('single');
  expect(mockStartVoiceAudioRouting).toHaveBeenCalledTimes(1);
  expect(mockStopVoiceAudioRouting).not.toHaveBeenCalled();
  unmount();
  expect(mockStopVoiceAudioRouting).toHaveBeenCalledTimes(1);
});
