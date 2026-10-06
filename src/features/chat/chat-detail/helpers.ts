import type { ChatMessage } from '@/types';
import { diagnosticErrorMessage, logClientDiagnostic } from '@/utils/client-diagnostics';
import { devWarn } from '@/utils/dev-log';
import type { ConversationKind } from './types';

// Dev-only structured log for a failed send. Never logs the message body —
// only the error and conversation kind — to avoid leaking content into logs.
//
// 发送失败的生产信号已由 chat-core/client 的 reportChatSendFailure（Sentry，按类型 +
// 错误码去重）与上传模块各自留档；这里只补一条本地面包屑 + dev 日志，不再重复上报。
export function logChatSendFailure(
  error: unknown,
  context: { kind: string; sessionType: ConversationKind; isGroupChat: boolean },
) {
  logClientDiagnostic(`chatSend.${context.kind}.failed`, {
    sessionType: context.sessionType,
    isGroupChat: context.isGroupChat,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  devWarn(`[chat] ${context.kind} send failed`, {
    name: error instanceof Error ? error.name : typeof error,
    message: diagnosticErrorMessage(error),
    ...context,
  });
}

export function getAvatarMergeKey(message: ChatMessage | undefined) {
  if (!message) return null;
  if (message.type === 'date' || message.type === 'system-notice') return null;
  if (message.outgoing || message.type === 'sent') return 'self';
  return message.senderID ? `sender:${message.senderID}` : 'peer';
}
