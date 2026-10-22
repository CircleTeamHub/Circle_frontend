/**
 * tracing.ts — 业务关键链路的自定义 Sentry span。
 *
 * 导航 transaction 回答「哪个屏幕慢」，回答不了「消息发送慢在哪一段」：发消息和
 * 聊天 socket 建连都不走 XHR，没有自动 span。这里给它们各一个手动 span。
 *
 * 隐私边界与 sentry.ts 一致：
 * - span 名和 op 只来自下面的固定表，调用方只能传表里的键，不能拼字符串；
 * - 不设置任何属性 —— 用户、会话、消息内容、token 都不可能经由这里离开设备；
 * - 结果只记 Sentry 认得的状态枚举（SpanFailureStatus），其余一律降级成 unknown_error。
 *
 * 两个 span 都是根 span（parentSpan: null），各自成为一条 transaction：发消息最多
 * 排队等一分钟、离线时建连可能一直不成功，挂到导航 idle span 下面会把那条导航
 * transaction 一直撑开，屏幕耗时数据就失真了。
 *
 * 可观测性绝不能改变业务行为：SDK 缺失（Jest 桩、web）或抛错时退化成无操作 span。
 */
import * as Sentry from '@sentry/react-native';

const TRACED_OPERATIONS = {
  chatSend: { name: 'chat.message.send', op: 'chat.send' },
  chatConnect: { name: 'chat.socket.connect', op: 'websocket.connect' },
} as const;

export type TracedOperation = keyof typeof TRACED_OPERATIONS;

/** sentry.ts 的 transaction 名过滤器据此原样保留这些自定义 span 名。 */
export const TRACED_SPAN_NAMES: ReadonlySet<string> = new Set(
  Object.values(TRACED_OPERATIONS).map((operation) => operation.name),
);

/**
 * Sentry 认得的失败状态（OpenTelemetry / gRPC 状态码）。集合外的值会在接收端被丢掉，
 * 那条 span 就没有状态、算不进失败率，所以业务原因由调用方映射到这里。
 */
const SPAN_FAILURE_STATUSES = [
  'cancelled',
  'unknown_error',
  'invalid_argument',
  'deadline_exceeded',
  'not_found',
  'already_exists',
  'permission_denied',
  'resource_exhausted',
  'failed_precondition',
  'aborted',
  'out_of_range',
  'unimplemented',
  'internal_error',
  'unavailable',
  'data_loss',
  'unauthenticated',
] as const;

export type SpanFailureStatus = (typeof SPAN_FAILURE_STATUSES)[number];

const KNOWN_FAILURE_STATUSES: ReadonlySet<string> = new Set(SPAN_FAILURE_STATUSES);
// @sentry/core 的 SPAN_STATUS_OK / SPAN_STATUS_ERROR；不为两个常量引入运行时依赖。
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

interface SpanLike {
  setStatus: (status: { code: number; message?: string }) => unknown;
  end: () => void;
}

interface TracingClient {
  startInactiveSpan?: (options: {
    name: string;
    op: string;
    parentSpan: null;
  }) => SpanLike;
}

export interface OperationSpan {
  /** 不传 = 成功；失败传状态枚举。只有第一次调用生效。 */
  end: (failureStatus?: SpanFailureStatus) => void;
}

const NOOP_SPAN: OperationSpan = { end() {} };

export function startOperationSpan(
  operation: TracedOperation,
  client: TracingClient = Sentry as unknown as TracingClient,
): OperationSpan {
  try {
    const definition = Object.prototype.hasOwnProperty.call(TRACED_OPERATIONS, operation)
      ? TRACED_OPERATIONS[operation]
      : undefined;
    if (!definition || typeof client.startInactiveSpan !== 'function') {
      return NOOP_SPAN;
    }
    const span = client.startInactiveSpan({
      name: definition.name,
      op: definition.op,
      parentSpan: null,
    });
    let ended = false;
    return {
      end(failureStatus) {
        if (ended) return;
        ended = true;
        try {
          try {
            span.setStatus(
              failureStatus === undefined
                ? { code: SPAN_STATUS_OK }
                : {
                    code: SPAN_STATUS_ERROR,
                    message: KNOWN_FAILURE_STATUSES.has(failureStatus)
                      ? failureStatus
                      : 'unknown_error',
                  },
            );
          } finally {
            span.end();
          }
        } catch {
          // 可观测性绝不能改变业务行为。
        }
      },
    };
  } catch {
    return NOOP_SPAN;
  }
}
