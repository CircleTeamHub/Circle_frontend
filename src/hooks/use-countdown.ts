import { useCallback, useEffect, useRef, useState } from 'react';

/** 纯函数：倒计时每秒递减，地板为 0。抽出来便于无 React 环境单测。 */
export function nextTick(seconds: number): number {
  return seconds > 0 ? seconds - 1 : 0;
}

export interface Countdown {
  seconds: number;
  running: boolean;
  start: (from: number) => void;
}

/** 倒计时 hook：start(n) 后每秒 -1 到 0；running 期间用于禁用「发送验证码」按钮。 */
export function useCountdown(): Countdown {
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(
    (from: number) => {
      clear();
      setSeconds(from);
      timerRef.current = setInterval(() => {
        setSeconds((prev) => {
          const next = nextTick(prev);
          if (next === 0 && timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return next;
        });
      }, 1000);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  return { seconds, running: seconds > 0, start };
}
