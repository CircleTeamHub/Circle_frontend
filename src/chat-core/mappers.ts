import i18n from '@/i18n';
import { normalizeMediaUrl } from '@/services/api/utils';
import { getLocalizedDateTimeLocale } from '@/utils/locale';
import type { Conversation } from '@/types';
import type { ChatConversationDto, ChatMessageDto } from './protocol';

/**
 * chat-core DTO → UI 类型的映射(替代 src/im/mappers 的会话侧)。
 * UI `Conversation` 形状不变,聊天列表组件零改动。
 */

function tPreview(
  key: string,
  fallback: string,
  params?: Record<string, string>,
): string {
  const full = `im.preview.${key}`;
  const value = i18n.t(full, params);
  return value === full ? fallback : value;
}

/** 列表一行的长度上限(与 file 分支同口径)。 */
const PREVIEW_FIELD_MAX = 60;

/**
 * 带插值的卡片预览。
 *
 * `im.preview.note` 这类词条本体是「[笔记] {{title}}」—— 只给 key 不给值的话
 * i18next 会把 `{{title}}` **原样**留在结果里(defaultValue 只在 key 缺失时才
 * 用得上,而这些 key 都是存在的),列表上就显示成「[笔记] {{title}}」。
 * 值缺失/不是字符串时退回不带占位的纯标签,而不是留一个空插值。
 *
 * 兜底同样要过 i18n(codex review 修正)。原来是 `if (!text) return fallback`
 * 直接吐硬编码中文,于是英/日/韩/西语用户遇到旧数据或字段残缺的卡片时,会话
 * 列表里冒出一行中文标签。改成拿同一条词条、插一个空值再 trim ——
 * 五种语言的模板占位符都在末尾,裁掉即得纯标签(「[Note] {{title}}」→「[Note]」)。
 * 硬编码的 fallback 退居真正的最后一道:词条本身缺失时才用得上。
 */
function tCardPreview(
  key: string,
  fallback: string,
  name: string,
  raw: unknown,
): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return tPreview(key, fallback, { [name]: '' }).trim() || fallback;
  const clamped =
    text.length > PREVIEW_FIELD_MAX
      ? `${text.slice(0, PREVIEW_FIELD_MAX)}…`
      : text;
  return tPreview(key, `${fallback} ${clamped}`, { [name]: clamped }).trim();
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
    case 'video':
      return tPreview('video', '[视频]');
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
      return tCardPreview('note', '[笔记]', 'title', message.content['title']);
    case 'verification-card':
      return tCardPreview(
        'verification',
        '[验证消息]',
        'name',
        message.content['applicantName'],
      );
    case 'plaza-post-card':
      return tCardPreview(
        'plazaPost',
        '[广场帖]',
        'title',
        message.content['title'],
      );
    case 'friend-card':
      return tCardPreview('card', '[卡片]', 'name', message.content['nickname']);
    case 'circle-card':
      return tCardPreview('card', '[卡片]', 'name', message.content['name']);
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
    // 圈子群名走 Circle;独立群聊(无 circleId)用会话自己的 name,
    // 空群名兜底通用「群聊」标题(微信语义,建群可以不起名)。
    name =
      dto.circle?.name ??
      (dto.name?.trim() ||
        i18n.t('messages.newGroupDefaultName', { defaultValue: '群聊' }));
    avatarRaw = dto.circle?.avatarUrl ?? null;
    // 圈子群的 sourceID = 圈子 id(圈子详情/成员目录都按它取);
    // 独立群聊没有圈子,sourceID = 会话 id。
    sourceID = dto.circleId ?? dto.id;
  } else if (isDirectLike) {
    // SUPPORT 也是一对一:对端就是客服账号,展示与跳转都按单聊走。
    name = dto.peer?.nickname ?? '';
    avatarRaw = dto.peer?.avatarUrl ?? null;
    sourceID = dto.peer?.id ?? '';
  } else {
    // TEMP 没有固定对端，但有自己的稳定房间名。绝不能拿末条发送者当标题：
    // 房主发完消息后列表会看起来像「和自己聊天」，访客发言又会让房名反复变化。
    // 通用标题兜底兼容 App 先于后端发布的短暂窗口。
    name =
      dto.tempChat?.title.trim() ||
      i18n.t('tempChats.title', { defaultValue: '临时群聊' });
    avatarRaw = null;
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
    isTempChat: dto.type === 'TEMP',
    pinned: dto.pinned,
    muted: dto.muted,
  };
}
