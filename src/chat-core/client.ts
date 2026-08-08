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
  const epoch = useAuthStore.getState().sessionEpoch;
  const dto = await createDirectChatConversation(peerUserId);
  // 切号后落地的在途响应不写进新账号的 store。
  if (useAuthStore.getState().sessionEpoch === epoch) {
    useChatStore.getState().upsertConversation(dto);
  }
  return { conversationID: dto.id };
}

/** 取或建圈子群聊(圈子详情/列表入口;进圈后首次调用触发座位同步)。 */
export async function ensureCircleConversation(
  circleId: string,
): Promise<EnsuredConversation> {
  const epoch = useAuthStore.getState().sessionEpoch;
  const dto = await createCircleChatConversation(circleId);
  if (useAuthStore.getState().sessionEpoch === epoch) {
    useChatStore.getState().upsertConversation(dto);
  }
  return { conversationID: dto.id };
}

/**
 * 历史翻页游标:会话 id → 下一页的 beforeHeight。
 * null = 已到头(没有更早的了);缺键 = 还没拉过首页。
 * 原来首页的 nextBeforeHeight 被直接丢掉,超过一页的会话就再也翻不到
 * 更早的消息,搜索也跳不到首页之外的目标。
 */
const historyCursors = new Map<string, number | null>();
/** 同一会话的翻页请求串行化,避免连续触底打出重复的一页。 */
const inFlightPages = new Map<string, Promise<void>>();

/** 进入会话时的历史拉取(最新一页),并记下继续向前翻的游标。 */
export async function loadConversationMessages(
  conversationId: string,
): Promise<void> {
  const page = await loadChatHistory(conversationId);
  historyCursors.set(conversationId, page.nextBeforeHeight);
}

/** 是否还有更早的消息可翻(UI 据此决定是否显示加载指示)。 */
export function hasMoreHistory(conversationId: string): boolean {
  return historyCursors.get(conversationId) != null;
}

/**
 * 继续向前翻一页(inverted 列表触底时调用)。
 * 已到头 / 首页还没拉 / 同会话已有在途请求时都是安全的 no-op。
 */
export function loadOlderConversationMessages(
  conversationId: string,
): Promise<void> {
  const cursor = historyCursors.get(conversationId);
  if (cursor == null) return Promise.resolve();
  const inFlight = inFlightPages.get(conversationId);
  if (inFlight) return inFlight;
  const request = loadChatHistory(conversationId, { beforeHeight: cursor })
    .then((page) => {
      historyCursors.set(conversationId, page.nextBeforeHeight);
    })
    .finally(() => {
      inFlightPages.delete(conversationId);
    });
  inFlightPages.set(conversationId, request);
  return request;
}

/** 退出会话 / 登出时丢掉游标,下次进入重新从最新一页开始。 */
export function resetHistoryCursor(conversationId?: string): void {
  if (conversationId === undefined) {
    historyCursors.clear();
    inFlightPages.clear();
    return;
  }
  historyCursors.delete(conversationId);
  inFlightPages.delete(conversationId);
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
    const failed = useChatStore.getState();
    failed.markMessageFailed(options.conversationId, d);
    // 乐观写入已经把会话预览换成了这条消息;发送失败后只标时间线是不够的,
    // 会话列表会一直把「服务端可能根本没有」的内容当作最新消息展示。
    failed.revertConversationPreview(options.conversationId);
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
