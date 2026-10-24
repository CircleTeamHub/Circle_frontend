import { recordMetric as defaultRecordMetric } from '@/observability/metrics';

/**
 * 推送送达 / 打开的粗粒度遥测（Sentry metrics，见 observability/metrics 的白名单表）。
 *
 * 只记两样：通道（jpush / expo）和由推送 type 归出来的大类。标题、正文、会话、
 * 用户标识一律不碰；identifier 只在本地用来去重，不上报。
 *
 * 口径说明：「送达」只能数到 App 进程活着时收到的那部分（前台，或极光在后台仍
 * 回调时）。真正的送达率要靠推送服务端的回执接口，客户端拿不到。
 */

export type PushProvider = 'jpush' | 'expo';
type PushCategory = 'chat' | 'social' | 'circle' | 'system' | 'other';

const CHAT_TYPES = new Set(['MESSAGE_RECEIVED', 'MEMBER_MENTION', 'MESSAGE_QUOTE']);
const SOCIAL_TYPES = new Set(['PROFILE_LIKE']);

export function pushCategory(data: unknown): PushCategory {
  if (!data || typeof data !== 'object') return 'other';
  const source = data as Record<string, unknown>;
  const raw = source.type ?? source.notificationType;
  if (typeof raw !== 'string') return 'other';
  const type = raw.trim().toUpperCase();
  if (CHAT_TYPES.has(type)) return 'chat';
  if (type === 'SYSTEM') return 'system';
  if (SOCIAL_TYPES.has(type) || type.startsWith('FRIEND_')) return 'social';
  if (type.startsWith('CIRCLE_') || type === 'GROUP_ADMISSION') return 'circle';
  return 'other';
}

const MAX_REMEMBERED_IDS = 200;

export interface PushTelemetryDependencies {
  recordMetric: (
    name: 'push.received' | 'push.opened',
    value: number,
    attributes: Record<string, string>,
  ) => void;
}

export interface PushTelemetry {
  received: (provider: PushProvider, identifier: string, data: unknown) => void;
  opened: (provider: PushProvider, identifier: string, data: unknown) => void;
}

export function createPushTelemetry(
  deps: PushTelemetryDependencies = { recordMetric: defaultRecordMetric },
): PushTelemetry {
  // 同一条推送可能从两条路进来（冷启动时监听器 + getLastNotificationResponse）。
  const seen: Record<'received' | 'opened', string[]> = { received: [], opened: [] };

  const record = (
    event: 'received' | 'opened',
    provider: PushProvider,
    identifier: string,
    data: unknown,
  ) => {
    try {
      const ids = seen[event];
      if (identifier && ids.includes(identifier)) return;
      if (identifier) seen[event] = [...ids, identifier].slice(-MAX_REMEMBERED_IDS);
      deps.recordMetric(event === 'received' ? 'push.received' : 'push.opened', 1, {
        provider,
        category: pushCategory(data),
      });
    } catch {
      // 可观测性绝不能改变推送路由。
    }
  };

  return {
    received: (provider, identifier, data) => record('received', provider, identifier, data),
    opened: (provider, identifier, data) => record('opened', provider, identifier, data),
  };
}

export const pushTelemetry = createPushTelemetry();
