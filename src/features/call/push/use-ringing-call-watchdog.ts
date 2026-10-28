import { useEffect } from 'react';
import { AppState } from 'react-native';
import { fetchCurrentCall } from '@/services/api/calls';
import { useCallStore } from '@/features/call/store/use-call-store';
import { reportHandledFailure } from '@/observability/report-failure';
import { inviteFromCurrentCall } from './call-push-events';
import { supportsCallPush } from './call-push-native';

const POLL_INTERVAL_MS = 5_000;
/** 振铃最长 45 秒：9 次覆盖一整个窗口，之后交给本地到期计时。 */
const MAX_POLLS = 9;

/**
 * App 不在前台、原生层却在响铃时（CallKit / 全屏通知）的兜底对账。
 *
 * 撤销信令主要靠 WS（call.canceled / call.ended / 本人在别处接听）。被 VoIP 推送冷启动时
 * WS 可能还没连上、或网络很差连不上 —— 每 5 秒问一次服务端「我还被邀请着吗」，
 * 不在了就收掉振铃。前台有 WS 与 use-call-reconciliation，不必轮询。
 */
export function useRingingCallWatchdog(): void {
  const ringingCallId = useCallStore((state) => state.incomingCall?.callId ?? null);

  useEffect(() => {
    if (!ringingCallId || !supportsCallPush()) return;
    let polls = 0;
    let inFlight = false;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active' || inFlight) return;
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      inFlight = true;
      void fetchCurrentCall()
        .then((current) => {
          if (inviteFromCurrentCall(current)?.callId !== ringingCallId) {
            useCallStore.getState().dismissIncomingCall(ringingCallId, 'ended');
          }
        })
        .catch((error) => reportHandledFailure('call', 'ringingWatchdog', error))
        .finally(() => {
          inFlight = false;
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ringingCallId]);
}
