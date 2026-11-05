/**
 * request-trace.ts — 请求卡住时「卡在哪一步」的现场记录（只在原生端装）。
 *
 * 2026-11「选择笔记」转圈：服务器 30ms 内回了、回包也到了手机，JS 却一直没拿到；
 * Release 包里看不到 JS，只能把现场量化成几项数字，随超时上报一起离开设备：
 * - XHR 走到了哪一步（发出 / 原生交回 requestId / 响应头 / 收数据 / 完成）及各自耗时；
 * - 原生事件是否比 requestId 回调先到（iOS 的 requestId 经回调异步交给 JS，
 *   早到的事件会被 XMLHttpRequest 按 id 不符丢掉）；
 * - 等待期间 JS 线程最大卡顿、还有几个请求在飞、期间别的请求完成了几个、前后台状态。
 *
 * 只记枚举与计数，不碰 URL / 请求头 / 请求体。XHR 内部方法（__didCreateRequest 等）
 * 是 RN 的私有实现，取不到就少记一项，绝不影响请求本身。
 */
import type { RequestTrace, RequestTraceHooks } from '@/services/api/client';

type XhrPrototype = Record<string, unknown>;

type XhrLike = {
  readyState: number;
  addEventListener?: (type: string, listener: () => void) => void;
  [key: string]: unknown;
};

type Milestones = {
  sentAt: number;
  ackAt?: number;
  headersAt?: number;
  loadingAt?: number;
  doneAt?: number;
  abortedAt?: number;
  earlyEvent?: boolean;
};

type ActiveRequest = {
  startedAt: number;
  completedBefore: number;
  appState: string;
};

export type RequestTraceDeps = {
  now: () => number;
  getAppState: () => string;
  /** 前后台每次切换都回调：只看首尾两个时刻会漏掉「中途去后台又回来」。 */
  subscribeAppState?: (listener: () => void) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  xhrPrototype?: XhrPrototype | null;
};

const TRACE_HEADER = 'x-request-id';
const TRACE_KEY = '__circleTraceRequestId';
// 只给 apiClient 的请求记账；正常情况下 finish 会取走，这里只是防漏的上限。
const MAX_TRACKED_REQUESTS = 64;
const MAX_SEEN_NATIVE_IDS = 64;
// 采样只在有请求在飞时跑；500ms 的分辨率足够区分「JS 卡死」和「网络没回」。
const LAG_SAMPLE_MS = 500;
const MAX_LAG_SAMPLES = 60;

const WRAPPED_METHODS = [
  'setRequestHeader',
  'send',
  'abort',
  '__didCreateRequest',
  '__didReceiveResponse',
] as const;
type XhrSink = Record<(typeof WRAPPED_METHODS)[number], (xhr: XhrLike, args: unknown[]) => void>;
const SINK_KEY = '__circleTraceSink';
const INSTALLED_KEY = '__circleTraceInstalled';

/**
 * 原型上的包装只装一次，之后再建钩子只换「当前记录器」：开发时 Fast Refresh 会重跑
 * app/_layout，每次都重新包一层的话，包装层层叠加，旧记录器还在偷偷记账。
 */
