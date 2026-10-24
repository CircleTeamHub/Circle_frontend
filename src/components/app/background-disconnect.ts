/** 安卓退到后台多久之后断开聊天长连接、交给推送。 */
export const BACKGROUND_DISCONNECT_DELAY_MS = 60_000;

type TimerHandle = ReturnType<typeof setTimeout>;

interface BackgroundDisconnectOptions {
  delayMs?: number;
  /** 到点时是否仍要保持连接(还有消息没发完)。是的话再等一轮。 */
  shouldStayConnected: () => boolean;
  disconnect: () => void;
  setTimer?: (fn: () => void, delay: number) => TimerHandle | number;
  clearTimer?: (handle: TimerHandle | number) => void;
}

/**
 * 安卓退到后台后,JS 仍在运行、聊天长连接一直连着:每个群的每条消息都在后台走一遍
 * 写 store、写本地库、出通知。离开超过 delayMs 就断开,新消息交给推送提醒;回前台由
 * 现有的恢复逻辑重连并对账。
 *
 * 不是越短越好:切出去马上回来很常见(复制验证码、看张图),一切走就断的话回来要重连、
 * 重拉会话快照、补拉落后的群,群多时比在后台多挂几十秒更费电。iOS 系统本身约 30 秒
 * 就挂起 App,不需要这套。
 */
export function createBackgroundDisconnect({
  delayMs = BACKGROUND_DISCONNECT_DELAY_MS,
  shouldStayConnected,
  disconnect,
  setTimer = setTimeout,
  clearTimer = (handle) => clearTimeout(handle as TimerHandle),
}: BackgroundDisconnectOptions): {
  onBackground: () => void;
  onForeground: () => void;
  dispose: () => void;
} {
  let timer: TimerHandle | number | null = null;

  const arm = () => {
    timer = setTimer(() => {
      timer = null;
      if (shouldStayConnected()) {
        arm();
        return;
      }
      disconnect();
    }, delayMs);
  };

  const cancel = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  return {
    onBackground: () => {
      if (timer === null) arm();
    },
    onForeground: cancel,
    dispose: cancel,
  };
}
