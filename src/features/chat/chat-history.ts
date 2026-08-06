import {
  MessageType,
  type MessageItem,
} from '@openim/rn-client-sdk';
import i18n from '@/i18n';
import { getChatMessagePreview } from '@/chat-core/mappers';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import { getMessagePreview } from '@/im/mappers';

function chatHistoryDateLocale() {
  return getLocalizedDateTimeLocale(i18n.language);
}

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
    title:
      typeof params.title === 'string' ? params.title : i18n.t('chat.history.title'),
  } satisfies ChatHistoryRouteParams;
}

export function formatChatHistoryTime(sendTime: number) {
  if (!sendTime) {
    return '';
  }

  return new Date(sendTime).toLocaleString(chatHistoryDateLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 「当天聊天记录」结果页的标题：把 'YYYY-MM-DD' 渲染成本地化长日期（如 2026年7月4日）。
export function formatChatHistoryDateTitle(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) {
    return i18n.t('chat.history.dateTitle');
  }
  return parsed.toLocaleDateString(chatHistoryDateLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatChatHistoryMonth(sendTime: number) {
  if (!sendTime) {
    return '';
  }

  return new Date(sendTime).toLocaleString(chatHistoryDateLocale(), {
    year: 'numeric',
    month: 'long',
  });
}

/** chat-core DTO 版标题(预览文案复用 chat-core mappers,与列表页同源)。 */
export function getChatMessageDtoTitle(message: ChatMessageDto): string {
  return getChatMessagePreview(message);
}

/** chat-core DTO 版时间(ISO 字符串 → 与旧版同格式)。 */
export function formatChatHistoryTimeIso(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatChatHistoryTime(ms) : '';
}

export function getChatHistoryMessageTitle(message: MessageItem) {
  switch (message.contentType) {
    case MessageType.PictureMessage:
      return i18n.t('chat.media.image', { defaultValue: '图片' });
    case MessageType.VideoMessage:
      return i18n.t('chat.media.video', { defaultValue: '视频' });
    case MessageType.FileMessage:
      return (
        message.fileElem?.fileName ||
        i18n.t('im.preview.file', { defaultValue: '[文件]' })
      );
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
