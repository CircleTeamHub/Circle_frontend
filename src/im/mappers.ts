/**
 * im/mappers.ts — OpenIM SDK 原始类型 → UI 类型映射
 *
 * - mapConversationItemToUI：ConversationItem → Conversation（会话列表行数据）
 * - mapMessageItemToChatMessage：MessageItem → ChatMessage（聊天气泡数据）
 * - getMessagePreview：从 MessageItem 提取消息预览文本（用于会话列表最后一条消息）
 */
import type {
  Conversation,
  ChatMessage,
  NoteCardData,
  FriendCardData,
  TransferCardData,
} from '@/types';
import {
  MessageType,
  SessionType,
  type ConversationItem,
  type MessageItem,
} from '@openim/rn-client-sdk';
import { NOTE_CARD_EXTENSION, TRANSFER_CARD_EXTENSION } from '@/im/client';

// OpenIM 自动产生的系统/群通知类消息（GroupCreated / MemberInvited / RevokeMessage 等），
// 不应作为普通气泡渲染——SDK 没有公开按 base 数值区分通知的常量，这里按 enum 显式列出。
const SYSTEM_NOTIFICATION_CONTENT_TYPES = new Set<number>([
  MessageType.FriendAdded,
  MessageType.OANotification,
  MessageType.GroupCreated,
  MessageType.GroupInfoUpdated,
  MessageType.MemberQuit,
  MessageType.GroupOwnerTransferred,
  MessageType.MemberKicked,
  MessageType.MemberInvited,
  MessageType.MemberEnter,
  MessageType.GroupDismissed,
  MessageType.GroupMemberMuted,
  MessageType.GroupMemberCancelMuted,
  MessageType.GroupMuted,
  MessageType.GroupCancelMuted,
  MessageType.GroupAnnouncementUpdated,
  MessageType.GroupNameUpdated,
  MessageType.BurnMessageChange,
  MessageType.RevokeMessage,
]);

function isSystemNotification(contentType: number) {
  return SYSTEM_NOTIFICATION_CONTENT_TYPES.has(contentType);
}

function parseNoteCardPayload(data: string): NoteCardData | null {
  try {
    const raw = JSON.parse(data) as Partial<NoteCardData>;
    if (!raw || typeof raw.noteId !== 'string' || typeof raw.title !== 'string') {
      return null;
    }
    return {
      noteId: raw.noteId,
      title: raw.title,
      contentPreview: raw.contentPreview ?? null,
      coverUrl: raw.coverUrl ?? null,
      imageCount: raw.imageCount ?? 0,
      videoCount: raw.videoCount ?? 0,
      groupNames: Array.isArray(raw.groupNames) ? raw.groupNames : [],
    };
  } catch {
    return null;
  }
}

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

  if (isSystemNotification(message.contentType)) {
    if (message.contentType === MessageType.GroupCreated) return '群聊已创建';
    if (message.contentType === MessageType.MemberInvited) return '新成员加入群聊';
    if (message.contentType === MessageType.MemberQuit) return '有成员退出群聊';
    if (message.contentType === MessageType.MemberKicked) return '有成员被移出群聊';
    if (message.contentType === MessageType.GroupNameUpdated) return '群名称已更新';
    if (message.contentType === MessageType.GroupDismissed) return '群已解散';
    if (message.contentType === MessageType.RevokeMessage) return '一条消息被撤回';
    return '';
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
    case MessageType.CardMessage:
      return `[名片] ${message.cardElem?.nickname ?? ''}`.trim();
    case MessageType.CustomMessage: {
      // 卡片消息优先用结构化 data 还原预览：description 字段是发送时拼好的字符串，
      // 历史脏数据（例如 amount 缺失时拼出 "[转账] undefined 积分"）会一直跟着会话走。
      const ext = message.customElem?.extension;
      if (ext === TRANSFER_CARD_EXTENSION) {
        try {
          const raw = JSON.parse(message.customElem?.data ?? '') as Partial<TransferCardData>;
          if (typeof raw.amount === 'number' && raw.amount > 0) {
            return `[转账] ${raw.amount} 积分`;
          }
        } catch {
          // 落到通用兜底
        }
        return '[转账]';
      }
      if (ext === NOTE_CARD_EXTENSION) {
        const payload = parseNoteCardPayload(message.customElem?.data ?? '');
        if (payload) return `[笔记] ${payload.title}`;
      }
      const desc = message.customElem?.description;
      if (desc && desc.trim()) return desc;
      return '[消息]';
    }
    default:
      return '[消息]';
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
    pinned: item.isPinned === true,
  };
}

