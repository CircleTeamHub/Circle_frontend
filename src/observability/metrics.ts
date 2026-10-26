/**
 * metrics.ts — 客户端遥测指标（Sentry metrics）的唯一入口。
 *
 * 错误事件回答「哪里坏了」，回答不了「推送有多少被点开」「通话有多少掉线、为什么」
 * 这类比例问题；spans 又被 5% 采样。指标按次计数、不采样，适合这种粗粒度的量。
 *
 * 隐私边界与 sentry.ts 的四个钩子一致，按白名单：
 * - 名字、类型、单位、可带的属性键及其取值都写死在 TELEMETRY_METRICS 里；
 * - 表外的名字整条丢弃，表外的属性键或取值被剥掉；
 * - sentry.ts 的 beforeSendMetric 再按同一张表过一遍（SDK 会自动往属性里塞
 *   user.id / user.email，那一层兜住它）。
 * 所以用户、会话、房间、消息标识与内容都不可能经由指标离开设备。
 *
 * 可观测性绝不能改变业务行为：SDK 缺失（Jest 桩、未初始化）或抛错时静默。
 */
import * as Sentry from '@sentry/react-native';

const PUSH_PROVIDERS = ['jpush', 'expo'] as const;
const PUSH_CATEGORIES = ['chat', 'social', 'circle', 'system', 'other'] as const;
const CALL_QUALITIES = ['poor', 'lost'] as const;

/** livekit DisconnectReason 的枚举名（@livekit/protocol），外加两个兜底值。 */
export const CALL_DISCONNECT_REASONS = [
  'UNKNOWN_REASON',
  'CLIENT_INITIATED',
  'DUPLICATE_IDENTITY',
  'SERVER_SHUTDOWN',
  'PARTICIPANT_REMOVED',
  'ROOM_DELETED',
  'STATE_MISMATCH',
  'JOIN_FAILURE',
  'MIGRATION',
  'SIGNAL_CLOSE',
  'ROOM_CLOSED',
  'USER_UNAVAILABLE',
  'USER_REJECTED',
  'SIP_TRUNK_FAILURE',
  'CONNECTION_TIMEOUT',
  'MEDIA_FAILURE',
  'AGENT_ERROR',
  'UNSPECIFIED',
  'UNRECOGNIZED',
] as const;

interface MetricDefinition {
  type: 'counter' | 'distribution';
  unit?: string;
  attributes: Readonly<Record<string, readonly string[]>>;
}

export const TELEMETRY_METRICS = {
  'push.received': {
    type: 'counter',
    attributes: { provider: PUSH_PROVIDERS, category: PUSH_CATEGORIES },
  },
  'push.opened': {
    type: 'counter',
    attributes: { provider: PUSH_PROVIDERS, category: PUSH_CATEGORIES },
  },
  'call.connect.duration': {
    type: 'distribution',
    unit: 'millisecond',
    attributes: { outcome: ['connected', 'failed', 'cancelled'] },
  },
  'call.disconnect': {
    type: 'counter',
    attributes: { reason: CALL_DISCONNECT_REASONS },
  },
  'call.quality.degraded': {
    type: 'counter',
    attributes: { quality: CALL_QUALITIES },
  },
  'call.quality.degraded_time': {
    type: 'distribution',
    unit: 'second',
    attributes: { quality: CALL_QUALITIES },
  },
  'call.reconnects': {
    type: 'distribution',
    unit: 'none',
    attributes: {},
  },
} as const satisfies Readonly<Record<string, MetricDefinition>>;

export type TelemetryMetric = keyof typeof TELEMETRY_METRICS;

export function metricDefinition(name: unknown): MetricDefinition | undefined {
  return typeof name === 'string' &&
    Object.prototype.hasOwnProperty.call(TELEMETRY_METRICS, name)
    ? TELEMETRY_METRICS[name as TelemetryMetric]
    : undefined;
}

/** 只留表里声明过的属性键，且取值必须是该键允许的枚举之一。 */
export function allowedMetricAttributes(
  definition: MetricDefinition,
  attributes: unknown,
): Record<string, string> {
  if (!attributes || typeof attributes !== 'object') return {};
  const source = attributes as Record<string, unknown>;
  const safe: Record<string, string> = {};
  for (const [key, values] of Object.entries(definition.attributes)) {
    const value = source[key];
    if (typeof value === 'string' && values.includes(value)) safe[key] = value;
  }
  return safe;
}

interface MetricsClient {
  metrics?: {
    count?: (name: string, value: number, options: object) => void;
    distribution?: (name: string, value: number, options: object) => void;
  };
}

export function recordMetric(
  name: TelemetryMetric,
  value: number,
  attributes: Record<string, string> = {},
  client: MetricsClient = Sentry as unknown as MetricsClient,
): void {
  try {
    const definition = metricDefinition(name);
    if (!definition || !Number.isFinite(value) || value < 0) return;
    const options = {
      ...(definition.unit ? { unit: definition.unit } : {}),
      attributes: allowedMetricAttributes(definition, attributes),
    };
    if (definition.type === 'counter') {
      client.metrics?.count?.(name, value, options);
    } else {
      client.metrics?.distribution?.(name, value, options);
    }
  } catch {
    // 可观测性绝不能改变业务行为。
  }
}
