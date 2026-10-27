import { Alert } from 'react-native';
import { router } from 'expo-router';
import i18n from '@/i18n';
import { acceptCall, fetchCurrentCall, rejectCall } from '@/services/api/calls';
import { getApiErrorMessage } from '@/services/api/errors';
import { useCallStore } from '@/features/call/store/use-call-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { inviteFromCurrentCall } from './call-push-events';

/**
 * 来电的接听 / 拒接 / 恢复，应用内弹窗与原生来电界面（CallKit、全屏通知）共用一条路径。
 */

/**
 * 原生层已经在为某通电话响铃（推送来的），但 store 里还没有它 —— App 被推送 / 接听拉起时
 * WS 还没连上，或邀请走 WS 时 App 不在线。问服务端要一份当前通话，补进 store。
 * 返回是否补上了（或本来就有）。
 */
export async function recoverRingingCall(callId?: string): Promise<boolean> {
  const known = useCallStore.getState().incomingCall;
  if (known && (!callId || known.callId === callId)) return true;
  try {
    const invite = inviteFromCurrentCall(await fetchCurrentCall());
    if (!invite || (callId && invite.callId !== callId)) return false;
    useCallStore.getState().handleCallInvite(invite);
    return useCallStore.getState().incomingCall?.callId === invite.callId;
  } catch (error) {
    reportHandledFailure('call', 'recoverRinging', error);
    return false;
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
