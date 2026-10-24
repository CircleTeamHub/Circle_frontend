import { recordMetric as defaultRecordMetric } from '@/observability/metrics';
import { reportHandledFailure } from '@/observability/report-failure';
import { logClientDiagnostic } from '@/utils/client-diagnostics';

/**
 * 通话质量遥测：一次 LiveKitRoom（重连按钮会换新的一个）一份。
 *
 * 记什么（都走 observability/metrics 的白名单表）：
 * - 建连耗时：从房间创建到第一次 Connected，或失败 / 放弃；
 * - 断开原因：livekit DisconnectReason 的枚举名；
 * - 本端连接质量：掉到 poor / lost 的次数和累计时长；
 * - 重连次数（reconnecting 与 signalReconnecting 算同一次）。
 * 异常断开（信令断、超时、媒体失败……）另报一条错误，错误码 = 原因枚举名，
 * Sentry 里按原因分成不同 issue，带着本端质量下降的面包屑。
 *
 * 只有枚举和数值：参与者 identity、房间名、token 一个都不经过这里。
 */

type FailureStatus = 'normal' | 'abnormal';

/** DisconnectReason 数值（@livekit/protocol）→ 枚举名与是否异常。 */
const DISCONNECT_REASONS: Readonly<Record<number, readonly [string, FailureStatus]>> = {
  0: ['UNKNOWN_REASON', 'abnormal'],
  1: ['CLIENT_INITIATED', 'normal'],
  2: ['DUPLICATE_IDENTITY', 'normal'],
  3: ['SERVER_SHUTDOWN', 'abnormal'],
  4: ['PARTICIPANT_REMOVED', 'normal'],
  5: ['ROOM_DELETED', 'normal'],
  6: ['STATE_MISMATCH', 'abnormal'],
  7: ['JOIN_FAILURE', 'abnormal'],
  8: ['MIGRATION', 'normal'],
  9: ['SIGNAL_CLOSE', 'abnormal'],
  10: ['ROOM_CLOSED', 'normal'],
  11: ['USER_UNAVAILABLE', 'normal'],
  12: ['USER_REJECTED', 'normal'],
  13: ['SIP_TRUNK_FAILURE', 'abnormal'],
  14: ['CONNECTION_TIMEOUT', 'abnormal'],
  15: ['MEDIA_FAILURE', 'abnormal'],
  16: ['AGENT_ERROR', 'abnormal'],
};

/** 测试用：call-telemetry 可能产出的全部原因名（须是指标表允许值的子集）。 */
export const CALL_DISCONNECT_REASON_NAMES: readonly string[] = [
  ...Object.values(DISCONNECT_REASONS).map(([name]) => name),
  'UNSPECIFIED',
  'UNRECOGNIZED',
];

function classifyDisconnect(reason: unknown): readonly [string, FailureStatus] {
  // RN 的 LiveKitRoom 类型不带 reason，运行时可能拿不到：归「未说明」，不当故障。
  if (reason === undefined || reason === null) return ['UNSPECIFIED', 'normal'];
  if (typeof reason === 'number' && Object.prototype.hasOwnProperty.call(DISCONNECT_REASONS, reason)) {
    return DISCONNECT_REASONS[reason];
  }
  return ['UNRECOGNIZED', 'abnormal'];
}

type DegradedQuality = 'poor' | 'lost';

function degradedQuality(quality: unknown): DegradedQuality | null {
  return quality === 'poor' || quality === 'lost' ? quality : null;
}

const RECONNECTING_STATES = new Set(['reconnecting', 'signalReconnecting']);
const MAX_QUALITY_BREADCRUMBS = 5;

class CallDisconnectError extends Error {
  constructor(reason: string) {
    super(`call disconnected: ${reason}`);
    this.name = 'CallDisconnect';
  }
}

export interface CallTelemetryDependencies {
  now: () => number;
  recordMetric: (name: Parameters<typeof defaultRecordMetric>[0], value: number, attributes?: Record<string, string>) => void;
  reportFailure: typeof reportHandledFailure;
  logDiagnostic: typeof logClientDiagnostic;
}

export interface CallTelemetry {
  /** LiveKitRoom 真正挂载（开始建连）的时刻；之前的组件加载时间不算建连。 */
  roomMounted: () => void;
  /**
   * LiveKitRoom 卸载。挂断 / 对端结束时 activeCall 先被清空、房间先卸载，它的
   * Disconnected 监听已经摘掉，之后才发出的断开事件没人收 —— 在这里收尾。
   */
  roomUnmounted: () => void;
  connected: () => void;
  connectionStateChanged: (state: string) => void;
  qualityChanged: (quality: unknown) => void;
  disconnected: (reason?: unknown) => void;
  dispose: () => void;
}