export function mapMessageItemToChatMessage(
  item: MessageItem,
  currentUserID: string | null
): ChatMessage | null {
  if (item.contentType === MessageType.TypingMessage) {
    return null;
  }

  // 系统/群通知消息不渲染为聊天气泡（创建群聊后 SDK 自动塞的 GroupCreated
  // 之前会被当成普通文本显示成 [消息] 气泡）。
  if (isSystemNotification(item.contentType)) {
    return null;
  }

  const isSent = item.sendID === currentUserID;
  const base = {
    id: item.clientMsgID,
    time: formatTimestamp(item.sendTime),
    // 发送状态/已读 状态对所有自己发出的消息都有意义；接收消息这两字段会被忽略。
    sendStatus: isSent ? (item.status as 1 | 2 | 3) : undefined,
    isRead: isSent ? Boolean(item.isRead) : undefined,
  };

  if (item.contentType === MessageType.LocationMessage) {
    return {
      ...base,
      type: 'location',
      outgoing: isSent,
      locationTitle: item.locationElem?.description ?? '位置消息',
      locationAddress: item.locationElem?.description ?? '未知位置',
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  if (item.contentType === MessageType.CustomMessage) {
    const ext = item.customElem?.extension;
    if (ext === NOTE_CARD_EXTENSION) {
      const payload = parseNoteCardPayload(item.customElem?.data ?? '');
      if (payload) {
        return {
          ...base,
          type: 'note-card',
          outgoing: isSent,
          noteCard: payload,
          senderName: isSent ? undefined : (item.senderNickname || item.sendID),
        };
      }
    }
    if (ext === TRANSFER_CARD_EXTENSION) {
      try {
        const raw = JSON.parse(item.customElem?.data ?? '') as Partial<TransferCardData>;
        if (typeof raw.amount === 'number' && raw.amount > 0) {
          return {
            ...base,
            type: 'transfer-card',
            outgoing: isSent,
            transferCard: {
              amount: raw.amount,
              message: typeof raw.message === 'string' ? raw.message : null,
            },
            senderName: isSent ? undefined : (item.senderNickname || item.sendID),
          };
        }
      } catch {
        // ignore — fall through to generic
      }
    }
  }

  if (item.contentType === MessageType.CardMessage) {
    const card = item.cardElem;
    if (card) {
      const payload: FriendCardData = {
        userID: card.userID,
        nickname: card.nickname,
        faceURL: card.faceURL,
      };
      // 业务扩展塞在 cardElem.ex 里：persona + displayIcons。
      if (card.ex) {
        try {
          const ext = JSON.parse(card.ex) as {
            persona?: string | null;
            displayIcons?: FriendCardData['displayIcons'];
          };
          payload.persona = ext.persona ?? null;
          payload.displayIcons = ext.displayIcons ?? [];
        } catch {
          // 旧版本或非法 JSON，忽略，只保留基础字段
        }
      }
      return {
        ...base,
        type: 'friend-card',
        outgoing: isSent,
        friendCard: payload,
        senderName: isSent ? undefined : (item.senderNickname || item.sendID),
      };
    }
  }

  if (item.contentType === MessageType.PictureMessage) {
    const pic =
      item.pictureElem?.bigPicture ??
      item.pictureElem?.sourcePicture ??
      item.pictureElem?.snapshotPicture;
    return {
      ...base,
      type: 'image',
      outgoing: isSent,
      imageUrl: pic?.url ?? '',
      imageWidth: pic?.width ?? undefined,
      imageHeight: pic?.height ?? undefined,
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  return {
    ...base,
    type: isSent ? 'sent' : 'received',
    text: getMessagePreview(item, item.content),
    // 仅接收到的消息携带 senderName，优先用昵称，没有则 fallback 到 sendID
    senderName: isSent ? undefined : (item.senderNickname || item.sendID),
  };
}
