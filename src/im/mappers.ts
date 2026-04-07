/**
 * im/mappers.ts — OpenIM SDK 原始类型 → UI 类型映射
 *
 * - mapConversationItemToUI：ConversationItem → Conversation（会话列表行数据）
 * - mapMessageItemToChatMessage：MessageItem → ChatMessage（聊天气泡数据）
 * - getMessagePreview：从 MessageItem 提取消息预览文本（用于会话列表最后一条消息）
 */
import type { Conversation, ChatMessage } from '@/types';
import {
  MessageType,
  SessionType,
  type ConversationItem,
  type MessageItem,
} from '@openim/rn-client-sdk';

// 将毫秒时间戳格式化为显示文本：今天显示时间，昨天显示"昨天"，更早显示日期
// 注意：timestamp <= 0 视为无效值，返回空字符串
function formatTimestamp(timestamp: number) {
  if (timestamp == null || timestamp <= 0) {
    return '';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天';
  }

  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

// ConversationItem.latestMsg 是 JSON 字符串，需要解析后才能提取预览文本
// 解析失败时返回 null，上层会 fallback 到原始字符串
function parseLatestMessage(latestMsg: string) {
  if (!latestMsg) {
    return null;
  }

  try {
    return JSON.parse(latestMsg) as MessageItem;
  } catch {
    return null;
  }
}

export function getMessagePreview(message: MessageItem | null, fallback = '') {
  if (!message) {
    return fallback;
  }

  switch (message.contentType) {
    case MessageType.TextMessage:
      return message.textElem?.content ?? fallback;
    case MessageType.PictureMessage:
      return '[图片]';
    case MessageType.VideoMessage:
      return '[视频]';
    case MessageType.VoiceMessage:
      return '[语音]';
    case MessageType.FileMessage:
      return '[文件]';
    case MessageType.LocationMessage:
      return message.locationElem?.description ?? '[位置]';
    case MessageType.TypingMessage:
      return '[正在输入]';
    default:
      return fallback || '[消息]';
  }
}

export function mapConversationItemToUI(item: ConversationItem): Conversation {
  const latestMessage = parseLatestMessage(item.latestMsg);

  return {
    id: item.conversationID,
    sourceID:
      item.conversationType === SessionType.Group ? item.groupID : item.userID,
    name: item.showName,
    message: getMessagePreview(latestMessage, item.latestMsg),
    time: formatTimestamp(item.latestMsgSendTime),
    avatarUrl: item.faceURL || undefined,
    unreadCount: item.unreadCount,
    conversationType:
      item.conversationType === SessionType.Group ? 'group' : 'private',
  };
}

export function mapMessageItemToChatMessage(
  item: MessageItem,
  currentUserID: string | null
): ChatMessage | null {
  if (item.contentType === MessageType.TypingMessage) {
    return null;
  }

  const base = {
    id: item.clientMsgID,
    time: formatTimestamp(item.sendTime),
  };

  if (item.contentType === MessageType.LocationMessage) {
    return {
      ...base,
      type: 'location',
      locationTitle: item.locationElem?.description ?? '位置消息',
      locationAddress: item.locationElem?.description ?? '未知位置',
    };
  }

  const isSent = item.sendID === currentUserID;
  return {
    ...base,
    type: isSent ? 'sent' : 'received',
    text: getMessagePreview(item, item.content),
    // 仅接收到的消息携带 senderName，优先用昵称，没有则 fallback 到 sendID
    senderName: isSent ? undefined : (item.senderNickname || item.sendID),
  };
}
