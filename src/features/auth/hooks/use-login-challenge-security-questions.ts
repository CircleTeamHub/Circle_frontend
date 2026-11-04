import { useEffect, useState } from 'react';
import { fetchLoginChallengeSecurityQuestions } from '@/services/api/auth';
import type { SecurityQuestionKey } from '@/features/auth/security-questions';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * 验证页：这个账号设置的密保问题。没设置时隐藏入口；查询失败时提供重试，
 * 不影响受信任设备验证。
 */
export function useLoginChallengeSecurityQuestions(
  challengeId: string,
) {
  const [questionKeys, setQuestionKeys] = useState<SecurityQuestionKey[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setQuestionKeys([]);
    setFailed(false);
    fetchLoginChallengeSecurityQuestions(challengeId).then(
      (keys) => {
        if (!cancelled) setQuestionKeys(keys);
      },
      (error: unknown) => {
        if (cancelled) return;
        setFailed(true);
        reportHandledFailure('auth', 'loginChallengeSecurityQuestions', error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [challengeId, attempt]);

  return { questionKeys, failed, retry: () => setAttempt((current) => current + 1) };
}
