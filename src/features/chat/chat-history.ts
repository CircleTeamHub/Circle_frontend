import i18n from '@/i18n';
import { getChatMessagePreview } from '@/chat-core/mappers';
import { allowLocalMediaUri } from '@/chat-core/message-mappers';
import type { ChatMessageDto } from '@/chat-core/protocol';
import { allowPeerMediaUrl } from '@/services/api/utils';
import { getLocalizedDateTimeLocale } from '@/utils/locale';

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

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 聊天记录·媒体页的缩略图候选(按优先级降级:缩略图 → 原图 → 本机预览)。
 *
 * 每个候选都必须过和气泡同一份白名单。原来这里只走 normalizeMediaUrl,
 * 而它对「已经能直连的外部 https 地址」是原样返回的(只重写 dev 的 localhost)——
 * 于是对端在 content 里塞一个 https://attacker/1x1.gif 当 thumbUrl/localUri,
 * 气泡侧被 allowPeerMediaUrl 挡住了,打开媒体页却会整屏格子一次性请求出去,
 * IP、User-Agent 和精确到秒的查看时刻照样送到对方手上。
 */
export function getChatMediaThumbnailUris(message: ChatMessageDto): string[] {
  const content = message.content ?? {};
  // 视频的 url/localUri 指向媒体文件本身，不能交给 <Image> 当缩略图加载。
  // 服务端目前没有生成视频封面，所以仅在协议明确提供 thumbUrl 时展示，
  // 否则媒体宫格使用带播放标记的占位卡片。
  if (message.type === 'video') {
    const thumbnail = allowPeerMediaUrl(nonEmptyString(content['thumbUrl']));
    return thumbnail ? [thumbnail] : [];
  }
  const candidates = [
    allowPeerMediaUrl(nonEmptyString(content['thumbUrl'])),
    allowPeerMediaUrl(nonEmptyString(content['url'])),
    // localUri 只接受无 host 的本地 scheme —— 它本该只是发送方自己的文件路径。
    allowLocalMediaUri(nonEmptyString(content['localUri'])) ?? null,
  ];
  return Array.from(
    new Set(candidates.filter((value): value is string => Boolean(value))),
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
