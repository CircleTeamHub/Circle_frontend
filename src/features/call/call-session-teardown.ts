import { cancelCall, leaveCall } from '@/services/api/calls';
import { registerLogoutHandler } from '@/services/auth/session';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/features/call/store/use-call-store';
import type { CallSession } from '@/features/call/types';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * 登出时清空通话状态，避免账号 A 的来电弹窗 / 活动通话残留进账号 B 的会话。
 *
 * 作为副作用模块，由全局挂载的 CallInviteHost 以副作用 import 触发一次注册。
 * 放在 store 之外，避免 store 顶层依赖 auth/session（会拖累 store 的纯逻辑单测）。
 */
function clearCallStateOnLogout(): void {
  useCallStore.getState().resetCallState();
}

registerLogoutHandler(clearCallStateOnLogout);

// 一通电话只通知一次后端。挂断按钮跑完会清空 activeCall、随即卸载通话界面，
// 卸载副作用会再调一次 leaveActiveCall；返回手势也可能在请求还在飞时撞进来。
let pendingExitCallId: string | null = null;

async function notifyCallExit(call: CallSession): Promise<void> {
  const selfId = useAuthStore.getState().user?.id;

  try {
    if (call.status === 'RINGING' && call.initiator.id === selfId) {
      await cancelCall(call.id);
    } else {
      await leaveCall(call.id);
    }
  } catch (error) {
    // 通知失败不能挡住本地退出，否则用户会卡在一个 LiveKit 已经断开的通话界面上。
    reportHandledFailure('call', 'leaveNotify', error);
  }
}

/**
 * 退出当前通话的唯一出口：通知后端 + 清空本地通话状态，幂等。
 *
 * 所有离开路径（挂断按钮、返回手势、通话界面卸载）都必须走这里 —— 只断开 LiveKit
 * 而不通知后端，会把自己永久留在后端成员列表里显示为 JOINED（幽灵成员）。
 *
 * store 里没有 activeCall 时直接返回：要么本次退出已经跑完，要么通话已被对端结束
 * （handleCallEnded 清空的），这两种情况都不该再补发一条 leave。
 */
export async function leaveActiveCall(): Promise<void> {
  const call = useCallStore.getState().activeCall;

  if (!call || pendingExitCallId === call.id) {
    return;
  }

  pendingExitCallId = call.id;

  try {
    await notifyCallExit(call);
  } finally {
    if (pendingExitCallId === call.id) {
      pendingExitCallId = null;
    }
    // 只清「我们正在退出的这一通」：leave 请求飞在路上时可能已经来了新的来电，
    // 无条件 reset 会把它连同弹窗一起悄悄吞掉。
    if (useCallStore.getState().activeCall?.id === call.id) {
      useCallStore.getState().resetCallState();
    }
  }
}
