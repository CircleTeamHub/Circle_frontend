import i18n from '@/i18n';
import { reportError } from '@/observability/sentry';
import {
  CreditPolicyError,
  getCreditPolicyMessage,
} from '@/services/api/credit-policy';
import { isKnownServerErrorCode } from '@/services/api/server-error-codes';
import { ChatSendError } from './socket-manager';

/**
 * 发送失败的两件事:给用户看什么、给我们自己留什么。
 */

/**
 * 「已经解释清楚了」的发送拒绝码。
 *
 * 这一份清单同时决定两件事,所以只能有一份:
 * 1. 用户看到的是具体原因(走 serverErrors.<code> 的本地化词条),而不是
 *    统一的「发送失败,请重试」—— 被禁言/被拉黑/对方不收陌生人消息这些状态,
 *    不改权限、关系或时机的话,重试一万次都不会成功,劝人重试是误导;
 * 2. 这些是产品预期内的结果,不进 Sentry。与 shouldReportHttpFailure 对 4xx 的
 *    取舍同一条线:预期内的拒绝报上去只有噪音,还会把配额挤掉。
 *
 * 反过来,不在这份清单里的(ack 超时、未连接、CHAT_INVALID_PAYLOAD、以及任何
 * 后端新加而前端还不认识的码)才是真的「出事了」:用户看通用重试提示,我们收上报。
 */
export const EXPECTED_CHAT_SEND_ERROR_CODES: ReadonlySet<string> = new Set([
  'CHAT_SENSITIVE_WORD_BLOCKED',
  'CHAT_CONVERSATION_MUTED',
  'CHAT_BLOCKED',
  'CHAT_STRANGER_NOT_ALLOWED',
  'CHAT_RATE_LIMITED',
  'CHAT_NOT_MEMBER',
  'CHAT_PEER_NOT_FOUND',
  'CHAT_CONVERSATION_NOT_FOUND',
  'CHAT_SELF_CONVERSATION',
  // 撤回/编辑走的是同一条 ack 通道、同一个 ChatSendError,拒绝原因同样是
  // 「产品预期内、重试也不会成功」(超窗、无权限、消息已不在)。少了它们,
  // 屏幕上显示的就是原样的服务端文本或者裸的错误码字符串。
  'CHAT_REVOKE_WINDOW_EXPIRED',
  'CHAT_REVOKE_FORBIDDEN',
  'CHAT_EDIT_WINDOW_EXPIRED',
  'CHAT_EDIT_FORBIDDEN',
  'CHAT_MESSAGE_NOT_FOUND',
  // 阅后即焚会话里的媒体不可转发:服务端策略,重试同样不会成功。
  'CHAT_FORWARD_FORBIDDEN',
]);

/** 敏感词命中判定(替代 OpenIM 73001 的 isSensitiveWordBlockedError)。 */
export function isChatSendBlockedBySensitiveWord(error: unknown): boolean {
  return (
    error instanceof ChatSendError &&
    error.code === 'CHAT_SENSITIVE_WORD_BLOCKED'
  );
}

/**
 * 发送失败 → 一句可展示的文案。
 *
 * 用全局 i18n.t 而非组件 t —— 本函数在 catch 回调里按调用时机取当前语言,
 * 不在渲染期。
 */
export function getChatSendErrorMessage(
  error: unknown,
  fallback: string,
): string {
  // error.message 是硬编码中文的开发者兜底 —— 直接上屏的话,英/西/日/韩
  // 用户被信用分拦下时看到的是一句中文。按当前语言重新取词条。
  if (error instanceof CreditPolicyError) {
    return getCreditPolicyMessage(error);
  }

  if (error instanceof Error && error.name === 'TempChatUnavailableError') {
    return i18n.t('tempChats.expiredNow', {
      defaultValue: '该临时聊天已过期。',
    });
  }

  // 只透出上传模块自己构造、且已经去掉签名 URL / 对象 key / request id 的
  // 安全文案。普通 Error 与服务端原始 message 仍然一律使用 fallback。
  if (error instanceof Error && error.name === 'StorageUploadError') {
    return error.message;
  }

  if (error instanceof ChatSendError) {
    // 敏感词有自己的既有词条(比 serverErrors 那条更贴聊天场景)。
    if (isChatSendBlockedBySensitiveWord(error)) {
      return i18n.t('chat.detail.sensitiveWordBlocked', {
        defaultValue: '消息包含敏感词，已被屏蔽',
      });
    }
    if (
      EXPECTED_CHAT_SEND_ERROR_CODES.has(error.code) &&
      isKnownServerErrorCode(error.code)
    ) {
      // 未知 code 一律不展示服务端 message —— 那可能是内部错误文本。
      return i18n.t(`serverErrors.${error.code}`, { defaultValue: fallback });
    }
    // 未知 ack code 在 release 里不能把服务端 message 原样上屏；开发包则保留
    // 结构化 code，便于在真机/模拟器上区分 payload、连接与权限问题。
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      return `${fallback} (${error.code})`;
    }
  }

  return fallback;
}

/**
 * 高频路径的上报去重:按「消息类型 + 错误码」每个 app 生命周期只报一次。
 * 发送是最高频的操作,服务端一旦持续性故障,按次上报能用「用户数 × 发送次数」
 * 把配额瞬间烧穿,后面真正的新问题反而发不出去(与 credit-policy 的
 * reportGateEventOnce、通知链路的 report-failure 同一套取舍)。
 */
const reportedSendFailures = new Set<string>();

/** 测试隔离用。 */
export function resetChatSendFailureTelemetry(): void {
  reportedSendFailures.clear();
}

/**
 * 生产可观测性:发送失败在这里(且只在这里)进 Sentry。
 *
 * 拆栈前旧的 reportSend 包装器会上报每一次发送拒绝,迁移后这条最关键的链路
 * 只剩 __DEV__ 的 console.warn —— release 包里 ack 超时和服务端持续拒绝
 * 完全没有信号,「全网发不出消息」和「某个用户网不好」看起来一模一样。
 *
 * 只带三样东西:操作名、消息类型(固定枚举)、白名单内的错误码。
 * 消息正文、d(投递幂等键)、conversationId 一律不带 —— 前者是用户内容,
 * 后两者是可关联到人的标识符,诊断价值远不及泄漏代价。
 */
export function reportChatSendFailure(
  messageType: string,
  error: unknown,
): void {
  const code =
    error instanceof ChatSendError ? error.code : 'CHAT_UNKNOWN_FAILURE';
  // 预期内的策略拒绝(禁言/拉黑/限流…)不是故障,用户那侧已经拿到确切原因。
  if (EXPECTED_CHAT_SEND_ERROR_CODES.has(code)) return;

  const key = `${messageType}:${code}`;
  if (reportedSendFailures.has(key)) return;
  reportedSendFailures.add(key);

  reportError(new Error(`chat send failed: ${code}`), {
    operation: 'chatSend',
    kind: messageType,
    code,
  });
}
