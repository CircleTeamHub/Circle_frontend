import type { TFunction } from 'i18next';
import { ensureDirectConversation } from '@/chat-core/client';
import { getApiErrorMessage } from '@/services/api/errors';
import type { ChatTarget } from './types';

/** 发送前把对象落到会话 id:通讯录里还没聊过天的好友先取或建单聊。 */
export async function resolveChatTargetConversationId(target: ChatTarget): Promise<string> {
  if (target.conversationId) return target.conversationId;
  if (!target.userId) throw new Error('Chat target has neither a conversation nor a user');
  const { conversationID } = await ensureDirectConversation(target.userId);
  return conversationID;
}

export interface ResolvedChatTarget {
  target: ChatTarget;
  conversationId: string;
}

export interface ChatTargetResolveFailure {
  target: ChatTarget;
  error: unknown;
}

/**
 * 多选发送前先把所有对象都落到会话 id,再开始发任何内容。建单聊会确定性失败
 * (对方拉黑、已注销、断网):边建边发的话前几个已经收到,用户一重试就再收一份。
 */
export async function resolveChatTargets(targets: readonly ChatTarget[]): Promise<{
  resolved: ResolvedChatTarget[];
  failed: ChatTargetResolveFailure[];
}> {
  const settled = await Promise.allSettled(targets.map(resolveChatTargetConversationId));
  const resolved: ResolvedChatTarget[] = [];
  const failed: ChatTargetResolveFailure[] = [];
  settled.forEach((result, index) => {
    const target = targets[index];
    if (result.status === 'fulfilled') resolved.push({ target, conversationId: result.value });
    else failed.push({ target, error: result.reason });
  });
  return { resolved, failed };
}

/** 建会话失败的提示:点名是哪几个、按 errorCode 说原因(被拉黑/已注销),而不是一律「请重试」。 */
export function chatTargetResolveFailureMessage(
  failed: readonly ChatTargetResolveFailure[],
  t: TFunction,
  fallback: string,
): string {
  const names = failed
    .map((item) => item.target.name)
    .join(t('chat.targetPicker.nameSeparator', { defaultValue: '、' }));
  return t('chat.targetPicker.resolveFailed', {
    names,
    reason: getApiErrorMessage(failed[0]?.error, fallback),
    defaultValue: '无法发送给 {{names}}：{{reason}}',
  });
}
