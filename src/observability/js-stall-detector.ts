/**
 * js-stall-detector.ts — 前台时 JS 线程卡住几秒就报一次（只在原生端装）。
 *
 * request-trace 只在有请求在飞时量卡顿；「笔记保存成功后停在『保存中』」「点飞机 tab
 * 卡死」这类卡在请求之外，之前生产上一点动静都没有，只能靠用户描述猜。这里在前台常驻
 * 一个 1 秒一拍的定时器：JS 线程被占住时这一拍会迟到，迟到多久就是卡了多久。上报经
 * reportHandledFailure 走，自带卡顿前的面包屑和路由，能看出卡之前在干什么。
 *
 * 熄屏 / 切后台时系统会挂起进程：离开前台就停表，回来重新起表。挂起前事件没来得及送到
 * JS 的话，解锁后迟到的那一拍会先跑、前后台事件紧跟着才到，所以卡顿要等下一拍才确认；
 * 隔了一会儿才离开前台的（卡完用户放弃、切走了）照报。
 */
export type JsStallDetectorDeps = {
  now: () => number;
  getAppState: () => string;
  /** 进程级常驻，不需要移除。 */
  subscribeAppState: (listener: () => void) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  onStall: (durationMs: number) => void;
};

const TICK_MS = 1000;
export const JS_STALL_THRESHOLD_MS = 3000;
// 挂起恢复时，迟到的一拍和随后送达的前后台事件之间只隔几毫秒；人卡完再切走至少要几百毫秒。
const RESUME_EVENT_WINDOW_MS = 500;

export function startJsStallDetector(deps: JsStallDetectorDeps): void {
  let timer: unknown = null;
  let lastTick = 0;
  let pending: { durationMs: number; detectedAt: number } | null = null;

  const tick = () => {
    const at = deps.now();
    if (pending) deps.onStall(pending.durationMs);
    const lag = at - lastTick - TICK_MS;
    pending = lag >= JS_STALL_THRESHOLD_MS ? { durationMs: Math.round(lag), detectedAt: at } : null;
    lastTick = at;
  };

  const start = () => {
    lastTick = deps.now();
    timer = deps.setInterval(tick, TICK_MS);
  };

  deps.subscribeAppState(() => {
    if (pending && deps.now() - pending.detectedAt >= RESUME_EVENT_WINDOW_MS) {
      deps.onStall(pending.durationMs);
    }
    pending = null;
    if (timer !== null) {
      deps.clearInterval(timer);
      timer = null;
    }
    if (deps.getAppState() === 'active') start();
  });

  if (deps.getAppState() === 'active') start();
}
