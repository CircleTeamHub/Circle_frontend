/**
 * report-failure.ts — 「已处理失败」的统一出口。
 *
 * 业务代码里的 catch 块之前只有 `if (__DEV__) console.warn(...)`：release 包里那条
 * 分支被 babel 剥掉之后，失败在生产上完全无声——「全网都打不开会话」与「某个用户
 * 网不好」看起来一模一样。这里把三件事收口成一次调用：
 *
 * 1. dev：console.warn 错误类型和结构化上下文（不输出自由文本 message / Error）；
 * 2. 面包屑：logClientDiagnostic 记一条 `<operation>.<kind>.failed`。面包屑只进本地
 *    缓冲，只有随「本来就要发的」错误上报搭车才离开设备（见 utils/client-diagnostics）；
 * 3. Sentry：预期内的失败不报——ApiError 已由 services/api/client 按 network/5xx 规则
 *    决定过报或不报，ChatSendError 归 chat-core/send-errors 管，CreditPolicyError /
 *    UserFacingError / TempChatUnavailableError / StorageUploadError 是产品语义内的拒绝或
 *    已在各自模块上报过。真正留给这里的是从不经过 apiClient 的那类：SQLite / MMKV /
 *    SecureStore 抛错、expo 模块不可用、导航抛错、原生模块调用失败、JSON 解析失败。
 *
 * 去重：按 `operation:kind` 每个 app 生命周期最多 3 个不同签名（错误名 + 消息前
 * 200 字），签名相同只报一次。与通知链路 report-failure 同一套取舍——按次上报的话，
 * 一个系统性故障能按「用户数 × 触发次数」刷爆配额，后面真正的新问题反而发不出去。
 *
 * operation / kind 必须是稳定的代码字面量（sentry.ts 用它们组 fingerprint），不能带
 * 任何用户内容或标识符；context 只收原始值，且最终仍要过 sentry.ts 的白名单。
 */
import { reportError } from './sentry';
import {
  diagnosticErrorMessage,
  logClientDiagnostic,
} from '@/utils/client-diagnostics';
import { redactSensitiveFields } from '@/utils/redact';

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/** 与 sentry.ts 的 tag 校验同一条正则：fingerprint 只接受稳定的短标识。 */
const STABLE_TAG = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * 「别处已经决定过要不要报」或「产品预期内」的错误类型。按 name 判定而不是
 * instanceof：metro / jest 多副本场景下 instanceof 可能失灵（与 user-facing-error、
 * send-errors 的既有惯例一致），而且这里不能 import services/api/client——它经由
 * session → storage 又回到本模块的调用方，会成环。
 */
const EXPECTED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'ApiError',
  'AbortError',
  'ChatSendError',
  'CreditPolicyError',
  'TempChatUnavailableError',
  'UserFacingError',
  'StorageUploadError',
]);

const MAX_SIGNATURES_PER_KEY = 3;
const MAX_SIGNATURE_MESSAGE_LENGTH = 200;

export type HandledFailureContext = Record<
  string,
  string | number | boolean | null | undefined
>;

const reportedSignatures = new Map<string, Set<string>>();

/** 测试隔离用：清掉「本生命周期已上报」的记账。 */
export function resetHandledFailureTelemetry(): void {
  reportedSignatures.clear();
}

export function isExpectedFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && EXPECTED_ERROR_NAMES.has(name);
}

function errorName(error: unknown): string {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && STABLE_TAG.test(name)) return name;
    return 'Error';
  }
  return typeof error;
}

function stableTag(value: string, fallback: string): string {
  return STABLE_TAG.test(value) ? value : fallback;
}

function primitiveContext(context: HandledFailureContext): HandledFailureContext {
  return Object.fromEntries(
    Object.entries(context).filter(
      ([, value]) =>
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean',
    ),
  );
}

/**
 * 记录一次已被 catch 住、且程序会继续运行的失败。
 *
 * @param operation 稳定的模块/链路名，如 'chatSync'、'storage'、'call'
 * @param kind 该模块内的动作名，如 'localHydrate'、'leaveNotify'
 * @param error 原始错误（不上屏；上屏文案另走 getApiErrorMessage 等漏斗）
 * @param context 只收原始值；进 Sentry 前仍经 sentry.ts 的键白名单过滤
 */
export function reportHandledFailure(
  operation: string,
  kind: string,
  error: unknown,
  context: HandledFailureContext = {},
): void {
  try {
    const safeOperation = stableTag(operation, 'unknownOperation');
    const safeKind = stableTag(kind, 'unknownKind');
    const details = primitiveContext(context);

    logClientDiagnostic(`${safeOperation}.${safeKind}.failed`, {
      ...details,
      errorName: errorName(error),
    });

    if (isDev) {
      console.warn(
        `[${safeOperation}] ${safeKind} failed`,
        redactSensitiveFields({
          ...details,
          errorName: errorName(error),
        }),
      );
    }

    if (isExpectedFailure(error)) return;

    const key = `${safeOperation}:${safeKind}`;
    const seen = reportedSignatures.get(key) ?? new Set<string>();
    if (seen.size >= MAX_SIGNATURES_PER_KEY) return;
    const signature = `${errorName(error)} ${diagnosticErrorMessage(
      error,
    ).slice(0, MAX_SIGNATURE_MESSAGE_LENGTH)}`;
    if (seen.has(signature)) return;
    reportedSignatures.set(key, new Set([...seen, signature]));

    // operation + kind 排在 context 之后：sentry.ts 靠这两个 tag 组稳定 fingerprint，
    // 被调用方 context 覆盖掉就会退回按 message 分组。
    reportError(error, {
      ...details,
      operation: safeOperation,
      kind: safeKind,
    });
  } catch {
    // 可观测性绝不能改变业务行为。
  }
}
