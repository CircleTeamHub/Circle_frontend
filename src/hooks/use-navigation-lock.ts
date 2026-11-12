import { useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * 「先请求、再跳转」入口的防连点锁（比如先建单聊会话再进聊天）。
 *
 * 跳转发起后一直锁着，回到本页（重新聚焦）才解锁。push 之后转场还要几百毫秒，
 * 在 finally 里立刻解锁的话，这段时间再点一下就会再压一层页面；网络慢时两次跳转
 * 还可能隔得比全局去重窗口（navigation-dedupe）更久。请求失败、没有跳转时调用
 * release 当场解锁，用户可以重试。
 */
export function useNavigationLock() {
  const lockedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      lockedRef.current = false;
    }, []),
  );
  return useMemo(
    () => ({
      /** 已经在跳转中返回 false；否则上锁并返回 true。 */
      tryLock: () => {
        if (lockedRef.current) return false;
        lockedRef.current = true;
        return true;
      },
      release: () => {
        lockedRef.current = false;
      },
      /** 跳转进行中（还没回到本页）：同屏其他会触发状态变化的按钮可据此暂不响应。 */
      isLocked: () => lockedRef.current,
    }),
    [],
  );
}
