/**
 * use-device-verification.ts — 陌生设备登录验证（新设备这一侧）
 *
 * 登录时服务端判定「陌生设备」后只给验证单号，不发 token。本 hook：
 * - 每 3 秒轮询验证单状态（受信任设备点了同意 / 拒绝，这边立刻跟上）；
 * - 每秒刷新倒计时（决定窗口 5 分钟，批准后验证码 60 秒）；
 * - 提交验证码 / 登录安全码，成功后交给 useAuth 走与密码登录相同的收尾；
 * - 过期后重新发起（服务端沿用原设备信息，计入频率限制）；
 * - 受信任设备全都用不了时申请找回：等待期内不再频繁轮询，等待期过了回登录页用密码
 *   重新登录即完成（服务端在那次登录里领取找回）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchLoginChallengeStatus,
  requestLoginRecovery,
  resendLoginChallenge,
  verifyLoginChallengeCode,
  verifyLoginChallengeSecurityCode,
  type AuthTokens,
  type LoginChallengeStatus,
} from '@/services/api/auth';
import { ApiError } from '@/services/api/api-error';

const POLL_INTERVAL_MS = 3_000;
// 找回等待期按小时计：只需要偶尔确认有没有被受信任设备拒绝 / 批准。
const RECOVERY_POLL_INTERVAL_MS = 30_000;
const TICK_MS = 1_000;

export type DeviceVerificationPhase =
  | 'waiting'
  | 'approved'
  | 'codeExpired'
  | 'rejected'
  | 'expired'
  /** 已申请找回，等待期还没过。 */
  | 'recoveryWaiting'
  /** 等待期已过：回登录页用密码重新登录即可。 */
  | 'recoveryReady';

type Params = {
  challengeId: string;
  expiresAt: string;
  recoveryAvailableAt?: string | null;
  onVerified: (tokens: AuthTokens) => Promise<void>;
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

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
  recoveryAvailableAt: initialRecoveryAvailableAt,
  onVerified,
}: Params) {
  const [challengeId, setChallengeId] = useState(initialChallengeId);
  const [recoveryAt, setRecoveryAt] = useState<number | null>(() =>
    parseTime(initialRecoveryAvailableAt),
  );
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

  const basePhase: DeviceVerificationPhase =
    completionPending ? 'approved' : terminalPhase ??
    (expiresAt <= now && status === 'PENDING'
      ? 'expired'
      : toPhase(status, codeExpiresAt, now));
  // 找回申请中：受信任设备真的批准了（有码可输）就按正常流程走，否则显示等待 / 就绪。
  const phase: DeviceVerificationPhase =
    recoveryAt !== null && (basePhase === 'waiting' || basePhase === 'codeExpired')
      ? recoveryAt > now
        ? 'recoveryWaiting'
        : 'recoveryReady'
      : basePhase;
  const isTerminal = phase === 'rejected' || phase === 'expired';
  const inRecovery = recoveryAt !== null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isTerminal || completionPending) return undefined;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling || cancelled) return;
      polling = true;
      try {
        const next = await fetchLoginChallengeStatus(challengeId);
        if (cancelled) return;
        setStatus(next.status);
        setExpiresAt(Date.parse(next.expiresAt));
        setCodeExpiresAt(
          next.codeExpiresAt ? Date.parse(next.codeExpiresAt) : null,
        );
        if (next.recoveryAvailableAt !== undefined) {
          setRecoveryAt(parseTime(next.recoveryAvailableAt));
        }
      } catch (pollError) {
        // 轮询只是加速；网络抖动不打扰用户，验证单失效类错误才切终态。
        const code = pollError instanceof ApiError ? pollError.errorCode : undefined;
        if (!cancelled && code && TERMINAL_ERROR_PHASE[code]) {
          setTerminalPhase(TERMINAL_ERROR_PHASE[code]);
        }
      } finally { polling = false; }
    };
    void poll();
    const timer = setInterval(
      poll,
      inRecovery ? RECOVERY_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [challengeId, isTerminal, completionPending, inRecovery]);

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

  /** 受信任设备全都用不了：申请等待期后在这台设备上自动登录。 */
  const requestRecovery = useCallback(async () => {
    if (inFlightRef.current || verifiedTokensRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const next = await requestLoginRecovery(challengeId);
      if (!mountedRef.current) return;
      setExpiresAt(Date.parse(next.expiresAt));
      setRecoveryAt(parseTime(next.recoveryAvailableAt));
    } catch (recoveryError) {
      if (!mountedRef.current) return;
      setError(recoveryError);
      const code =
        recoveryError instanceof ApiError ? recoveryError.errorCode : undefined;
      if (code && TERMINAL_ERROR_PHASE[code]) {
        setTerminalPhase(TERMINAL_ERROR_PHASE[code]);
      }
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [challengeId]);

  const remainingMs =
    phase === 'approved' && codeExpiresAt !== null
      ? codeExpiresAt - now
      : phase === 'recoveryWaiting' && recoveryAt !== null
        ? recoveryAt - now
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
    requestRecovery,
    /** 找回可完成的时间（毫秒时间戳）；没申请为 null。 */
    recoveryAvailableAt: recoveryAt,
  };
}