function installXhrTracking(proto: XhrPrototype, sink: XhrSink): void {
  proto[SINK_KEY] = sink;
  if (proto[INSTALLED_KEY]) return;
  proto[INSTALLED_KEY] = true;
  for (const name of WRAPPED_METHODS) {
    const original = proto[name];
    if (typeof original !== 'function') continue;
    proto[name] = function wrapped(this: XhrLike, ...args: unknown[]) {
      try {
        (proto[SINK_KEY] as XhrSink | undefined)?.[name](this, args);
      } catch {
        // Diagnostics only: never change XHR behaviour.
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
}

function elapsed(from: number, to: number | undefined): number | undefined {
  return to === undefined ? undefined : Math.max(0, Math.round(to - from));
}

export function createRequestTraceHooks(deps: RequestTraceDeps): RequestTraceHooks {
  const milestones = new Map<string, Milestones>();
  const active = new Map<string, ActiveRequest>();
  const seenNativeIds: unknown[] = [];
  const lagSamples: { at: number; lag: number }[] = [];
  let completedCount = 0;
  let lagTimer: unknown = null;
  let lastTick: number | null = null;
  // iOS 进后台会冻结 JS，回来时那段挂起会被采样器算成「JS 卡顿」；有切换就让读数的人知道。
  let lastAppStateChangeAt = Number.NEGATIVE_INFINITY;
  deps.subscribeAppState?.(() => {
    lastAppStateChangeAt = deps.now();
  });

  const remember = (requestId: string, entry: Milestones) => {
    milestones.set(requestId, entry);
    if (milestones.size > MAX_TRACKED_REQUESTS) {
      const oldest = milestones.keys().next().value;
      if (oldest !== undefined) milestones.delete(oldest);
    }
  };

  const entryOf = (xhr: XhrLike) => {
    const requestId = xhr[TRACE_KEY];
    return typeof requestId === 'string' ? milestones.get(requestId) : undefined;
  };

  const proto = deps.xhrPrototype;
  if (proto) {
    installXhrTracking(proto, {
      setRequestHeader: (xhr, [name, value]) => {
        if (String(name).toLowerCase() === TRACE_HEADER) xhr[TRACE_KEY] = String(value);
      },
      send: (xhr) => {
        const requestId = xhr[TRACE_KEY];
        if (typeof requestId !== 'string') return;
        const entry: Milestones = { sentAt: deps.now() };
        remember(requestId, entry);
        xhr.addEventListener?.('readystatechange', () => {
          // 中止会把 readyState 直接推到 DONE：那既不是收到响应，也不是完成。
          if (entry.abortedAt !== undefined) return;
          const at = deps.now();
          if (xhr.readyState >= 2) entry.headersAt ??= at;
          if (xhr.readyState >= 3) entry.loadingAt ??= at;
          if (xhr.readyState === 4) entry.doneAt ??= at;
        });
      },
      abort: (xhr) => {
        const entry = entryOf(xhr);
        if (entry) entry.abortedAt ??= deps.now();
      },
      __didCreateRequest: (xhr, [nativeId]) => {
        const entry = entryOf(xhr);
        if (!entry) return;
        entry.ackAt = deps.now();
        if (seenNativeIds.includes(nativeId)) entry.earlyEvent = true;
      },
      // 每个响应事件会分发给所有在飞的 XHR；这里只记「哪些原生 id 已经来过事件」。
      __didReceiveResponse: (_xhr, [nativeId]) => {
        if (seenNativeIds.includes(nativeId)) return;
        seenNativeIds.push(nativeId);
        if (seenNativeIds.length > MAX_SEEN_NATIVE_IDS) seenNativeIds.shift();
      },
    });
  }

  const sampleLag = () => {
    const at = deps.now();
    if (lastTick !== null) {
      lagSamples.push({ at, lag: Math.max(0, at - lastTick - LAG_SAMPLE_MS) });
      if (lagSamples.length > MAX_LAG_SAMPLES) lagSamples.shift();
    }
    lastTick = at;
  };

  const stopSamplerWhenIdle = () => {
    if (active.size > 0 || lagTimer === null) return;
    deps.clearInterval(lagTimer);
    lagTimer = null;
    lastTick = null;
  };

  return {
    isReceiving(requestId) {
      const entry = milestones.get(requestId);
      return Boolean(
        entry &&
          entry.headersAt !== undefined &&
          entry.doneAt === undefined &&
          entry.abortedAt === undefined,
      );
    },

    begin(requestId) {
      active.set(requestId, {
        startedAt: deps.now(),
        completedBefore: completedCount,
        appState: deps.getAppState(),
      });
      if (lagTimer === null) {
        lastTick = deps.now();
        lagTimer = deps.setInterval(sampleLag, LAG_SAMPLE_MS);
      }
    },

    finish(requestId, failed): RequestTrace | undefined {
      const request = active.get(requestId);
      const entry = milestones.get(requestId);
      active.delete(requestId);
      milestones.delete(requestId);
      if (!failed || !request) {
        completedCount += 1;
        stopSamplerWhenIdle();
        return undefined;
      }

      const now = deps.now();
      // JS 线程若刚从长卡顿里出来，采样器还没来得及记，这里补算当下这一段。
      const pendingLag = lastTick !== null ? Math.max(0, now - lastTick - LAG_SAMPLE_MS) : 0;
      const loopLagMs = Math.round(
        lagSamples
          .filter((sample) => sample.at >= request.startedAt)
          .reduce((max, sample) => Math.max(max, sample.lag), pendingLag),
      );
      const appState = deps.getAppState();
      const xhrStage = !entry
        ? 'untracked'
        : entry.doneAt !== undefined
          ? 'done'
          : entry.loadingAt !== undefined
            ? 'loading'
            : entry.headersAt !== undefined
              ? 'headers'
              : entry.ackAt !== undefined
                ? 'acked'
                : 'sent';
      const trace: Record<string, string | number | boolean> = {
        xhrStage,
        inflight: active.size,
        completedWhileWaiting: completedCount - request.completedBefore,
        loopLagMs,
        appState,
        appStateChanged: appState !== request.appState || lastAppStateChangeAt >= request.startedAt,
      };
      if (entry) {
        const ackMs = elapsed(entry.sentAt, entry.ackAt);
        const headersMs = elapsed(entry.sentAt, entry.headersAt);
        const doneMs = elapsed(entry.sentAt, entry.doneAt);
        if (ackMs !== undefined) trace.xhrAckMs = ackMs;
        if (headersMs !== undefined) trace.xhrHeadersMs = headersMs;
        if (doneMs !== undefined) trace.xhrDoneMs = doneMs;
        trace.xhrEarlyEvent = entry.earlyEvent === true;
      }
      stopSamplerWhenIdle();
      return trace;
    },
  };
}
