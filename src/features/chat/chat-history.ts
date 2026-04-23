import {
  MessageType,
  type MessageItem,
} from '@openim/rn-client-sdk';
import { getMessagePreview } from '@/im/mappers';

export type ChatHistoryRouteParams = {
  conversationID: string;
  sourceID: string;
  title: string;
};

export function resolveChatHistoryRouteParams(params: {
  conversationID?: string;
  sourceID?: string;
  title?: string;
}) {
  return {
    conversationID:
      typeof params.conversationID === 'string' ? params.conversationID : '',
    sourceID: typeof params.sourceID === 'string' ? params.sourceID : '',
    title: typeof params.title === 'string' ? params.title : '聊天记录',
  } satisfies ChatHistoryRouteParams;
}

export function formatChatHistoryTime(sendTime: number) {
  if (!sendTime) {
    return '';
  }

  return new Date(sendTime).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getChatHistoryMessageTitle(message: MessageItem) {
  switch (message.contentType) {
    case MessageType.PictureMessage:
      return '图片';
    case MessageType.VideoMessage:
      return '视频';
    case MessageType.FileMessage:
      return message.fileElem?.fileName || '[文件]';
    default:
      return getMessagePreview(message, message.content);
  }
}

export function isChatHistoryMediaMessage(message: MessageItem) {
  return (
    message.contentType === MessageType.PictureMessage ||
    message.contentType === MessageType.VideoMessage
  );
}

export function isValidDateInput(value: string) {
  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }

  const ts = new Date(`${trimmed}T00:00:00`).getTime();
  return Number.isFinite(ts);
}
