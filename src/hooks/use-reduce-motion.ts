import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * 系统「减弱动态效果」偏好。
 *
 * - 读取完成前返回 null（未知）：需要"要么播、要么不播"的一次性入场动效可以先按兵不动，
 *   既不会让 Reduce Motion 用户在首帧看到动画闪一下，也不会在偏好读到后重置重播。
 * - 读取失败按「不限制动画」处理。
 * - 偏好变更事件可能先于初次读取的结果到达（用户刚打开开关，旧的 false 才 resolve），
 *   这时以事件为准，丢弃过期的初次结果。
 */
export function useReduceMotion(): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    let sawEvent = false;

    const applyInitial = (enabled: boolean) => {
      if (mounted && !sawEvent) setReduceMotion(enabled);
    };

    void AccessibilityInfo.isReduceMotionEnabled()
      .then(applyInitial)
      .catch(() => applyInitial(false));

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        sawEvent = true;
        if (mounted) setReduceMotion(enabled);
      },
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
