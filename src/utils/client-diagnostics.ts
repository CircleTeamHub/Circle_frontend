import { redactSensitiveFields } from '@/utils/redact';

type DiagnosticValue = string | number | boolean | null;

type DiagnosticDetails = Record<string, DiagnosticValue | undefined>;

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * 可以随「已经在上报的错误」离开设备、去到 Sentry 的 key —— 白名单，不是黑名单。
 *
 * 为什么必须是白名单：redact.ts 那份清单是按 key 名匹配的黑名单，能抓 {token: …}，
 * 但抓不住 {message: <任意错误文本>} —— 而 message 恰恰是当前调用点里第二常见的字段，
 * 装的是 error.message，可能带用户昵称、圈子名、后端原始报错。黑名单永远漏在
 * 「没人想起来加进去」的那一项上；白名单漏的方向是少传一个字段，代价只是诊断信息少一点。
 *
 * 收录标准：只收服务端生成的不透明 ID、固定枚举、计数器。任何自由文本一律不收。
 * 注意：即便是 ID，到了第三方也仍是 GDPR / 个人信息保护法 下的个人信息（可关联到人），
 * 所以这里能少则少，新增字段需要显式评审后再加进本清单。
 */
const SENTRY_BREADCRUMB_ALLOWLIST: ReadonlySet<string> = new Set([
  // 服务端生成的不透明 ID：本身不含用户输入内容，是定位故障的最小必要信息。
  'circleId',
  'conversationID',
  'notificationId',
  'targetMsgID',
  // 系统推送的 request id（由 OS 生成，随通知消亡）。
  'requestIdentifier',
  // 固定枚举，取值范围在代码里封闭：
  'source', // 'system_push' | 'chat_snackbar' | 'notification_snackbar'
  'stage', // FailureStage
  'reason', // DropReason
  'platform', // 'ios' | 'android'
  // 纯计数器 / 分页序号，不承载任何用户内容：
  'selectedCount',
  'succeeded',
  'failed',
  'total',
  'loaded',
  'limit',
  'fetched',
  'inserted',
  'page',
]);

/** 只保留最近 N 条：面包屑是给「错误发生前发生了什么」提供线索，不是日志留存。 */
const MAX_BREADCRUMBS = 20;

export interface DiagnosticBreadcrumb {
  readonly event: string;
  readonly details: Readonly<Record<string, DiagnosticValue>>;
}

let breadcrumbs: readonly DiagnosticBreadcrumb[] = [];

/**
 * 白名单过滤 + 共享脱敏表二次过滤。两层都要：白名单挡住「不该出去的 key」，
 * redactSensitiveFields 挡住「白名单 key 上挂了敏感值」（如预签名 URL）。
 */
function toBreadcrumbDetails(
  details: Record<string, DiagnosticValue>,
): Readonly<Record<string, DiagnosticValue>> {
  const allowlisted = Object.fromEntries(
    Object.entries(details).filter(([key]) =>
      SENTRY_BREADCRUMB_ALLOWLIST.has(key),
    ),
  );
  return redactSensitiveFields(allowlisted) as Record<string, DiagnosticValue>;
}

/**
 * 埋点专用的原始错误文本。业务代码不许自己写 `instanceof Error ? x.message : …`
 * 三元——那个指纹一旦散落在 feature 里，下一步往往就是被顺手塞进 Alert 上屏
 * （「会话加载失败：websocket error」就是这么来的）。展示走 getApiErrorMessage /
 * getChatSendErrorMessage；只有埋点走这里。message 字段不在 SENTRY_BREADCRUMB_ALLOWLIST
 * 里，所以这段文本只进 dev console，不随上报离开设备。
 */
export function diagnosticErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 仅 dev 的诊断日志 + 仅本地的面包屑缓冲。三层防护，缺一不可：
 * - __DEV__ 短路：production 里连 console 字符串拼接都不做。babel 的
 *   transform-remove-console 已经会剥掉 console.warn，但那是构建配置——配置一旦漏掉
 *   （api.env('production') 没解析到等），这里就成了明文出口。不能把「不泄漏」只押在
 *   构建配置上。
 * - redactSensitiveFields：details 是调用方自由传的字段，原来只滤了 undefined。
 *   token / password 这类 key 走共享脱敏表，与 api 客户端同一份清单。
 * - SENTRY_BREADCRUMB_ALLOWLIST：只有白名单里的 key 会进面包屑缓冲，也就是只有它们
 *   有机会随错误上报离开设备。dev console 不受白名单限制——本地排障要看全量，
 *   白名单管的是「上传给第三方」这道闸门，不是本地调试那道。
 *
 * 关于面包屑：这里只往内存缓冲区里写，**不发送任何东西**。本模块对 Sentry 一无所知
 * （没有 import，也没有能力发送）；面包屑是 observability/sentry 的 reportError 在
 * 真的上报错误时主动来「拉」的。没有错误上报 → 缓冲区原地待着，一个字节都不出去。
 * 这个方向性是有意的：「新开一条上传通道」这件事在本模块里做不到。
 */
export function logClientDiagnostic(
  event: string,
  details: DiagnosticDetails = {},
) {
  const sanitized = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  ) as Record<string, DiagnosticValue>;

  breadcrumbs = [
    ...breadcrumbs,
    { event, details: toBreadcrumbDetails(sanitized) },
  ].slice(-MAX_BREADCRUMBS);

  if (!isDev) {
    return;
  }

  console.warn(`[client-diagnostic] ${event}`, redactSensitiveFields(sanitized));
}

/**
 * 供 observability/sentry 在上报错误时读取。返回当前缓冲区快照（不可变）。
 * 这是面包屑离开本模块的唯一出口，且只被 reportError 调用。
 */
export function readDiagnosticBreadcrumbs(): readonly DiagnosticBreadcrumb[] {
  return breadcrumbs;
}

/**
 * 会话结束时清空。必须调用：缓冲区是进程级的，而 app 支持不重启切换账号——
 * 不清的话，账号 A 的 circleId / conversationID 会挂到账号 B 的错误上报里。
 */
export function resetDiagnosticBreadcrumbs(): void {
  breadcrumbs = [];
}
