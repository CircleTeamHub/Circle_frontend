/**
 * connection-watchdog.ts — 前台、有会话，聊天长连接却断着一分钟、而且没人在重连，就报一次。
 *
 * 连不上的情况已经有上报：socket.io 退避重连时每段断网的第一条 connect_error 都会报。
 * 看不见的是「断了以后再也没人去连」：socket 被拆掉（token 轮换挂起、安卓后台断开）之后
 * 没被重建，或者 socket 已经不 active、也没排补连。这种不抛任何错，用户只觉得收不到消息。
 * 到点时还有重连在进行（离线、服务器不可达）就再等一轮，不报。
 */
export const CHAT_STUCK_DISCONNECT_MS = 60_000;

export type ConnectionWatchdogDeps = {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  /** socket.io 仍在自动重连、或已排了补连 / token 刷新。 */
  isReconnectPending: () => boolean;
  onStuck: (durationMs: number) => void;
};

export type ConnectionSnapshot = {
  /** 有登录会话、本该连着。 */
  expected: boolean;
  foreground: boolean;
  connected: boolean;
};

export function createConnectionWatchdog(deps: ConnectionWatchdogDeps) {
  let timer: unknown = null;
  let downSince = 0;
  let reported = false;

  const stop = () => {
    if (timer === null) return;
    deps.clearTimeout(timer);
    timer = null;
  };

  const arm = () => {
    timer = deps.setTimeout(() => {
      timer = null;
      if (deps.isReconnectPending()) {
        arm();
        return;
      }
      reported = true;
      deps.onStuck(Math.round(deps.now() - downSince));
    }, CHAT_STUCK_DISCONNECT_MS);
  };

  const update = ({ expected, foreground, connected }: ConnectionSnapshot) => {
    if (connected) reported = false;
    if (!expected || !foreground || connected) {
      stop();
      return;
    }
    if (timer !== null || reported) return;
    downSince = deps.now();
    arm();
  };

  return { update };
}
