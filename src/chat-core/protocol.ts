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
