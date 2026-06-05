import {
  MessageType,
  type AttachedInfoElem,
  type MessageItem,
} from '@openim/rn-client-sdk';
import { apiClient } from '@/services/api/client';

export type RestorableMessageDto = {
  clientMsgID: string;
  serverMsgID: string;
  sendID: string;
  recvID: string;
  groupID: string;
  senderNickname: string;
  senderFaceUrl: string;
  msgFrom?: number;
  sessionType: number;
  contentType: number;
  senderPlatformID?: number;
  status: number;
  seq: number;
  sendTime: number;
  createTime: number;
  content: string;
  attachedInfo: string;
  ex: string;
  isRead: boolean;
};

export type ChatHistoryMessagePage = {
  conversationID: string;
  messages: RestorableMessageDto[];
  hasMore: boolean;
  nextBeforeSeq: number | null;
  serverMinSeq: number | null;
  serverMaxSeq: number | null;
};

export async function fetchRestorableConversationMessages(params: {
  conversationID: string;
  limit?: number;
  beforeSeq?: number | null;
}) {
  const { conversationID, limit = 100, beforeSeq } = params;
  const pageSize = Math.max(1, Math.min(200, Math.floor(Number(limit) || 100)));
  const query = new URLSearchParams({ limit: String(pageSize) });
  if (beforeSeq != null) {
    query.set('beforeSeq', String(beforeSeq));
  }

  const page = await apiClient<unknown>(
    `/chat-history/conversations/${encodeURIComponent(conversationID)}/messages?${query.toString()}`,
  );
  return normalizeChatHistoryMessagePage(page, conversationID);
}

export function toOpenIMMessageItem(
  message: RestorableMessageDto,
): MessageItem {
  const contentObject = parseJsonObject(message.content);
  return {
    clientMsgID: message.clientMsgID,
    serverMsgID: message.serverMsgID,
    sendID: message.sendID,
    recvID: message.recvID,
    groupID: message.groupID,
    senderNickname: message.senderNickname,
    senderFaceUrl: message.senderFaceUrl,
    msgFrom: message.msgFrom ?? 100,
    sessionType: message.sessionType,
    contentType: message.contentType,
    senderPlatformID: message.senderPlatformID ?? 0,
    status: message.status,
    seq: message.seq,
    sendTime: message.sendTime,
    createTime: message.createTime,
    content: message.content,
    attachedInfo: message.attachedInfo,
    attachedInfoElem: parseAttachedInfoElem(message.attachedInfo),
    ex: message.ex,
    isRead: message.isRead,
    ...resolveMessageContentElements(message, contentObject),
  } as unknown as MessageItem;
}

function normalizeChatHistoryMessagePage(
  value: unknown,
  fallbackConversationID: string,
): ChatHistoryMessagePage {
  const raw = isRecord(value) ? value : {};
  return {
    conversationID: toStringValue(raw.conversationID, fallbackConversationID),
    messages: Array.isArray(raw.messages)
      ? raw.messages
          .map(normalizeRestorableMessage)
          .filter((message): message is RestorableMessageDto => message != null)
      : [],
    hasMore: raw.hasMore === true,
    nextBeforeSeq: toNullableNumber(raw.nextBeforeSeq),
    serverMinSeq: toNullableNumber(raw.serverMinSeq),
    serverMaxSeq: toNullableNumber(raw.serverMaxSeq),
  };
}

function normalizeRestorableMessage(
  value: unknown,
): RestorableMessageDto | null {
  if (!isRecord(value)) return null;
  const clientMsgID = toStringValue(value.clientMsgID);
  if (!clientMsgID) return null;

  return {
    clientMsgID,
    serverMsgID: toStringValue(value.serverMsgID),
    sendID: toStringValue(value.sendID),
    recvID: toStringValue(value.recvID),
    groupID: toStringValue(value.groupID),
    senderNickname: toStringValue(value.senderNickname),
    senderFaceUrl: toStringValue(value.senderFaceUrl),
    msgFrom: toOptionalNumber(value.msgFrom),
    sessionType: toNumberValue(value.sessionType),
    contentType: toNumberValue(value.contentType),
    senderPlatformID: toOptionalNumber(value.senderPlatformID),
    status: toNumberValue(value.status),
    seq: toNumberValue(value.seq),
    sendTime: toNumberValue(value.sendTime),
    createTime: toNumberValue(value.createTime),
    content: toStringValue(value.content),
    attachedInfo: toStringValue(value.attachedInfo),
    ex: toStringValue(value.ex),
    isRead: value.isRead === true,
  };
}

function resolveMessageContentElements(
  message: RestorableMessageDto,
  contentObject: Record<string, unknown> | null,
) {
  if (message.contentType === MessageType.TextMessage) {
    return {
      textElem: {
        content:
          typeof contentObject?.content === 'string'
            ? contentObject.content
            : message.content,
      },
    };
  }

  if (!contentObject) return {};

  switch (message.contentType) {
    case MessageType.PictureMessage:
      return { pictureElem: contentObject };
    case MessageType.VoiceMessage:
      return { soundElem: contentObject };
    case MessageType.VideoMessage:
      return { videoElem: contentObject };
    case MessageType.FileMessage:
      return { fileElem: contentObject };
    case MessageType.AtTextMessage:
      return { atTextElem: contentObject };
    case MessageType.CardMessage:
      return { cardElem: contentObject };
    case MessageType.LocationMessage:
      return { locationElem: contentObject };
    case MessageType.CustomMessage:
      return { customElem: contentObject };
    case MessageType.FaceMessage:
      return { faceElem: contentObject };
    case MessageType.QuoteMessage:
      return { quoteElem: contentObject };
    default:
      return {};
  }
}

function parseAttachedInfoElem(attachedInfo: string): AttachedInfoElem {
  if (!attachedInfo) return {} as AttachedInfoElem;
  return (parseJsonObject(attachedInfo) ?? {}) as AttachedInfoElem;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toStringValue(value: unknown, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function toNumberValue(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function toOptionalNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : undefined;
}

function toNullableNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}
