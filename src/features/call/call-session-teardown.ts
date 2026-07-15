import { registerLogoutHandler } from '@/services/auth/session';
import { useCallStore } from '@/features/call/store/use-call-store';

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
