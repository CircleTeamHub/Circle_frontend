/**
 * use-login-approval.ts — 受信任设备批准陌生设备登录
 *
 * 流程：弹「检测到陌生设备登录，是你本人吗？」→
 *   - 是我：向服务端换取 6 位验证码（60 秒有效）并展示，用户念给自己的新设备输入；
 *   - 不是我：作废这次登录，并建议立刻改密码（对方已经知道密码）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  approveLoginChallenge,
  rejectLoginChallenge,
  type PendingLoginChallenge,
} from '@/services/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { useLoginApprovalStore } from '@/features/security/store/login-approval-store';

export type LoginApprovalStage =
  | { kind: 'ask'; challenge: PendingLoginChallenge }
  | { kind: 'code'; challengeId: string; code: string; codeExpiresAt: number }
  | { kind: 'rejected' };

export function useLoginApproval() {
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const activeEpochRef = useRef(sessionEpoch);
  const mountedRef = useRef(true);
  const actionPending = useRef(false);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const onboardingRequired = useAuthStore((state) => state.onboardingRequired);
  const pending = useLoginApprovalStore((state) => state.pending);
  const appLocked = useLoginApprovalStore((state) => state.appLocked);
  const consumedId = useLoginApprovalStore((state) => state.consumedId);
  const [active, setActive] = useState<
    Exclude<LoginApprovalStage, { kind: 'ask' }> | null
  >(null);
  const [foreground, setForeground] = useState((AppState.currentState ?? 'active') === 'active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const enabled = isAuthenticated && !onboardingRequired;

  useEffect(() => {
    const store = useLoginApprovalStore.getState();
    if (activeEpochRef.current !== sessionEpoch) {
      activeEpochRef.current = sessionEpoch;
      store.reset();
      setActive(null); setBusy(false); setError(null); actionPending.current = false;
    }
    if (!enabled) {
      store.reset();
      setActive(null);
      return undefined;
    }
    void store.refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      setForeground(next === 'active');
      if (next === 'active') void useLoginApprovalStore.getState().refresh();
    });
    return () => subscription.remove();
  }, [enabled, sessionEpoch]);

  // 新设备已经用这枚码登录成功：验证码面板自动收起。
  useEffect(() => {
    if (active?.kind === 'code' && active.challengeId === consumedId) {
      setActive(null);
    }
  }, [active, consumedId]);

  useEffect(() => {
    if (active?.kind === 'code' && active.codeExpiresAt <= now && pending.some(item => item.id === active.challengeId && item.recoveryAvailableAt)) setActive(null);
  }, [active, now, pending]);

  // 有待问的请求或正在显示验证码时才走秒：过期的请求要能自己消失。
  const ticking = active?.kind === 'code' || pending.length > 0;
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [ticking]);

  const stage: LoginApprovalStage | null = useMemo(() => {
    if (!enabled || appLocked || !foreground || activeEpochRef.current !== sessionEpoch) return null;
    if (active) return active;
    const next = pending.find((item) => Date.parse(item.expiresAt) > now);
    return next ? { kind: 'ask', challenge: next } : null;
  }, [active, appLocked, enabled, foreground, now, pending, sessionEpoch]);

  const runApprove = useCallback(async (challengeId: string) => {
    if (actionPending.current) return;
    actionPending.current = true;
    const epoch = useAuthStore.getState().sessionEpoch;
    const current = () => mountedRef.current && useAuthStore.getState().sessionEpoch === epoch;
    setBusy(true);
    setError(null);
    try {
      const result = await approveLoginChallenge(challengeId);
      if (!current()) return;
      useLoginApprovalStore.getState().remove(challengeId);
      setNow(Date.now());
      setActive({
        kind: 'code',
        challengeId,
        code: result.code,
        codeExpiresAt: Date.parse(result.codeExpiresAt),
      });
    } catch (approveError) {
      if (!current()) return;
      setError(approveError);
      // 多半是已被别的设备处理 / 已过期：刷新队列，让弹窗跟着收起。
      void useLoginApprovalStore.getState().refresh();
    } finally {
      if (current()) { actionPending.current = false; setBusy(false); }
    }
  }, []);

  const approve = useCallback(() => {
    if (busy || stage?.kind !== 'ask') return;
    void runApprove(stage.challenge.id);
  }, [busy, runApprove, stage]);

  const regenerate = useCallback(() => {
    if (busy || stage?.kind !== 'code') return;
    void runApprove(stage.challengeId);
  }, [busy, runApprove, stage]);

  const reject = useCallback(async () => {
    if (busy || actionPending.current || stage?.kind !== 'ask') return;
    actionPending.current = true;
    const challengeId = stage.challenge.id;
    const epoch = useAuthStore.getState().sessionEpoch;
    const current = () => mountedRef.current && useAuthStore.getState().sessionEpoch === epoch;
    setBusy(true);
    setError(null);
    try {
      await rejectLoginChallenge(challengeId);
      if (!current()) return;
      useLoginApprovalStore.getState().remove(challengeId);
      setActive({ kind: 'rejected' });
    } catch (rejectError) {
      if (!current()) return;
      setError(rejectError);
      void useLoginApprovalStore.getState().refresh();
    } finally {
      if (current()) { actionPending.current = false; setBusy(false); }
    }
  }, [busy, stage]);

  const close = useCallback(() => {
    setActive(null);
    setError(null);
  }, []);

  const codeSecondsLeft =
    stage?.kind === 'code'
      ? Math.max(0, Math.ceil((stage.codeExpiresAt - now) / 1000))
      : 0;

  return {
    stage,
    busy,
    error,
    codeSecondsLeft,
    approve,
    reject,
    regenerate,
    close,
  };
}
