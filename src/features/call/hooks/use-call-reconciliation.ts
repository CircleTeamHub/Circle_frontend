import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { fetchCurrentCall } from '@/services/api/calls';
import { useCallStore } from '@/features/call/store/use-call-store';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * 重连对账（#93，配合 circle_be 的 GET /calls/current）。
 *
 * 断线期间 call.ended / call.canceled 事件可能整段丢失：本地还挂着振铃弹窗或
 * 通话态，服务端那通电话早结束了。回前台时（现成的「网络多半恢复了」信号，
 * 与 SessionBootstrap 的补登同哲学）：
 * - 本地有 activeCall / 来电邀请，而服务端说没有 → 清掉本地残留；
 * - 服务端还在同一通里 → 什么都不动（LiveKit 自己会重连媒体）。
 * 「服务端有、本地没有」的方向不自动闯入通话 —— 那是用户已挂断后的重装/
 * 冷启场景，静默入会比残留弹窗更吓人。
 *
 * 查询失败（网络仍差）静默放过，下次回前台再试；不做轮询。
 */
export function useCallReconciliation(): void {
  const inFlightRef = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || inFlightRef.current) {
        return;
      }
      const { activeCall, incomingCall, resetCallState } =
        useCallStore.getState();
      if (!activeCall && !incomingCall) {
        return;
      }

      inFlightRef.current = true;
      void fetchCurrentCall()
        .then((current) => {
          const state = useCallStore.getState();
          const localCallId =
            state.activeCall?.id ?? state.incomingCall?.callId ?? null;
          if (!localCallId) {
            return;
          }
          if (!current || current.call.id !== localCallId) {
            if (isDev) {
              console.warn(
                `[call] reconciliation: local call ${localCallId} is gone server-side; resetting`,
              );
            }
            resetCallState();
          }
        })
        .catch((error) => {
          if (isDev) {
            console.warn('[call] reconciliation fetch failed', error);
          }
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    });

    return () => subscription.remove();
  }, []);
}
