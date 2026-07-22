/**
 * use-send-email-code.ts — 「发送邮箱验证码」业务 Hook
 *
 * 抽出 LoginScreen / RegisterScreen 里逐字重复的发码逻辑，并补上原实现缺失的
 * **在途防抖**：
 *
 *   旧实现按钮只有 `disabled={countdown.running}`，而 countdown 在
 *   `await requestEmailCode()` 成功之后才启动。也就是说在网络请求飞行的这段时间里
 *   按钮仍可点 —— 慢网下用户连点会真发出 2+ 封验证码 / 撞后端限流，第二封还可能
 *   失败覆盖掉已成功的 UI（倒计时已走 + 又冒一条错误）。
 *
 * 这里用 inFlightRef + sending 双重把关，确保同一时刻只有一次发码请求在途。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestEmailCode, requestPasswordReset } from '@/services/api/auth';
import { getApiErrorMessage } from '@/services/api/errors';
import { useCountdown } from '@/hooks/use-countdown';
import { normalizeEmail } from '@/utils/email';
import { validateEmail } from '@/features/auth/validation';
import i18n from '@/i18n';

// 'reset-password' 走独立端点（FE#92），其余两个走通用 email/request-code。
type Purpose = 'login' | 'register' | 'reset-password';

const RESEND_SECONDS = 60;

export interface SendEmailCode {
  /** 触发发码；内部自带在途/倒计时双重防抖，重复调用安全。 */
  send: (email: string) => Promise<void>;
  /** 请求在途中（用于按钮 loading / 禁用）。 */
  sending: boolean;
  /** 倒计时剩余秒数（>0 时禁止重发）。 */
  seconds: number;
  /** 倒计时进行中。 */
  running: boolean;
  /** 可直接展示给用户的错误文案；成功时为 null。 */
  error: string | null;
}

export function useSendEmailCode(purpose: Purpose): SendEmailCode {
  const countdown = useCountdown();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 在途守卫：disabled 在 fast double-tap 下可能晚一帧，ref 在入口处即时拦截。
  const inFlightRef = useRef(false);

  // 用户在请求飞行途中离开屏幕时，避免对已卸载组件 setState。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const send = useCallback(
    async (email: string) => {
      // 倒计时中或已有请求在途：直接忽略，绝不重复发信。
      if (inFlightRef.current || countdown.running) return;

      setError(null);
      const invalid = validateEmail(email);
      if (invalid) {
        setError(i18n.t(invalid));
        return;
      }
      const normalized = normalizeEmail(email);

      inFlightRef.current = true;
      setSending(true);
      try {
        if (purpose === 'reset-password') {
          await requestPasswordReset(normalized);
        } else {
          await requestEmailCode({ email: normalized, purpose });
        }
        if (mountedRef.current) countdown.start(RESEND_SECONDS);
      } catch (e) {
        if (mountedRef.current) {
          setError(getApiErrorMessage(e, i18n.t('auth.errors.sendCodeFailed')));
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setSending(false);
      }
    },
    [purpose, countdown],
  );

  return {
    send,
    sending,
    seconds: countdown.seconds,
    running: countdown.running,
    error,
  };
}
