/**
 * local-db 的 Web 平台桩。
 *
 * 真实现(local-db.ts)依赖 expo-sqlite,而它的 web 构建要拉 wa-sqlite.wasm,
 * `expo export --platform web` 解析不了直接把 CI 打红。Web 端本来就没有
 * 「冷启动秒开 / 离线翻历史」的诉求(会话随开随拉),所以这里给出同名同签名的
 * 全空实现:init 返回 false,读全空、写全吞 —— 调用方对「本地库不可用」的
 * 降级路径(纯内存 + REST)在原生端已经是一等公民,Web 走的就是那条路。
 *
 * ⚠️ 与 local-db.ts 的导出面必须保持一致(Metro 按平台择档,tsc 两份都查);
 * 那边加导出这边要同步补,不然 Web 构建在 import 处直接失败。
 */
import type { ChatConversationDto, ChatMessageDto } from './protocol';

export async function initChatLocalDb(_userId: string): Promise<boolean> {
  return false;
}

export async function closeChatLocalDb(): Promise<void> {}

export async function persistLocalConversations(
  _conversations: ChatConversationDto[],
): Promise<void> {}

export async function upsertLocalConversation(
  _conversation: ChatConversationDto,
): Promise<void> {}

export async function removeLocalConversation(
  _conversationId: string,
): Promise<void> {}

export async function readLocalConversations(): Promise<ChatConversationDto[]> {
  return [];
}

export async function persistLocalMessages(
  _conversationId: string,
  _incoming: ChatMessageDto[],
): Promise<void> {}

export async function deleteLocalMessage(
  _conversationId: string,
  _messageId: string,
): Promise<void> {}

export async function clearLocalConversationMessages(
  _conversationId: string,
): Promise<void> {}

export async function deleteLocalMessagesBelow(
  _conversationId: string,
  _height: number,
): Promise<void> {}

export async function readRecentLocalMessages(
  _conversationId: string,
  _limit: number,
): Promise<ChatMessageDto[]> {
  return [];
}

export async function getLocalSyncState(
  _conversationId: string,
): Promise<{ minHeight: number; maxHeight: number } | null> {
  return null;
}

export async function searchLocalChatMessages(
  _keyword: string,
  _limit: number,
): Promise<ChatMessageDto[]> {
  return [];
}

export interface OutboxEntry {
  d: string;
  conversationId: string;
  payload: {
    conversationId: string;
    type: string;
    content: Record<string, unknown>;
    d: string;
    replyToId?: string;
  };
  createdAt: string;
}

export async function outboxUpsert(_entry: OutboxEntry): Promise<void> {}

export async function outboxDelete(_d: string): Promise<void> {}

export async function outboxList(): Promise<OutboxEntry[]> {
  return [];
}

export async function pendingReadUpsert(
  _conversationId: string,
  _height: number,
): Promise<void> {}

export async function pendingReadDelete(
  _conversationId: string,
): Promise<void> {}

export async function pendingReadsList(): Promise<
  { conversationId: string; height: number }[]
> {
  return [];
}

export async function wipeChatLocalDb(): Promise<void> {}
