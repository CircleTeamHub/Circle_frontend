/**
 * login-approval-store.ts — 受信任设备上「陌生设备登录请求」的待处理队列
 *
 * 来源三路：实时事件 auth.login.challenge.created、App 回到前台、登录后首拉；
 * 推送丢了也能在下次打开 App 时补上。某台设备处理掉（resolved）就出队，
 * 其他设备上的弹窗随之收起。
 */
import { create } from 'zustand';
import {
  fetchPendingLoginChallenges,
  type PendingLoginChallenge,
} from '@/services/api/auth';
import { reportHandledFailure } from '@/observability/report-failure';
import { setLoginChallengeListener } from '@/realtime/client';

type LoginApprovalState = {
  pending: PendingLoginChallenge[];
  /** 应用锁（登录安全码）未解开时不弹，免得拿到手机的人直接点同意。 */
  appLocked: boolean;
  /** 新设备已用验证码登录成功的请求：本机还亮着验证码的话可以收起了。 */
  consumedId: string | null;
  /**
   * 本机或别的设备已经处理过的请求。晚到的列表响应（发起于处理之前）会把它们
   * 带回来，按这里过滤掉，免得同一请求再问一遍。
   */
  handledIds: string[];
  handledRecoveryAt: Record<string,string | null>;
  refresh: () => Promise<void>;
  remove: (challengeId: string) => void;
  markResolved: (
    challengeId: string,
    status: 'APPROVED' | 'REJECTED' | 'CONSUMED',
  ) => void;
  setAppLocked: (locked: boolean) => void;
  reset: () => void;
};

let inFlight: Promise<void> | null = null;
let refreshQueued = false;
// 每次 reset（登出 / 切换账号）递增。旧账号发出的请求晚到时按代次丢弃，也不会被
// 新账号的 refresh 复用——否则上一个账号的登录请求会出现在新账号的弹窗里。
let generation = 0;

export const useLoginApprovalStore = create<LoginApprovalState>((set) => ({
  pending: [],
  // 默认视为已上锁：冷启动时应用锁状态还没拉回来，不能先把「是我」按钮亮出来。
  // 由 LoginSecurityCodeGate 在拿到状态后解开。
  appLocked: true,
  consumedId: null,
  handledIds: [],
  handledRecoveryAt: {},
  refresh: () => {
    if (inFlight) {
      refreshQueued = true;
      return inFlight;
    }
    const requestGeneration = generation;
    const request = (async () => {
      do {
        refreshQueued = false;
        try {
          const pending = await fetchPendingLoginChallenges();
          if (requestGeneration !== generation) return;
          set((state) => ({
            pending: (Array.isArray(pending) ? pending : []).filter(
              (item) => !state.handledIds.includes(item.id) || Boolean(item.recoveryAvailableAt && item.recoveryAvailableAt !== state.handledRecoveryAt[item.id]),
            ),
          }));
        } catch (error) {
          if (requestGeneration !== generation) return;
          reportHandledFailure('loginApproval', 'fetchPending', error);
        }
      } while (refreshQueued && requestGeneration === generation);
    })().finally(() => {
      if (inFlight === request) inFlight = null;
    });
    inFlight = request;
    return request;
  },
  remove: (challengeId) =>
    set((state) => ({
      pending: state.pending.filter((item) => item.id !== challengeId),
      handledIds: [...state.handledIds, challengeId].slice(-50),
      handledRecoveryAt: Object.fromEntries([...state.handledIds, challengeId].slice(-50).map(id => [id, id === challengeId ? state.pending.find(item=>item.id===id)?.recoveryAvailableAt ?? null : state.handledRecoveryAt[id] ?? null])),
    })),
  markResolved: (challengeId, status) =>
    set((state) => ({
      pending: state.pending.filter((item) => item.id !== challengeId),
      handledIds: [...state.handledIds, challengeId].slice(-50),
      handledRecoveryAt: Object.fromEntries([...state.handledIds, challengeId].slice(-50).map(id => [id, id === challengeId ? state.pending.find(item=>item.id===id)?.recoveryAvailableAt ?? null : state.handledRecoveryAt[id] ?? null])),
      consumedId: status === 'CONSUMED' ? challengeId : state.consumedId,
    })),
  setAppLocked: (appLocked) => set({ appLocked }),
  reset: () => {
    generation += 1;
    inFlight = null;
    refreshQueued = false;
    set({ pending: [], consumedId: null, handledIds: [], handledRecoveryAt: {} });
  },
}));

setLoginChallengeListener((event) => {
  const store = useLoginApprovalStore.getState();
  if (event.type === 'created') void store.refresh();
  else store.markResolved(event.challengeId, event.status);
});
