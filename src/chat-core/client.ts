import { useAuthStore } from '@/stores/authStore';
import {
  createCircleChatConversation,
  createDirectChatConversation,
  loadChatHistory,
} from './api';
import {
  ChatSendError,
  createDeliveryId,
  markConversationRead,
  sendChatMessage,
} from './socket-manager';
import { useChatStore, type StoredChatMessage } from './store';
import type { ChatMessageDto } from './protocol';

/**
 * 聊天页面向的高层 API(对齐旧 src/im/client 的调用形态,屏幕换 import 即用)。
 * 发送 = 乐观回显 → socket ack(已持久化)→ 同 d 替换;失败标记失败态。
 */

export interface EnsuredConversation {
  conversationID: string;
}

/** 取或建单聊(个人资料「发消息」等入口)。 */
export async function ensureDirectConversation(
  peerUserId: string,
): Promise<EnsuredConversation> {
  const dto = await createDirectChatConversation(peerUserId);
  useChatStore.getState().upsertConversation(dto);
  return { conversationID: dto.id };
}

/** 取或建圈子群聊(圈子详情/列表入口;进圈后首次调用触发座位同步)。 */
export async function ensureCircleConversation(
  circleId: string,
): Promise<EnsuredConversation> {
  const dto = await createCircleChatConversation(circleId);
  useChatStore.getState().upsertConversation(dto);
  return { conversationID: dto.id };
}

/** 进入会话时的历史拉取(最新一页;更早的由列表滚动翻页)。 */
export async function loadConversationMessages(
  conversationId: string,
): Promise<void> {
  await loadChatHistory(conversationId);
}

/** 已读:以本地已知的最大 height 上报水位 + 本地未读归零。 */
export function markConversationAsRead(conversationId: string): void {
  const state = useChatStore.getState();
  const messages = state.messagesByConversation[conversationId] ?? [];
  let height = 0;
  for (const message of messages) {
    if (message.height > height) height = message.height;
  }
  if (height === 0) {
    const conversation = state.conversations.find((c) => c.id === conversationId);
    height = conversation?.lastMessage?.height ?? 0;
  }
  markConversationRead(conversationId, height);
}

interface SendOptions {
  conversationId: string;
  type: string;
  content: Record<string, unknown>;
  replyToId?: string;
  /** 乐观消息上屏回调(旧 sendTextMessage onCreate 对应物)。 */
  onCreate?: (message: ChatMessageDto) => void;
}

function selfSenderInfo() {
  const user = useAuthStore.getState().user;
  return user
    ? { id: user.id, nickname: user.nickname ?? '', avatarUrl: user.avatarUrl ?? null }
    : null;
}

/**
 * 发送核心:乐观 DTO(height=0, id=local:{d})立即入库并联动会话列表;
 * ack 返回后以真 id/height 替换(store 按 d 对账);失败置失败态并抛出。
 * 断线重发语义:失败后重试应复用同一 d —— 服务端幂等约束保证不重复。
 */
export async function sendWithOptimism(
  options: SendOptions,
): Promise<ChatMessageDto> {
  const d = createDeliveryId();
  const store = useChatStore.getState();
  const optimistic: StoredChatMessage = {
    id: `local:${d}`,
    conversationId: options.conversationId,
    height: 0,
    type: options.type,
    content: options.content,
    sender: selfSenderInfo(),
    replyToId: options.replyToId ?? null,
    d,
    createdAt: new Date().toISOString(),
  };
  store.ingestMessages(options.conversationId, [optimistic]);
  store.applyIncomingMessage(optimistic);
  options.onCreate?.(optimistic);

  try {
    const ack = await sendChatMessage({
      conversationId: options.conversationId,
      type: options.type,
      content: options.content,
      d,
      replyToId: options.replyToId,
    });
    const confirmed: ChatMessageDto = {
      ...optimistic,
      id: ack.messageId,
      height: ack.height,
    };
    const next = useChatStore.getState();
    next.ingestMessages(options.conversationId, [confirmed]);
    next.applyIncomingMessage(confirmed);
    return confirmed;
  } catch (error) {
    useChatStore.getState().markMessageFailed(options.conversationId, d);
    throw error;
  }
}

export function sendTextMessage(options: {
  conversationId: string;
  text: string;
  mentions?: { userId: string; nickname: string }[];
  atAll?: boolean;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'text',
    content: {
      text: options.text,
      ...(options.mentions?.length ? { mentions: options.mentions } : {}),
      ...(options.atAll ? { atAll: true } : {}),
    },
    onCreate: options.onCreate,
  });
}

export function sendQuoteMessage(options: {
  conversationId: string;
  text: string;
  quotedText: string;
  replyToId?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'quote',
    content: { text: options.text, quotedText: options.quotedText },
    replyToId: options.replyToId,
    onCreate: options.onCreate,
  });
}

export function sendImageMessage(options: {
  conversationId: string;
  /** 上传后的 object key(经现有 /upload presign 流程),服务端读时签 URL。 */
  key: string;
  localUri?: string;
  width?: number;
  height?: number;
  thumbKey?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'image',
    content: {
      key: options.key,
      ...(options.thumbKey ? { thumbKey: options.thumbKey } : {}),
      ...(options.width ? { width: options.width } : {}),
      ...(options.height ? { height: options.height } : {}),
      ...(options.localUri ? { localUri: options.localUri } : {}),
    },
    onCreate: options.onCreate,
  });
}

export function sendVoiceMessage(options: {
  conversationId: string;
  key: string;
  duration: number;
  size?: number;
  localUri?: string;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'voice',
    content: {
      key: options.key,
      duration: options.duration,
      ...(options.size ? { size: options.size } : {}),
      ...(options.localUri ? { localUri: options.localUri } : {}),
    },
    onCreate: options.onCreate,
  });
}

export function sendLocationMessage(options: {
  conversationId: string;
  latitude: number;
  longitude: number;
  description: string;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: 'location',
    content: {
      latitude: options.latitude,
      longitude: options.longitude,
      description: options.description,
    },
  });
}

export type ChatCardType =
  | 'note-card'
  | 'friend-card'
  | 'circle-card'
  | 'transfer-card'
  | 'verification-card'
  | 'plaza-post-card';

/** 各类卡片:content 即卡片 payload 本体(渲染侧同一形状,零转换)。 */
export function sendCardMessage(options: {
  conversationId: string;
  type: ChatCardType;
  /** 卡片 payload 本体(NoteCardData 等接口类型无索引签名,收 object 再收窄)。 */
  payload: object;
  onCreate?: (message: ChatMessageDto) => void;
}): Promise<ChatMessageDto> {
  return sendWithOptimism({
    conversationId: options.conversationId,
    type: options.type,
    content: options.payload as Record<string, unknown>,
    onCreate: options.onCreate,
  });
}

/** 敏感词命中判定(替代 OpenIM 73001 的 isSensitiveWordBlockedError)。 */
export function isChatSendBlockedBySensitiveWord(error: unknown): boolean {
  return (
    error instanceof ChatSendError &&
    error.code === 'CHAT_SENSITIVE_WORD_BLOCKED'
  );
}
