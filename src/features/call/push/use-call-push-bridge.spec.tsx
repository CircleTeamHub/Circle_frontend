import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { acceptCall, fetchCurrentCall, rejectCall } from '@/services/api/calls';
import { useCallStore } from '@/features/call/store/use-call-store';
import type { CallInvitePayload } from '@/features/call/types';
import { useCallPushBridge } from './use-call-push-bridge';

const mockAuth = {
  state: { isAuthenticated: true, isLoading: false, user: { id: 'user-2' } } as Record<
    string,
    unknown
  >,
};

const mockNative = {
  queue: [] as unknown[],
  listener: null as null | (() => void),
  configure: jest.fn(async () => undefined),
  consumeEvents: jest.fn(async () => mockNative.queue.splice(0)),
  getVoipToken: jest.fn(async () => null),
  showIncomingCall: jest.fn(async () => undefined),
  endCall: jest.fn(async () => undefined),
  canUseFullScreenIntent: jest.fn(() => true),
  openFullScreenIntentSettings: jest.fn(async () => undefined),
  addListener: jest.fn((_event: string, listener: () => void) => {
    mockNative.listener = listener;
    return { remove: () => (mockNative.listener = null) };
  }),
};

// 工厂在 import 时就跑（早于上面的 const 初始化）：用 getter 延后到调用时再取。
jest.mock('../../../../modules/call-push', () => ({
  __esModule: true,
  get default() {
    return mockNative;
  },
}));
jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector(mockAuth.state),
    { getState: () => mockAuth.state },
  ),
}));
jest.mock('@/services/api/calls', () => ({
  acceptCall: jest.fn(),
  rejectCall: jest.fn(async () => undefined),
  fetchCurrentCall: jest.fn(async () => null),
  leaveCall: jest.fn(async () => undefined),
  cancelCall: jest.fn(async () => undefined),
}));
jest.mock('@/services/api/errors', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('@/services/auth/session', () => ({
  registerLogoutHandler: jest.fn(() => () => undefined),
}));
jest.mock('@/constants/config', () => ({ API_URL: 'https://api.test/api/v1' }));
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { t: (key: string) => key },
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const alice = { id: 'user-1', nickname: 'Alice', avatarUrl: null };
const bob = { id: 'user-2', nickname: 'Bob', avatarUrl: null };

function invite(overrides: Partial<CallInvitePayload> = {}): CallInvitePayload {
  return {
    callId: 'call-1',
    conversationID: 'direct:user-1:user-2',
    sessionType: 'single',
    callType: 'VIDEO',
    initiator: alice,
    invitees: [bob],
    expiresAt: new Date(Date.now() + 40_000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function acceptedResponse(callId = 'call-1') {
  return {
    call: { ...useCallStore.getState().activeCall!, id: callId, status: 'ACTIVE' as const },
    selfParticipant: null,
    livekit: { url: 'wss://lk', token: 'lk-token', expiresAt: '2026-10-26T13:00:00.000Z' },
  };
}

function resetStore() {
  useCallStore.setState({
    incomingCall: null,
    activeCall: null,
    livekit: null,
    answeringCallId: null,
    recentlyEndedCallIds: [],
    lastDismissal: null,
  });
}

async function emitNative(...events: unknown[]) {
  mockNative.queue.push(...events);
  await act(async () => {
    mockNative.listener?.();
  });
}

describe('useCallPushBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNative.queue = [];
    mockAuth.state = { isAuthenticated: true, isLoading: false, user: { id: 'user-2' } };
    resetStore();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  test('points the native layer at the API and drains events queued before JS loaded', async () => {
    useCallStore.getState().handleCallInvite(invite());
    jest.mocked(acceptCall).mockImplementation(async () => acceptedResponse());
    // 锁屏上点了接听，App 被拉起时这条已经在原生队列里了。
    mockNative.queue.push({ type: 'answer', callId: 'call-1' });

    renderHook(() => useCallPushBridge());

    expect(mockNative.configure).toHaveBeenCalledWith('https://api.test/api/v1');
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/(chat)/group-call'));
    expect(acceptCall).toHaveBeenCalledWith('call-1');
    expect(useCallStore.getState().livekit?.token).toBe('lk-token');
    expect(useCallStore.getState().incomingCall).toBeNull();
  });

  test('recovers a call the WebSocket never delivered before answering it', async () => {
    jest.mocked(fetchCurrentCall).mockResolvedValue({
      call: {
        id: 'call-1',
        conversationID: 'direct:user-1:user-2',
        sessionType: 'single',
        callType: 'AUDIO',
        status: 'RINGING',
        initiator: alice,
        startedAt: null,
        endedAt: null,
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        durationSeconds: null,
        endReason: null,
        participants: [],
      },
      selfParticipant: { user: bob, status: 'INVITED', invitedAt: null, joinedAt: null, leftAt: null },
    });
    jest.mocked(acceptCall).mockImplementation(async () => acceptedResponse());
    renderHook(() => useCallPushBridge());

    await emitNative({ type: 'answer', callId: 'call-1' });

    await waitFor(() => expect(acceptCall).toHaveBeenCalledWith('call-1'));
  });

  test('ends the native call instead of answering one that is already over', async () => {
    renderHook(() => useCallPushBridge());

    await emitNative({ type: 'answer', callId: 'call-gone' });

    await waitFor(() =>
      expect(mockNative.endCall).toHaveBeenCalledWith('call-gone', 'ended'),
    );
    expect(acceptCall).not.toHaveBeenCalled();
  });

  test('tells the server about a decline unless the native layer already did', async () => {
    renderHook(() => useCallPushBridge());

    useCallStore.getState().handleCallInvite(invite());
    await emitNative({ type: 'decline', callId: 'call-1', declinedByNative: false });
    await waitFor(() => expect(rejectCall).toHaveBeenCalledWith('call-1'));
    expect(useCallStore.getState().incomingCall).toBeNull();

    useCallStore.getState().handleCallInvite(invite({ callId: 'call-2' }));
    await emitNative({ type: 'decline', callId: 'call-2', declinedByNative: true });
    expect(rejectCall).toHaveBeenCalledTimes(1);
    expect(useCallStore.getState().incomingCall).toBeNull();
  });

  test('hands every ringing call to CallKit and ends it with the reason it stopped', async () => {
    renderHook(() => useCallPushBridge());

    act(() => {
      useCallStore.getState().handleCallInvite(invite());
    });
    expect(mockNative.showIncomingCall).toHaveBeenCalledWith({
      callId: 'call-1',
      callerName: 'Alice',
      hasVideo: true,
      isGroup: false,
      expiresAt: expect.any(String),
    });

    act(() => {
      useCallStore.getState().handleCallEnded({
        callId: 'call-1',
        status: 'CANCELED',
        endReason: 'CANCELED',
        endedAt: null,
        changedAt: new Date().toISOString(),
      });
    });
    expect(mockNative.endCall).toHaveBeenCalledWith('call-1', 'canceled');
  });

  test('stops native ringing for another device answering', async () => {
    renderHook(() => useCallPushBridge());
    act(() => {
      useCallStore.getState().handleCallInvite(invite());
      useCallStore.getState().handleSelfParticipantSettled('call-1', 'answered_elsewhere');
    });

    expect(mockNative.endCall).toHaveBeenCalledWith('call-1', 'answered_elsewhere');
  });

  test('keeps the system call going once it is answered in the app', async () => {
    renderHook(() => useCallPushBridge());
    act(() => {
      useCallStore.getState().handleCallInvite(invite());
    });

    act(() => {
      useCallStore.getState().setActiveCall(acceptedResponse().call, acceptedResponse().livekit);
    });

    expect(mockNative.endCall).toHaveBeenCalledWith('call-1', 'answered');
    expect(mockNative.endCall).not.toHaveBeenCalledWith('call-1', 'ended');
  });

  test('leaves the native queue alone until the session is ready', async () => {
    mockAuth.state = { isAuthenticated: true, isLoading: true, user: null };
    const { rerender } = renderHook(() => useCallPushBridge());
    expect(mockNative.consumeEvents).not.toHaveBeenCalled();

    mockAuth.state = { isAuthenticated: true, isLoading: false, user: { id: 'user-2' } };
    rerender({});

    await waitFor(() => expect(mockNative.consumeEvents).toHaveBeenCalled());
  });

  test('dismisses a call the native layer stopped ringing on its own', async () => {
    renderHook(() => useCallPushBridge());
    useCallStore.getState().handleCallInvite(invite());

    await emitNative({ type: 'end', callId: 'call-1', reason: 'missed' });

    await waitFor(() => expect(useCallStore.getState().incomingCall).toBeNull());
    expect(useCallStore.getState().lastDismissal).toEqual({ callId: 'call-1', reason: 'missed' });
  });
});
