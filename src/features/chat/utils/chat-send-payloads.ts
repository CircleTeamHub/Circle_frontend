import type { ChatMessage } from '@/types';

export type MentionTarget = {
  userID: string;
  nickname: string;
};

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

export function buildAtMessagePayload(text: string, mentions: MentionTarget[]) {
  const seen = new Set<string>();
  const atUsersInfo = mentions.flatMap((mention) => {
    if (!mention.userID || seen.has(mention.userID)) return [];
    seen.add(mention.userID);
    return [{ userID: mention.userID, nickname: mention.nickname }];
  });

  return {
    text,
    atUserList: atUsersInfo.map((item) => item.userID),
    atUsersInfo,
  };
}

export function buildQuotePreviewText(message: ChatMessage) {
  const text = message.text?.trim();
  if (text) return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  switch (message.type) {
    case 'image':
      return '[图片]';
    case 'voice':
      return '[语音]';
    case 'location':
      return message.locationTitle || '[位置]';
    case 'note-card':
      return `[笔记] ${message.noteCard?.title ?? ''}`.trim();
    case 'friend-card':
      return `[名片] ${message.friendCard?.nickname ?? ''}`.trim();
    case 'transfer-card':
      return '[转账]';
    case 'verification-card':
      return '[验证]';
    case 'circle-card':
      return `[圈子] ${message.circleCard?.name ?? ''}`.trim();
    default:
      return '[消息]';
  }
}
