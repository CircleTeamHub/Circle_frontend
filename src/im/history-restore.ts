import OpenIMSDK, {
  SessionType,
  type MessageItem,
} from '@openim/rn-client-sdk';
import {
  fetchRestorableConversationMessages,
  toOpenIMMessageItem,
} from '@/services/api/chat-history';
import { loadConversationMessages, readLocalConversationMessages } from '@/im/client';
import { useIMStore } from '@/stores/imStore';

const DEFAULT_RESTORE_LIMIT = 100;
const DEFAULT_MAX_MESSAGES = 500;

export async function restoreConversationMessages(params: {
  conversationID: string;
  sourceID: string;
  sessionType: SessionType;
  maxMessages?: number;
}) {
  const {
    conversationID,
    sourceID,
    sessionType,
    maxMessages = DEFAULT_MAX_MESSAGES,
  } = params;
  const localMessages = await readLocalConversationMessages(
    conversationID,
    DEFAULT_RESTORE_LIMIT,
  );
  const localIDs = new Set(
    localMessages.map((message) => message.clientMsgID).filter(Boolean),
  );
  let beforeSeq: number | null | undefined;
  let fetched = 0;
  let inserted = 0;

  while (fetched < maxMessages) {
    const page = await fetchRestorableConversationMessages({
      conversationID,
      limit: Math.min(DEFAULT_RESTORE_LIMIT, maxMessages - fetched),
      beforeSeq,
    });
    fetched += page.messages.length;
    if (page.messages.length === 0) {
      break;
    }

    for (const dto of page.messages) {
      if (localIDs.has(dto.clientMsgID)) {
        continue;
      }

      const existing = await OpenIMSDK.findMessageList([
        { conversationID, clientMsgIDList: [dto.clientMsgID] },
      ]);
      if (Array.isArray(existing) && existing.length > 0) {
        localIDs.add(dto.clientMsgID);
        continue;
      }

      const message = toOpenIMMessageItem(dto);
      await insertLocalMessage({ message, sourceID, sessionType });
      localIDs.add(dto.clientMsgID);
      inserted += 1;
    }

    if (!page.hasMore || page.nextBeforeSeq == null) {
      break;
    }
    beforeSeq = page.nextBeforeSeq;
  }

  if (inserted > 0) {
    await loadConversationMessages(conversationID);
  }

  return { fetched, inserted };
}

async function insertLocalMessage(params: {
  message: MessageItem;
  sourceID: string;
  sessionType: SessionType;
}) {
  const { message, sourceID, sessionType } = params;
  const currentUserID = useIMStore.getState().currentUserID;

  if (sessionType === SessionType.Group) {
    await OpenIMSDK.insertGroupMessageToLocalStorage({
      message,
      groupID: message.groupID || sourceID,
      sendID: message.sendID,
    });
    return;
  }

  const fallbackRecvID =
    message.sendID === currentUserID ? sourceID : currentUserID;
  await OpenIMSDK.insertSingleMessageToLocalStorage({
    message,
    recvID: message.recvID || fallbackRecvID || sourceID,
    sendID: message.sendID,
  });
}
