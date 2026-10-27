import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import { acceptCall, fetchCurrentCall, rejectCall } from '@/services/api/calls';
import { useCallStore } from '@/features/call/store/use-call-store';
import type { CallInvitePayload } from '@/features/call/types';
import { useCallPushBridge } from './use-call-push-bridge';
import { handleCallNotification } from './incoming-call-actions';

const mockAuth = {
  state: { isAuthenticated: true, isLoading: false, user: { id: 'user-2' } } as Record<
    string,
    unknown
  >,
};

type MockNative = {
  queue: unknown[];
  listener: null | (() => void);
  [method: string]: unknown;
};

const mockNative: MockNative & Record<string, jest.Mock | unknown> = {
  queue: [] as unknown[],
  listener: null as null | (() => void),
  configure: jest.fn(async () => undefined),
  consumeEvents: jest.fn(async (): Promise<unknown[]> => mockNative.queue.splice(0)),
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
    nativeUiFallbackCallId: null,
  });
}

function ringingOnServer(callId = 'call-1') {
  return {
    call: {
      id: callId,
      conversationID: 'direct:user-1:user-2',
      sessionType: 'single' as const,
      callType: 'AUDIO' as const,
      status: 'RINGING' as const,
      initiator: alice,
      startedAt: null,
      endedAt: null,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      durationSeconds: null,
      endReason: null,
      participants: [],
    },
    selfParticipant: {
      user: bob,
      status: 'INVITED' as const,
      invitedAt: null,
      joinedAt: null,
      leftAt: null,
    },
  };
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

  test('stops CallKit ringing for a call the server already let go during cold start', async () => {
    // 冷启动期间主叫取消了：服务端说我已不在邀请里，WS 不会重放 call.canceled。
    jest.mocked(fetchCurrentCall).mockResolvedValue(null);
    renderHook(() => useCallPushBridge());

    await emitNative({ type: 'incoming', callId: 'call-1', shown: true });

    await waitFor(() => expect(mockNative.endCall).toHaveBeenCalledWith('call-1', 'ended'));
  });

  test('leaves native ringing alone when the server could not be reached', async () => {
    jest.mocked(fetchCurrentCall).mockRejectedValue(new Error('offline'));
    renderHook(() => useCallPushBridge());

    await emitNative({ type: 'incoming', callId: 'call-1', shown: true });

    await waitFor(() => expect(fetchCurrentCall).toHaveBeenCalled());
    expect(mockNative.endCall).not.toHaveBeenCalled();
  });

  test('still tries to answer when recovery could not reach the server, and ends CallKit if that fails', async () => {
    jest.mocked(fetchCurrentCall).mockRejectedValue(new Error('offline'));
    jest.mocked(acceptCall).mockRejectedValue(new Error('offline'));
    renderHook(() => useCallPushBridge());

    await emitNative({ type: 'answer', callId: 'call-1' });

    await waitFor(() => expect(mockNative.endCall).toHaveBeenCalledWith('call-1', 'failed'));
    expect(acceptCall).toHaveBeenCalledWith('call-1');
  });

  test('ends native calls that arrive while signed out instead of leaving CallKit connected', async () => {
    mockAuth.state = { isAuthenticated: false, isLoading: false, user: null };
    mockNative.queue.push({ type: 'answer', callId: 'call-1' }, { type: 'incoming', callId: 'call-2' });

    renderHook(() => useCallPushBridge());

    await waitFor(() => expect(mockNative.endCall).toHaveBeenCalledTimes(2));
    expect(mockNative.endCall).toHaveBeenCalledWith('call-1', 'failed');
    expect(mockNative.endCall).toHaveBeenCalledWith('call-2', 'failed');
    expect(acceptCall).not.toHaveBeenCalled();
  });

  test('falls back to the in-app sheet when CallKit refused the call', async () => {
    renderHook(() => useCallPushBridge());
    act(() => {
      useCallStore.getState().handleCallInvite(invite());
    });

    await emitNative({ type: 'unavailable', callId: 'call-1' });

    await waitFor(() =>
      expect(useCallStore.getState().nativeUiFallbackCallId).toBe('call-1'),
    );
    expect(useCallStore.getState().incomingCall?.callId).toBe('call-1');
  });

  test('ends the native side for an end event even when the store never had the call', async () => {
    renderHook(() => useCallPushBridge());

    await emitNative({ type: 'end', callId: 'call-unknown', reason: 'canceled' });

    await waitFor(() =>
      expect(mockNative.endCall).toHaveBeenCalledWith('call-unknown', 'canceled'),
    );
  });

  describe('on Android', () => {
    const originalOS = Platform.OS;
    let appStateListener: ((state: string) => void) | null = null;

    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
      jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
        appStateListener = listener as (state: string) => void;
        return { remove: () => (appStateListener = null) } as never;
      });
      Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    });

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
    });

    // 原生层在响的 callId 记在模块级集合里、跨用例保留：这里用一个没出现过的 id。
    test('rings natively when the app goes to background, even after a foreground push', async () => {
      jest.mocked(fetchCurrentCall).mockResolvedValue(ringingOnServer('call-android'));
      renderHook(() => useCallPushBridge());

      // 前台：WS 邀请 + 透传都到了，原生层没响（shown=false），应用内弹窗负责。
      act(() => {
        useCallStore.getState().handleCallInvite(invite({ callId: 'call-android' }));
      });
      await emitNative({ type: 'incoming', callId: 'call-android', shown: false });
      expect(mockNative.showIncomingCall).not.toHaveBeenCalled();

      act(() => {
        appStateListener?.('background');
      });

      expect(mockNative.showIncomingCall).toHaveBeenCalledWith(
        expect.objectContaining({ callId: 'call-android' }),
      );
    });
  });

  describe('China notification-mode call alerts', () => {
    test('opening a call alert brings up the in-app incoming sheet', async () => {
      jest.mocked(fetchCurrentCall).mockResolvedValue(ringingOnServer('call-alert'));

      expect(handleCallNotification({ type: 'call.invite', callId: 'call-alert' })).toBe(true);

      await waitFor(() =>
        expect(useCallStore.getState().incomingCall?.callId).toBe('call-alert'),
      );
    });

    test('a replacement alert dismisses the sheet, other pushes are left to normal routing', () => {
      useCallStore.getState().handleCallInvite(invite({ callId: 'call-alert' }));

      expect(
        handleCallNotification({ type: 'call.dismiss', callId: 'call-alert', reason: 'canceled' }),
      ).toBe(true);
      expect(useCallStore.getState().incomingCall).toBeNull();
      expect(useCallStore.getState().lastDismissal).toEqual({
        callId: 'call-alert',
        reason: 'canceled',
      });
      expect(handleCallNotification({ type: 'FRIEND_REQUEST' })).toBe(false);
    });
  });
});
