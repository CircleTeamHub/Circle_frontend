import type { TFunction } from 'i18next';
import type { ChatMessage } from '@/types';

export type MentionTarget = {
  userID: string;
  nickname: string;
  isAll?: boolean;
};

// 「@所有人」候选的本地哨兵 id(仅前端内部使用;上行协议是 content.atAll)。
export const AT_ALL_USER_ID = 'AtAllTag';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MENTION_TRAILING_BOUNDARY = String.raw`(?=\s|$|[,.!?;:，。！？；：、)])`;

export function getMentionsPresentInText(
  text: string,
  mentions: MentionTarget[],
) {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    if (!mention.userID || seen.has(mention.userID)) return false;
    seen.add(mention.userID);
    const nickname = mention.nickname.trim();
    if (!nickname) return false;
    const pattern = new RegExp(
      `(^|\\s)@${escapeRegExp(nickname)}${MENTION_TRAILING_BOUNDARY}`,
    );
    return pattern.test(text);
  });
}

export function getActiveMentionQuery(text: string, cursor: number) {
  const beforeCursor = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor);
  return match ? match[1] : null;
}

export function filterMentionCandidates(
  candidates: MentionTarget[],
  query: string | null,
) {
  const normalized = (query ?? '').trim().toLowerCase();
  if (!normalized) return candidates;
  return candidates.filter((candidate) => {
    const nickname = candidate.nickname.toLowerCase();
    const userID = candidate.userID.toLowerCase();
    return nickname.includes(normalized) || userID.includes(normalized);
  });
}


// `t` is passed in (not a module-level i18n import) so this util stays pure and its
// isolated unit test doesn't have to boot the full i18n runtime. Matches note-format.ts.
export function buildQuotePreviewText(message: ChatMessage, t: TFunction) {
  const text = message.text?.trim();
  if (text) return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  switch (message.type) {
    case 'image':
      return t('im.preview.image', { defaultValue: '[图片]' });
    case 'video':
      return t('im.preview.video', { defaultValue: '[视频]' });
    case 'voice':
      return t('im.preview.voice', { defaultValue: '[语音]' });
    case 'location':
      return (
        message.locationTitle ||
        t('im.preview.location', { defaultValue: '[位置]' })
      );
    case 'note-card':
      return t('im.preview.note', {
        title: message.noteCard?.title ?? '',
        defaultValue: '[笔记] {{title}}',
      }).trim();
    case 'friend-card':
      return t('im.preview.card', {
        name: message.friendCard?.nickname ?? '',
        defaultValue: '[名片] {{name}}',
      }).trim();
    case 'transfer-card':
      return t('im.preview.transfer', { defaultValue: '[转账]' });
    case 'verification-card':
      return t('chat.preview.verification', { defaultValue: '[验证]' });
    case 'circle-card':
      return t('chat.preview.circle', {
        name: message.circleCard?.name ?? '',
        defaultValue: '[圈子] {{name}}',
      }).trim();
    default:
      return t('im.preview.default', { defaultValue: '[消息]' });
  }
}