const defaultDependencies: CallTelemetryDependencies = {
  now: () => Date.now(),
  recordMetric: defaultRecordMetric,
  reportFailure: reportHandledFailure,
  logDiagnostic: logClientDiagnostic,
};

export function createCallTelemetry(
  overrides: Partial<CallTelemetryDependencies> = {},
): CallTelemetry {
  const deps = { ...defaultDependencies, ...overrides };
  let connectStartedAt = deps.now();
  let roomMountedOnce = false;
  let connectSettled = false;
  let inSession = false;
  let finished = false;
  let reconnecting = false;
  let reconnects = 0;
  let qualityBreadcrumbs = 0;
  // 抖动的链路每秒都可能在 good / poor 之间来回：次数在内存里累计，收尾时按档发一次。
  const degradedCounts: Record<DegradedQuality, number> = { poor: 0, lost: 0 };
  let currentDegraded: DegradedQuality | null = null;
  let degradedSince = 0;
  const degradedSeconds: Record<DegradedQuality, number> = { poor: 0, lost: 0 };

  const safely = (run: () => void) => {
    try {
      run();
    } catch {
      // 可观测性绝不能改变通话行为。
    }
  };

  const settleConnect = (outcome: 'connected' | 'failed' | 'cancelled') => {
    if (connectSettled) return;
    connectSettled = true;
    deps.recordMetric('call.connect.duration', deps.now() - connectStartedAt, { outcome });
  };

  const closeDegradedInterval = () => {
    if (!currentDegraded) return;
    degradedSeconds[currentDegraded] += (deps.now() - degradedSince) / 1000;
    currentDegraded = null;
  };

  const finishSession = (reasonName: string | null) => {
    if (!inSession) return;
    inSession = false;
    closeDegradedInterval();
    for (const quality of ['poor', 'lost'] as const) {
      if (degradedCounts[quality] > 0) {
        deps.recordMetric('call.quality.degraded', degradedCounts[quality], { quality });
      }
      if (degradedSeconds[quality] > 0) {
        deps.recordMetric('call.quality.degraded_time', Math.round(degradedSeconds[quality]), { quality });
      }
    }
    deps.recordMetric('call.reconnects', reconnects);
    if (reasonName) deps.recordMetric('call.disconnect', 1, { reason: reasonName });
  };

  /** 卸载 / 屏幕离开时收尾：没开始建连的不记建连样本，也不编一个断开原因以外的东西。 */
  const finishWithoutEvent = () => {
    if (finished) return;
    finished = true;
    if (roomMountedOnce) settleConnect('cancelled');
    finishSession(inSession ? 'UNSPECIFIED' : null);
  };

  return {
    roomMounted: () =>
      safely(() => {
        if (connectSettled || finished) return;
        roomMountedOnce = true;
        connectStartedAt = deps.now();
      }),
    roomUnmounted: () => safely(finishWithoutEvent),
    connected: () =>
      safely(() => {
        if (finished || inSession) return;
        settleConnect('connected');
        inSession = true;
      }),
    connectionStateChanged: (state) =>
      safely(() => {
        if (!inSession) return;
        if (RECONNECTING_STATES.has(state)) {
          if (!reconnecting) {
            reconnecting = true;
            reconnects += 1;
            deps.logDiagnostic('call.reconnecting', { stage: 'media' });
          }
        } else if (state === 'connected') {
          reconnecting = false;
        }
      }),
    qualityChanged: (quality) =>
      safely(() => {
        if (!inSession) return;
        const next = degradedQuality(quality);
        if (next === currentDegraded) return;
        closeDegradedInterval();
        if (!next) return;
        currentDegraded = next;
        degradedSince = deps.now();
        degradedCounts[next] += 1;
        if (qualityBreadcrumbs < MAX_QUALITY_BREADCRUMBS) {
          qualityBreadcrumbs += 1;
          deps.logDiagnostic('call.quality.degraded', { reason: next });
        }
      }),
    disconnected: (reason) =>
      safely(() => {
        if (finished) return;
        finished = true;
        const [reasonName, status] = classifyDisconnect(reason);
        const wasInSession = inSession;
        if (!wasInSession) {
          // 建连阶段就断了（livekit 连接失败时先发 JOIN_FAILURE 的 Disconnected 再 reject）。
          settleConnect(status === 'abnormal' ? 'failed' : 'cancelled');
        }
        finishSession(reasonName);
        // 建连阶段的失败 onError 已经报了 livekit/roomConnection，这里不重复报。
        if (status === 'abnormal' && wasInSession) {
          deps.reportFailure('call', 'abnormalDisconnect', new CallDisconnectError(reasonName), {
            code: reasonName,
          });
        }
      }),
    dispose: () => safely(finishWithoutEvent),
  };
}
