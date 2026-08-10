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
  if (message.revokedAt) return tPreview('revoked', '[消息已撤回]');
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
    case 'file': {
      // 文件历史页整列都靠这个标题区分条目 —— 没有 file 分支的话每一行都是
      // 通用的「[消息]」,同一个会话里的多个文件在列表里完全无法辨认
      // (被替换掉的 OpenIM 映射是显示文件名的)。
      const name = message.content['fileName'];
      if (typeof name !== 'string' || name.trim().length === 0) {
        return tPreview('file', '[文件]');
      }
      const trimmed = name.trim();
      // 文件名是对端可控文本,列表里截断,别让一条超长名字撑坏整行。
      return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    }
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

/**
 * 会话 DTO → 列表项。四种会话类型要分开对待,不能拿 `type !== 'DIRECT'` 一刀切:
 * circle 只在 GROUP 上有值,TEMP / SUPPORT 都是 null。当成圈子群处理的话它们会
 * 拿到空名字空头像、sourceID 退化成 conversation id、混进群聊筛选,
 * 点进去还按「圈子群」的语义走(查圈子详情、成员目录),整条路都是错的。
 */
export function mapChatConversationToUI(dto: ChatConversationDto): Conversation {
  const isCircleGroup = dto.type === 'GROUP';
  const isDirectLike = dto.type === 'DIRECT' || dto.type === 'SUPPORT';

  let name: string;
  let avatarRaw: string | null;
  let sourceID: string;
  if (isCircleGroup) {
    name = dto.circle?.name ?? '';
    avatarRaw = dto.circle?.avatarUrl ?? null;
    // 圈子群的 sourceID = 圈子 id(圈子详情/成员目录都按它取)。
    sourceID = dto.circleId ?? dto.id;
  } else if (isDirectLike) {
    // SUPPORT 也是一对一:对端就是客服账号,展示与跳转都按单聊走。
    name = dto.peer?.nickname ?? '';
    avatarRaw = dto.peer?.avatarUrl ?? null;
    sourceID = dto.peer?.id ?? '';
  } else {
    // TEMP:临时房没有圈子也没有固定对端,名字回落到末条消息的发送者,
    // sourceID 用 conversation id —— 它本来就只在自己这条会话里有意义。
    name = dto.lastMessage?.sender?.nickname ?? '';
    avatarRaw = dto.lastMessage?.sender?.avatarUrl ?? null;
    sourceID = dto.id;
  }

  return {
    id: dto.id,
    sourceID,
    name,
    message: getChatMessagePreview(dto.lastMessage),
    time: formatChatTimestamp(dto.lastMessageAt),
    avatarUrl: normalizeMediaUrl(avatarRaw) ?? undefined,
    unreadCount: dto.unreadCount,
    // 群语义(成员目录、@提及、群设置)只属于圈子群与临时房这种多人会话;
    // SUPPORT 走单聊 UI。
    conversationType: isCircleGroup || dto.type === 'TEMP' ? 'group' : 'private',
    pinned: dto.pinned,
    muted: dto.muted,
  };
}
