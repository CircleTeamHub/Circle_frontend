/**
 * use-device-verification.ts — 陌生设备登录验证（新设备这一侧）
 *
 * 登录时服务端判定「陌生设备」后只给验证单号，不发 token。本 hook：
 * - 每 3 秒轮询验证单状态（受信任设备点了同意 / 拒绝，这边立刻跟上）；
 * - 每秒刷新倒计时（决定窗口 5 分钟，批准后验证码 60 秒）；
 * - 提交验证码 / 登录安全码，成功后交给 useAuth 走与密码登录相同的收尾；
 * - 过期后重新发起（服务端沿用原设备信息，计入频率限制）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLoginChallengeStatus,
  resendLoginChallenge,
  verifyLoginChallengeCode,
  verifyLoginChallengeSecurityCode,
  type AuthTokens,
  type LoginChallengeStatus,
} from '@/services/api/auth';
import { ApiError } from '@/services/api/api-error';

const POLL_INTERVAL_MS = 3_000;
const TICK_MS = 1_000;

export type DeviceVerificationPhase =
  | 'waiting'
  | 'approved'
  | 'codeExpired'
  | 'rejected'
  | 'expired';

type Params = {
  challengeId: string;
  expiresAt: string;
  onVerified: (tokens: AuthTokens) => Promise<void>;
};

// 这些错误码说明这张验证单已经用不了，界面要切到对应终态。
const TERMINAL_ERROR_PHASE: Record<string, DeviceVerificationPhase> = {
  AUTH_LOGIN_CHALLENGE_REJECTED: 'rejected',
  AUTH_LOGIN_CHALLENGE_EXPIRED: 'expired',
  AUTH_LOGIN_CHALLENGE_LOCKED: 'expired',
  AUTH_LOGIN_CHALLENGE_INVALID: 'expired',
};

function toPhase(
  status: LoginChallengeStatus,
  codeExpiresAt: number | null,
  now: number,
): DeviceVerificationPhase {
  if (status === 'REJECTED') return 'rejected';
  if (status === 'EXPIRED' || status === 'CONSUMED') return 'expired';
  if (status === 'APPROVED') {
    return codeExpiresAt !== null && codeExpiresAt > now
      ? 'approved'
      : 'codeExpired';
  }
  return 'waiting';
}

export function useDeviceVerification({
  challengeId: initialChallengeId,
  expiresAt: initialExpiresAt,
  onVerified,
}: Params) {
  const [challengeId, setChallengeId] = useState(initialChallengeId);
  const [expiresAt, setExpiresAt] = useState(() => Date.parse(initialExpiresAt));
  const [status, setStatus] = useState<LoginChallengeStatus>('PENDING');
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [terminalPhase, setTerminalPhase] =
    useState<DeviceVerificationPhase | null>(null);
  const verifiedTokensRef = useRef<AuthTokens | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      verifiedTokensRef.current = null;
    };
  }, []);

  const phase: DeviceVerificationPhase =
    completionPending ? 'approved' : terminalPhase ??
    (expiresAt <= now && status === 'PENDING'
      ? 'expired'
      : toPhase(status, codeExpiresAt, now));
  const isTerminal = phase === 'rejected' || phase === 'expired';

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isTerminal || completionPending) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await fetchLoginChallengeStatus(challengeId);
        if (cancelled) return;
        setStatus(next.status);
        setExpiresAt(Date.parse(next.expiresAt));
        setCodeExpiresAt(
          next.codeExpiresAt ? Date.parse(next.codeExpiresAt) : null,
        );
      } catch (pollError) {
        // 轮询只是加速；网络抖动不打扰用户，验证单失效类错误才切终态。
        const code = pollError instanceof ApiError ? pollError.errorCode : undefined;
        if (!cancelled && code && TERMINAL_ERROR_PHASE[code]) {
          setTerminalPhase(TERMINAL_ERROR_PHASE[code]);
        }
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [challengeId, isTerminal, completionPending]);

  const run = useCallback(
    async (request: () => Promise<AuthTokens>) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        const tokens = verifiedTokensRef.current ?? await request();
        verifiedTokensRef.current = tokens;
        if (!mountedRef.current) return;
        setCompletionPending(true);
        await onVerified(tokens);
      } catch (submitError) {
        if (!mountedRef.current) return;
        setError(submitError);
        const code =
          submitError instanceof ApiError ? submitError.errorCode : undefined;
        if (!verifiedTokensRef.current && code && TERMINAL_ERROR_PHASE[code]) {
          setTerminalPhase(TERMINAL_ERROR_PHASE[code]);
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [onVerified],
  );

  const submitCode = useCallback(
    (code: string) =>
      run(() => verifyLoginChallengeCode(challengeId, code.trim())),
    [challengeId, run],
  );

  const submitSecurityCode = useCallback(
    (securityCode: string) =>
      run(() =>
        verifyLoginChallengeSecurityCode(challengeId, securityCode.trim()),
      ),
    [challengeId, run],
  );

  const resend = useCallback(async () => {
    if (inFlightRef.current || verifiedTokensRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const next = await resendLoginChallenge(challengeId);
      if (!mountedRef.current) return;
      setChallengeId(next.id);
      setExpiresAt(Date.parse(next.expiresAt));
      setStatus('PENDING');
      setCodeExpiresAt(null);
      setTerminalPhase(null);
    } catch (resendError) {
      if (mountedRef.current) setError(resendError);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [challengeId]);

  const remainingMs =
    phase === 'approved' && codeExpiresAt !== null
      ? codeExpiresAt - now
      : expiresAt - now;

  return {
    phase,
    remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
    submitting,
    error,
    submitCode,
    completionPending,
    submitSecurityCode,
    resend,
  };
}
