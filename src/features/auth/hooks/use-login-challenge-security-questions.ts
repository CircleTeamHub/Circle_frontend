import { useEffect, useState } from 'react';
import { fetchLoginChallengeSecurityQuestions } from '@/services/api/auth';
import type { SecurityQuestionKey } from '@/features/auth/security-questions';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * 验证页：这个账号设置的密保问题。没设置或拿不到时为空数组，入口随之隐藏 ——
 * 拿不到只是少一条兜底，受信任设备验证照常可用。
 */
export function useLoginChallengeSecurityQuestions(
  challengeId: string,
): SecurityQuestionKey[] {
  const [questionKeys, setQuestionKeys] = useState<SecurityQuestionKey[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLoginChallengeSecurityQuestions(challengeId).then(
      (keys) => {
        if (!cancelled) setQuestionKeys(keys);
      },
      (error: unknown) => {
        reportHandledFailure('auth', 'loginChallengeSecurityQuestions', error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [challengeId]);

  return questionKeys;
}
