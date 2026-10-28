import { Alert } from 'react-native';
import { router } from 'expo-router';
import i18n from '@/i18n';
import { acceptCall, fetchCurrentCall, rejectCall } from '@/services/api/calls';
import { getApiErrorMessage } from '@/services/api/errors';
import { useCallStore } from '@/features/call/store/use-call-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { dismissReasonFromNative, inviteFromCurrentCall } from './call-push-events';

/**
 * 来电的接听 / 拒接 / 恢复，应用内弹窗与原生来电界面（CallKit、全屏通知）共用一条路径。
 */

/**
 * - ringing：store 里有它（本来就有，或刚补上）；
 * - gone：确定不再为我响了（服务端说我已不在邀请里 / 本机刚结束过它）—— 原生振铃该收；
 * - unknown：没问到（网络差）—— 别动原生振铃，交给到期计时与后续对账。
 */
export type RecoverResult = 'ringing' | 'gone' | 'unknown';

/**
 * 原生层已经在为某通电话响铃（推送来的），但 store 里还没有它 —— App 被推送 / 接听拉起时
 * WS 还没连上，或邀请走 WS 时 App 不在线。问服务端要一份当前通话，补进 store。
 */
export async function recoverRingingCall(callId?: string): Promise<RecoverResult> {
  const state = useCallStore.getState();
  if (state.incomingCall && (!callId || state.incomingCall.callId === callId)) {
    return 'ringing';
  }
  if (callId && state.recentlyEndedCallIds.includes(callId)) return 'gone';
  try {
    const invite = inviteFromCurrentCall(await fetchCurrentCall());
    if (!invite || (callId && invite.callId !== callId)) return 'gone';
    useCallStore.getState().handleCallInvite(invite);
    return useCallStore.getState().incomingCall?.callId === invite.callId
      ? 'ringing'
      : 'gone';
  } catch (error) {
    reportHandledFailure('call', 'recoverRinging', error);
    return 'unknown';
  }
}

/** 接听：accept 拿 LiveKit 凭据，进通话页。失败时收掉这通并提示。返回是否进了通话。 */
export async function answerIncomingCall(callId: string): Promise<boolean> {
  const store = useCallStore.getState();
  store.setAnsweringCallId(callId);
  try {
    const response = await acceptCall(callId);
    useCallStore.getState().setActiveCall(response.call, response.livekit);
    router.push('/(chat)/group-call' as never);
    return true;
  } catch (error) {
    useCallStore.getState().dismissIncomingCall(callId, 'failed');
    Alert.alert(
      i18n.t('common.errorOccurred'),
      getApiErrorMessage(error, i18n.t('common.errorOccurred')),
    );
    reportHandledFailure('call', 'accept', error);
    return false;
  } finally {
    if (useCallStore.getState().answeringCallId === callId) {
      useCallStore.getState().setAnsweringCallId(null);
    }
  }
}

/**
 * 拒接。原生层已凭推送里的单通令牌告诉过服务端时（锁屏拒接）只收本地状态；
 * 否则由这里调 reject。失败不重试：服务端到点会按未接收尾。
 */
export async function declineIncomingCall(
  callId: string,
  options: { declinedByNative?: boolean } = {},
): Promise<void> {
  useCallStore.getState().dismissIncomingCall(callId, 'ended');
  if (options.declinedByNative) return;
  try {
    await rejectCall(callId);
  } catch (error) {
    reportHandledFailure('call', 'reject', error);
  }
}

/**
 * 中国区通知模式（iOS 没有 CallKit）：来电与撤销都是极光送来的普通通知。App 活着时
 * 收到 / 用户点开时把它接进 store —— 邀请补成应用内来电弹窗，撤销收掉弹窗。
 * 是来电类通知返回 true（调用方不再按普通推送路由）。
 */
export function handleCallNotification(data: Record<string, unknown>): boolean {
  const callId = typeof data.callId === 'string' ? data.callId : '';
  if (data.type === 'call.invite' && callId) {
    void recoverRingingCall(callId);
    return true;
  }
  if (data.type === 'call.dismiss' && callId) {
    useCallStore
      .getState()
      .dismissIncomingCall(
        callId,
        dismissReasonFromNative(typeof data.reason === 'string' ? data.reason : 'ended'),
      );
    return true;
  }
  return false;
}
