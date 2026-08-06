import i18n from '@/i18n';
import { normalizeMediaUrl } from '@/services/api/utils';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import type { Conversation } from '@/types';
import type { ChatConversationDto, ChatMessageDto } from './protocol';

/**
 * chat-core DTO → UI 类型的映射(替代 src/im/mappers 的会话侧)。
 * UI `Conversation` 形状不变,聊天列表组件零改动。
 */

function tPreview(key: string, fallback: string): string {
  const full = `im.preview.${key}`;
  const value = i18n.t(full);
  return value === full ? fallback : value;
}

function tImTime(key: string, fallback: string): string {
  const full = `im.time.${key}`;
  const value = i18n.t(full);
  return value === full ? fallback : value;
}

/** 与旧 im/mappers.formatTimestamp 同规则:今天→时刻,昨天→「昨天」,更早→月/日。 */
export function formatChatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(getLocalizedDateTimeLocale(i18n.language), {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return tImTime('yesterday', '昨天');
  }
  return date.toLocaleDateString(getLocalizedDateTimeLocale(i18n.language), {
    month: 'numeric',
    day: 'numeric',
  });
}

/** 末条消息 → 列表预览文本(媒体/卡片走 im.preview.* 既有词条)。 */
export function getChatMessagePreview(message: ChatMessageDto | null): string {
  if (!message) return '';
  switch (message.type) {
    case 'text':
    case 'quote': {
      const text = message.content['text'];
      return typeof text === 'string' ? text : '';
    }
    case 'image':
      return tPreview('image', '[图片]');
    case 'voice':
      return tPreview('voice', '[语音]');
    case 'location':
      return tPreview('location', '[位置]');
    case 'transfer-card':
      return tPreview('transfer', '[转账]');
    case 'note-card':
      return tPreview('note', '[笔记]');
    case 'verification-card':
      return tPreview('verification', '[验证消息]');
    case 'plaza-post-card':
      return tPreview('plazaPost', '[广场帖]');
    case 'friend-card':
    case 'circle-card':
      return tPreview('card', '[卡片]');
    default:
      return tPreview('default', '[消息]');
  }
}

export function mapChatConversationToUI(dto: ChatConversationDto): Conversation {
  const isGroup = dto.type !== 'DIRECT';
  const name = isGroup
    ? (dto.circle?.name ?? '')
    : (dto.peer?.nickname ?? '');
  const avatarRaw = isGroup
    ? (dto.circle?.avatarUrl ?? null)
    : (dto.peer?.avatarUrl ?? null);
  return {
    id: dto.id,
    // DIRECT 的 sourceID = 对端 userID(个人资料跳转用);GROUP = 圈子 id。
    sourceID: isGroup ? (dto.circleId ?? dto.id) : (dto.peer?.id ?? ''),
    name,
    message: getChatMessagePreview(dto.lastMessage),
    time: formatChatTimestamp(dto.lastMessageAt),
    avatarUrl: normalizeMediaUrl(avatarRaw) ?? undefined,
    unreadCount: dto.unreadCount,
    conversationType: isGroup ? 'group' : 'private',
    pinned: dto.pinned,
    muted: dto.muted,
  };
}
