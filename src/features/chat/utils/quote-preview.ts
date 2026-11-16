import type { TFunction } from 'i18next';
import type { ChatMessage } from '@/types';
import { buildQuotePreviewText } from './chat-send-payloads';

/**
 * 引用块右侧的缩略图。key 是存储 object key(签名地址每小时轮换,按 key 缓存
 * 才不会过一个窗口就整张重下);本地地址不带 key,由调用方按 remoteCacheKey 判定。
 */
export interface QuoteThumbnail {
  uri: string;
  key?: string;
  video: boolean;
}

/**
 * 被引用原消息能给出的缩略图:图片 / 视频封面 / 笔记与活动卡片的封面。
 * 地址都来自原消息自己已经过签名与白名单的字段,这里不另造地址;过期媒体不给。
 */
export function quoteThumbnail(source: ChatMessage): QuoteThumbnail | null {
  if (source.mediaExpired) return null;
  switch (source.type) {
    case 'image': {
      if (source.imageThumbUrl) {
        return { uri: source.imageThumbUrl, key: source.imageThumbKey, video: false };
      }
      return source.imageUrl
        ? { uri: source.imageUrl, key: source.imageKey, video: false }
        : null;
    }
    case 'video':
      return source.videoThumbUrl
        ? { uri: source.videoThumbUrl, key: source.videoThumbKey, video: true }
        : null;
    case 'note-card': {
      const uri = source.noteCard?.coverUrl ?? source.noteCard?.previewUrls?.[0];
      return uri ? { uri, video: false } : null;
    }
    case 'plaza-post-card': {
      const uri = source.plazaPostCard?.coverUrl;
      return uri ? { uri, video: false } : null;
    }
    default:
      return null;
  }
}

/** 原消息在本页、能点开大图的类型(与会话查看器收录的条件一致)。 */
export function canOpenQuotedMedia(source: ChatMessage): boolean {
  if (source.type === 'video') return Boolean(source.videoUrl);
  return source.type === 'image' && Boolean(source.imageUrl || source.imageThumbUrl);
}

/**
 * 引用块文字。原消息在本页时按它本地生成(带笔记标题、名片昵称等,且跟着语言走);
 * 图片 / 视频有缩略图就只留「发送者:」,缩略图本身就是内容(与微信一致)。
 * 不在本页时只能用服务端快照里那行通用摘要(「[图片]」「[笔记]」)。
 */
export function quoteDisplayText(
  message: Pick<ChatMessage, 'quotedText' | 'quoteSenderName'>,
  source: ChatMessage | undefined,
  t: TFunction,
): string {
  if (!source) return message.quotedText ?? '';
  const name = message.quoteSenderName;
  // 有缩略图的图片 / 视频、整张展开的笔记卡片:内容自己会说话,文字只留发送者。
  const contentSpeaks =
    ((source.type === 'image' || source.type === 'video') && quoteThumbnail(source)) ||
    (source.type === 'note-card' && source.noteCard);
  if (contentSpeaks) return name ? `${name}:` : '';
  const preview = buildQuotePreviewText(source, t);
  return name ? `${name}: ${preview}` : preview;
}
