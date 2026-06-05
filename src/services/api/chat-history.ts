import type { AttachedInfoElem, MessageItem } from '@openim/rn-client-sdk';
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
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeSeq != null) {
    query.set('beforeSeq', String(beforeSeq));
  }

  return apiClient<ChatHistoryMessagePage>(
    `/chat-history/conversations/${encodeURIComponent(conversationID)}/messages?${query.toString()}`,
  );
}

export function toOpenIMMessageItem(
  message: RestorableMessageDto,
): MessageItem {
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
  } as unknown as MessageItem;
}

function parseAttachedInfoElem(attachedInfo: string): AttachedInfoElem {
  if (!attachedInfo) return {} as AttachedInfoElem;
  try {
    const parsed = JSON.parse(attachedInfo);
    if (parsed && typeof parsed === 'object') {
      return parsed as AttachedInfoElem;
    }
  } catch {
    return {} as AttachedInfoElem;
  }
  return {} as AttachedInfoElem;
}
