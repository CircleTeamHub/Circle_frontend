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
import { getCallPushModule, nativeOwnsIncomingCallUi } from './call-push-native';
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

/** 收掉原生振铃 / 系统通话界面的唯一出口：顺带把它从 nativeRinging 里拿掉。 */
async function endNativeCall(
  callId: string,
  reason: Parameters<CallPushNativeModule['endCall']>[1],
): Promise<void> {
  nativeRinging.delete(callId);
  try {
    await getCallPushModule()?.endCall(callId, reason);
  } catch (error) {
    reportHandledFailure('call', 'nativeEndCall', error);
  }
}

function nativeCall(invite: CallInvitePayload) {
  return {
    callId: invite.callId,
    callerName: invite.initiator.nickname,
    hasVideo: invite.callType === 'VIDEO',
    isGroup: invite.sessionType === 'group',
    expiresAt: invite.expiresAt,
  };
}

/** 登录态恢复完了（不论有没有登录）：在此之前原生事件留在队列里。 */
function sessionSettled(): boolean {
  return !useAuthStore.getState().isLoading;
}

/**
 * 没登录（登出时 token 撤销还在排队、会话被远程撤销……）却收到了来电：接不了，收掉原生
 * 振铃 / 系统通话界面，别让 CallKit 一直挂在「已接通」。
 */
async function handleWhileSignedOut(event: CallPushNativeEvent): Promise<void> {
  if (event.type === 'voipToken') return;
  await endNativeCall(event.callId, 'failed');
}

async function handleNativeEvent(event: CallPushNativeEvent): Promise<void> {
  if (!useAuthStore.getState().isAuthenticated) {
    await handleWhileSignedOut(event);
    return;
  }
  switch (event.type) {
    case 'voipToken':
      notifyVoipTokenChanged();
      return;
    case 'incoming': {
      // 安卓 App 在前台时原生层不弹通知（shown=false），之后切后台要由 JS 补发。
      if (event.shown) nativeRinging.add(event.callId);
      // 原生层在响、服务端却说这通早不找我了（冷启动期间主叫取消 / 别处已接）：WS 不会重放
      // 那些事件，看门狗也只盯 store 里的来电 —— 这里不收，CallKit 会白响到超时。
      if ((await recoverRingingCall(event.callId)) === 'gone') {
        await endNativeCall(event.callId, 'ended');
      }
      return;
    }
    case 'unavailable':
      // 系统来电界面没接下（iOS 勿扰过滤等）：应用内弹窗兜底。
      useCallStore.getState().setNativeUiFallback(event.callId);
      return;
    case 'answer': {
      // 推送拉起的冷启动：WS 还没连上，store 里没有这通，先问服务端补上。确定早已结束就
      // 收掉；问不到（网络差）也照样试着接 —— accept 本身会给出结论。
      if ((await recoverRingingCall(event.callId)) === 'gone') {
        await endNativeCall(event.callId, 'ended');
        return;
      }
      if (!(await answerIncomingCall(event.callId))) {
        // store 里没有这通时 store → 原生的同步不会触发：直接收掉系统通话界面。
        await endNativeCall(event.callId, 'failed');
      }
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
    case 'end': {
      const reason = dismissReasonFromNative(event.reason);
      useCallStore.getState().dismissIncomingCall(event.callId, reason);
      // store 里没有这通时上面什么都不做：仍要让原生层收尾（安卓放开锁屏显示等），幂等。
      await endNativeCall(event.callId, reason);
      return;
    }
  }
}

function createEventDrainer(native: CallPushNativeModule) {
  let draining = false;
  let pending = false;
  return async function drain(): Promise<void> {
    // 登录态还在恢复时事件留在原生队列里：接听要带会话去 accept。
    if (!sessionSettled()) return;
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
 * - iOS（CallKit 模式）：每一通来电都交给 CallKit 响铃（同一个 UUID 重复上报是幂等的），
 *   应用内不再弹窗；
 * - 安卓：App 在后台时才交给原生层发全屏来电通知（前台有应用内弹窗）；中国区通知模式的
 *   iOS 原生层没有来电界面，showIncomingCall 是空操作；
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
    void endNativeCall(callId, reason);
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
      if (nativeOwnsIncomingCallUi() || AppState.currentState !== 'active') {
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
  const ready = useAuthStore((state) => !state.isLoading);

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
