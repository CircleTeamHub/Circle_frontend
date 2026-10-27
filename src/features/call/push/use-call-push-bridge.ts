import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { API_URL } from '@/constants/config';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/features/call/store/use-call-store';
import type { CallInvitePayload } from '@/features/call/types';
import { leaveActiveCall } from '@/features/call/call-session-teardown';
import { reportHandledFailure } from '@/observability/report-failure';
import type {
  CallPushNativeEvent,
  CallPushNativeModule,
} from '../../../../modules/call-push';
import { getCallPushModule } from './call-push-native';
import {
  dismissReasonFromNative,
  notifyVoipTokenChanged,
  parseCallPushEvent,
} from './call-push-events';
import {
  answerIncomingCall,
  declineIncomingCall,
  recoverRingingCall,
} from './incoming-call-actions';

/** 原生层已经在响的那几通（推送来的）：JS 不必再交给它响一次。 */
const nativeRinging = new Set<string>();

function nativeCall(invite: CallInvitePayload) {
  return {
    callId: invite.callId,
    callerName: invite.initiator.nickname,
    hasVideo: invite.callType === 'VIDEO',
    isGroup: invite.sessionType === 'group',
    expiresAt: invite.expiresAt,
  };
}

function isReady(): boolean {
  const auth = useAuthStore.getState();
  return auth.isAuthenticated && !auth.isLoading;
}

async function handleNativeEvent(event: CallPushNativeEvent): Promise<void> {
  const native = getCallPushModule();
  switch (event.type) {
    case 'voipToken':
      notifyVoipTokenChanged();
      return;
    case 'incoming':
      nativeRinging.add(event.callId);
      await recoverRingingCall(event.callId);
      return;
    case 'answer': {
      // 推送拉起的冷启动：WS 还没连上，store 里没有这通，先问服务端补上。
      if (!(await recoverRingingCall(event.callId))) {
        await native?.endCall(event.callId, 'ended');
        return;
      }
      await answerIncomingCall(event.callId);
      return;
    }
    case 'decline':
      await declineIncomingCall(event.callId, {
        declinedByNative: event.declinedByNative,
      });
      return;
    case 'hangup':
      if (useCallStore.getState().activeCall?.id === event.callId) {
        await leaveActiveCall();
      }
      return;
    case 'end':
      useCallStore
        .getState()
        .dismissIncomingCall(event.callId, dismissReasonFromNative(event.reason));
      return;
  }
}

function createEventDrainer(native: CallPushNativeModule) {
  let draining = false;
  let pending = false;
  return async function drain(): Promise<void> {
    // 登录态没就绪时事件留在原生队列里：接听要带会话去 accept。
    if (!isReady()) return;
    if (draining) {
      pending = true;
      return;
    }
    draining = true;
    try {
      do {
        pending = false;
        const events = await native.consumeEvents();
        for (const raw of events) {
          const event = parseCallPushEvent(raw);
          if (!event) continue;
          try {
            await handleNativeEvent(event);
          } catch (error) {
            reportHandledFailure('call', 'nativeEvent', error);
          }
        }
      } while (pending);
    } catch (error) {
      reportHandledFailure('call', 'nativeEventDrain', error);
    } finally {
      draining = false;
    }
  };
}

/**
 * 把 store 里的来电状态同步给原生层：
 * - iOS：每一通来电都交给 CallKit 响铃（同一个 UUID 重复上报是幂等的），应用内不再弹窗；
 * - 安卓：App 在后台时才交给原生层发全屏来电通知（前台有应用内弹窗）；
 * - 这通不再响 / 结束了：收掉原生振铃或系统通话界面，带上结束原因。
 */
function mirrorStoreToNative(native: CallPushNativeModule): () => void {
  const showNatively = (invite: CallInvitePayload) => {
    if (nativeRinging.has(invite.callId)) return;
    nativeRinging.add(invite.callId);
    void native.showIncomingCall(nativeCall(invite)).catch((error) => {
      nativeRinging.delete(invite.callId);
      reportHandledFailure('call', 'nativeShowIncoming', error);
    });
  };
  const endNatively = (callId: string, reason: Parameters<CallPushNativeModule['endCall']>[1]) => {
    nativeRinging.delete(callId);
    void native.endCall(callId, reason).catch((error) => {
      reportHandledFailure('call', 'nativeEndCall', error);
    });
  };

  let previous = useCallStore.getState();
  const unsubscribe = useCallStore.subscribe((state) => {
    const before = previous;
    previous = state;
    const ringing = state.incomingCall;
    const wasRinging = before.incomingCall;
    const live = state.activeCall?.id ?? ringing?.callId ?? null;
    const wasLive = before.activeCall?.id ?? wasRinging?.callId ?? null;

    if (ringing && ringing.callId !== wasRinging?.callId) {
      if (Platform.OS === 'ios' || AppState.currentState !== 'active') {
        showNatively(ringing);
      }
    }
    if (wasLive && wasLive !== live) {
      const reason =
        state.lastDismissal?.callId === wasLive ? state.lastDismissal.reason : 'ended';
      endNatively(wasLive, reason);
    } else if (wasRinging && !ringing && wasRinging.callId === live) {
      // 在应用内接通了：停掉还在响的原生振铃，通话继续。
      endNatively(wasRinging.callId, 'answered');
    }
  });

  // 安卓：响铃中切到后台，应用内弹窗看不见了，交给原生层继续响。
  const appState = AppState.addEventListener('change', (next) => {
    const ringing = useCallStore.getState().incomingCall;
    if (Platform.OS === 'android' && next !== 'active' && ringing) {
      showNatively(ringing);
    }
  });

  return () => {
    unsubscribe();
    appState.remove();
  };
}

/** 推送来电的 JS 侧：原生事件 → store / 接口；store → 原生振铃。挂在全局的 CallInviteHost 里。 */
export function useCallPushBridge(): void {
  const ready = useAuthStore((state) => state.isAuthenticated && !state.isLoading);

  useEffect(() => {
    const native = getCallPushModule();
    if (!native) return;
    void native.configure(API_URL).catch((error) => {
      reportHandledFailure('call', 'nativeConfigure', error);
    });
    return mirrorStoreToNative(native);
  }, []);

  useEffect(() => {
    const native = getCallPushModule();
    if (!native || !ready) return;
    const drain = createEventDrainer(native);
    const subscription = native.addListener('onCallEventsAvailable', () => {
      void drain();
    });
    // 监听挂上之前原生层就排了事件（推送冷启动、锁屏接听拉起）。
    void drain();
    return () => subscription.remove();
  }, [ready]);
}
