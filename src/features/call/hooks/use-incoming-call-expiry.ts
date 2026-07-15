import { useEffect } from 'react';
import type { CallInvitePayload } from '../types';

/**
 * 来电自动过期安全网：到 payload.expiresAt 仍未接听 / 拒绝，则调用 onExpire 清除，
 * 避免丢失的 call.ended / call.canceled 推送（WS 抖动 / 重连放弃后停止）把全屏来电
 * 弹窗永久卡住。expiresAt 缺失 / 非法时不自动清，以免误关正常来电。
 */
export function useIncomingCallExpiry(
  incomingCall: CallInvitePayload | null,
  onExpire: () => void,
): void {
  useEffect(() => {
    if (!incomingCall) return;
    const expiresAtMs = Date.parse(incomingCall.expiresAt);
    if (Number.isNaN(expiresAtMs)) return;
    const delay = expiresAtMs - Date.now();
    if (delay <= 0) {
      onExpire();
      return;
    }
    const timer = setTimeout(onExpire, delay);
    return () => clearTimeout(timer);
  }, [incomingCall, onExpire]);
}
