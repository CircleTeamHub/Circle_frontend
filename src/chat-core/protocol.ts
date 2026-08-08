/**
 * 自研聊天线上协议（与 circle_be src/chat/chat.constants.ts + chat.types.ts 镜像）。
 * 事件名与载荷字段是跨仓契约：改动必须两仓同步，
 * test/chat-core-protocol-contract.test.js 在双仓并排检出时会对齐校验。
 */

export const CHAT_WS_PATH = '/chat-ws';

export const CHAT_EVENTS = {
  /** 客户端 → 服务端：发消息（带 ack） */
  send: 'chat:send',
  /** 双向：已读水位（客户端上报带 ack；服务端广播成员推进） */
  read: 'chat:read',
  /** 双向：正在输入 */
  typing: 'chat:typing',
  /** 服务端 → 客户端：新消息 */
  message: 'chat:msg',
  /** 双向：在线状态（客户端带 ack 查询；服务端上下线广播） */
  presence: 'chat:presence',
} as const;

export interface ChatSendPayload {
  conversationId: string;
  type: string;
  content: Record<string, unknown>;
  /** 客户端生成的幂等键（deliveryId）：断线重发同一 d，服务端撞库去重。 */
  d: string;
  replyToId?: string;
}

export interface ChatReadPayload {
  conversationId: string;
  height: number;
}

export interface ChatSendAckOk {
  ok: true;
  messageId: string;
  height: number;
  d: string;
}

export interface ChatAckError {
  ok: false;
  /** circle_be ChatErrorCode 字符串码（serverErrors.<code> 词表键）。 */
  code: string;
  message?: string;
}

export type ChatSendAck = ChatSendAckOk | ChatAckError;
export type ChatReadAck = { ok: true } | ChatAckError;

export interface ChatSenderInfo {
  id: string;
  nickname: string;
  avatarUrl: string | null;
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  /** 会话内单调递增序号；排序 / 已读水位 / 补拉共用坐标系。本地乐观消息为 0。 */
  height: number;
  type: string;
  content: Record<string, unknown>;
  sender: ChatSenderInfo | null;
  replyToId: string | null;
  /** 幂等键：本地乐观消息靠它与服务端回执/广播对账替换。 */
  d: string | null;
  createdAt: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function isValidSender(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value['id']) &&
    typeof value['nickname'] === 'string' &&
    (value['avatarUrl'] === null ||
      value['avatarUrl'] === undefined ||
      typeof value['avatarUrl'] === 'string')
  );
}

/**
 * chat:msg 载荷的运行时校验。
 *
 * 分发器原来只看两个 id 就往 store 里写,于是 content 为 null、height 非法、
 * sender 形状错、createdAt 不可解析的载荷都会被原样落库。最典型的一条:
 * 一个 content=null 的文本消息进了 store,之后 MessagesScreen 渲染时
 * getChatMessagePreview 里 `message.content['text']` 抛异常 —— 那已经在
 * 分发器的 try/catch 之外了,一条畸形广播就能让消息页每次进都白屏。
 *
 * 校验的严格程度按「渲染路径会不会因此炸」来定:
 * - id/conversationId/type/content/height/createdAt 必须可用,缺一不可;
 * - sender 允许为 null(系统消息),但给了就必须是完整形状;
 * - replyToId/d 允许缺省(服务端可能省略 null),类型错才拒。
 */
export function isChatMessageDto(value: unknown): value is ChatMessageDto {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value['id'])) return false;
  if (!isNonEmptyString(value['conversationId'])) return false;
  if (!isNonEmptyString(value['type'])) return false;
  if (!isPlainObject(value['content'])) return false;
  const height = value['height'];
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 0) {
    return false;
  }
  // 时间参与排序与分组;不可解析的话日期分隔线与「昨天」判定会算出 NaN。
  const createdAt = value['createdAt'];
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    return false;
  }
  if (!isValidSender(value['sender'])) return false;
  const replyToId = value['replyToId'];
  if (replyToId !== null && replyToId !== undefined && typeof replyToId !== 'string') {
    return false;
  }
  const d = value['d'];
  if (d !== null && d !== undefined && typeof d !== 'string') return false;
  return true;
}

export interface ChatReadBroadcast {
  conversationId: string;
  userId: string;
  height: number;
}

export interface ChatTypingBroadcast {
  conversationId: string;
  userId: string;
}

/** 历史分页(REST GET /chat/conversations/:id/messages)。 */
export interface ChatHistoryPageDto {
  messages: ChatMessageDto[];
  /** 继续向前翻页的 beforeHeight;没有更早消息时为 null。 */
  nextBeforeHeight: number | null;
}

/** chat:presence 服务端广播。 */
export interface ChatPresenceBroadcast {
  userId: string;
  online: boolean;
}

/** 会话成员(GET /chat/conversations/:id/members);role 仅 GROUP 有值。 */
export interface ChatMemberDto {
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
}

export type ChatConversationType = 'DIRECT' | 'GROUP' | 'TEMP' | 'SUPPORT';

export interface ChatCircleInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ChatConversationDto {
  id: string;
  type: ChatConversationType;
  peer: ChatSenderInfo | null;
  circleId: string | null;
  /** GROUP 会话的圈子展示信息(群名/群头像);其余类型为 null。 */
  circle: ChatCircleInfo | null;
  lastMessage: ChatMessageDto | null;
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  lastMessageAt: string | null;
}
