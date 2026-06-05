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

export type RestoreConversationMessagesResult = {
  fetched: number;
  inserted: number;
};

const inFlightRestores = new Map<
  string,
  Promise<RestoreConversationMessagesResult>
>();

export async function restoreConversationMessages(params: {
  conversationID: string;
  sourceID: string;
  sessionType: SessionType;
  maxMessages?: number;
}): Promise<RestoreConversationMessagesResult> {
  const existing = inFlightRestores.get(params.conversationID);
  if (existing) return existing;

  const restorePromise = runRestoreConversationMessages(params).finally(() => {
    if (inFlightRestores.get(params.conversationID) === restorePromise) {
      inFlightRestores.delete(params.conversationID);
    }
  });
  inFlightRestores.set(params.conversationID, restorePromise);
  return restorePromise;
}

async function runRestoreConversationMessages(params: {
  conversationID: string;
  sourceID: string;
  sessionType: SessionType;
  maxMessages?: number;
}): Promise<RestoreConversationMessagesResult> {
  const {
    conversationID,
    sourceID,
    sessionType,
    maxMessages = DEFAULT_MAX_MESSAGES,
  } = params;
  if (maxMessages <= 0) {
    return { fetched: 0, inserted: 0 };
  }

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

    const missingDtos = page.messages.filter(
      (dto) => dto.clientMsgID && !localIDs.has(dto.clientMsgID),
    );
    const missingIDs = missingDtos.map((dto) => dto.clientMsgID);
    const existingMessages =
      missingIDs.length > 0
        ? await OpenIMSDK.findMessageList([
            { conversationID, clientMsgIDList: missingIDs },
          ])
        : [];
    const existingIDs = new Set(
      Array.isArray(existingMessages)
        ? existingMessages.map((message) => message.clientMsgID).filter(Boolean)
        : [],
    );

    for (const dto of missingDtos) {
      if (existingIDs.has(dto.clientMsgID)) {
        localIDs.add(dto.clientMsgID);
        continue;
      }
      try {
        const message = toOpenIMMessageItem(dto);
        await insertLocalMessage({ message, sourceID, sessionType });
        localIDs.add(dto.clientMsgID);
        inserted += 1;
      } catch (err) {
        // 单条消息插入失败（SDK 拒绝 / 数据异常）不应中断整批恢复，
        // 否则一条坏消息会挡住它之后的所有历史。跳过它，下次打开会重试。
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(
            '[chat] restore: insert message failed, skipping',
            dto.clientMsgID,
            err,
          );
        }
      }
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
