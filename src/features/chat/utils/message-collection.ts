import i18n from '@/i18n';
import type { CollectNoteSource, NoteCollectPeer } from '@/features/notes/types';
import type { CreateCollectionInput, UserCollection } from '@/services/api/collections';
import type { ChatMessage, ConversationType, FriendCardData, NoteCardData } from '@/types';

export type CollectedOpenIMMessagePayload = {
  kind: 'openim-message';
  messageID: string;
  messageType: ChatMessage['type'];
  conversationID: string;
  conversationTitle: string;
  sourceID?: string;
  conversationType?: ConversationType;
  senderID?: string;
  senderName?: string;
  time?: string;
  text?: string;
  image?: {
    url?: string;
    width?: number;
    height?: number;
  };
  voice?: {
    /**
     * 自研栈的对象存储 key。重发语音只认它 —— 消息体里从来就只放 key,
     * 读时由服务端现签 URL。sourceUrl 是那个签出来的临时地址(会过期),
     * OpenIM 时代的收藏更是指向一台已经不存在的服务,两者都推不回 key。
     */
    key?: string;
    sourceUrl?: string;
    soundPath?: string;
    duration?: number;
    dataSize?: number;
  };
  noteCard?: ChatMessage['noteCard'];
  friendCard?: ChatMessage['friendCard'];
  transferCard?: ChatMessage['transferCard'];
};

type CollectionContext = {
  conversationID: string;
  conversationTitle: string;
  sourceID?: string;
  conversationType?: ConversationType;
  /**
   * 源消息 DTO 上的语音 object key(调用方从 chat store 取)。
   * UI 层的 ChatMessage 只有签好的 voiceUrl,而重发必须要 key ——
   * 收藏时不把它一起存下来,这条收藏以后就永远发不出去。
   */
  voiceKey?: string;
};

function compactText(value: string | null | undefined, max = 80) {
  const text = value?.trim() ?? '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function getCollectionType(message: ChatMessage): CreateCollectionInput['type'] {
  if (message.type === 'voice') return 'VOICE';
  return 'MESSAGE';
}

function getCollectionTitle(message: ChatMessage) {
  if (message.type === 'voice')
    return i18n.t('chat.collection.voiceMessage', { defaultValue: '语音消息' });
  if (message.type === 'image')
    return i18n.t('chat.collection.imageMessage', { defaultValue: '图片消息' });
  if (message.type === 'location')
    return (
      message.locationTitle ||
      i18n.t('chat.collection.locationMessage', { defaultValue: '位置消息' })
    );
  if (message.type === 'friend-card') {
    return i18n.t('chat.collection.friendCard', {
      nickname:
        message.friendCard?.nickname ??
        i18n.t('chat.friend', { defaultValue: '好友' }),
      defaultValue: '名片: {{nickname}}',
    });
  }
  if (message.type === 'transfer-card')
    return i18n.t('chat.collection.transfer', { defaultValue: '积分转账' });
  return (
    compactText(message.text, 40) ||
    i18n.t('chat.collection.message', { defaultValue: '聊天消息' })
  );
}

function getCollectionSummary(message: ChatMessage) {
  if (message.type === 'voice') {
    const seconds = Math.max(1, Math.round(message.voiceDuration ?? 1));
    return i18n.t('chat.collection.secondsVoice', {
      seconds,
      defaultValue: '{{seconds}} 秒语音',
    });
  }
  if (message.type === 'image')
    return i18n.t('chat.media.image', { defaultValue: '图片' });
  if (message.type === 'location') return message.locationAddress ?? null;
  if (message.type === 'friend-card')
    return i18n.t('chat.collection.personalCard', { defaultValue: '个人名片' });
  if (message.type === 'transfer-card') {
    const amount = message.transferCard?.amount;
    return typeof amount === 'number'
      ? `${amount} ${i18n.t('common.coin', { defaultValue: '积分' })}`
      : i18n.t('chat.collection.transfer', { defaultValue: '积分转账' });
  }
  return compactText(message.text, 120) || null;
}

/**
 * 从聊天收藏笔记的来源构造：群聊带群名片（sender 记录实际分享人），
 * 私聊把会话对方作为名片主体。faceURL 仅在是合法 http(s) 地址时上送
 * （后端 DTO 做了 IsUrl 校验，本地路径/空串会被 400）。
 */
export type NoteCollectContext = CollectionContext & {
  conversationAvatarUrl?: string;
  currentUser?: { id?: string; name?: string; faceURL?: string };
};

function sanitizeFaceURL(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//.test(url) ? url : undefined;
}

function buildPeer(
  id: string | undefined,
  name: string | undefined,
  faceURL?: string,
): NoteCollectPeer | null {
  const trimmedId = id?.trim();
  if (!trimmedId) return null;
  return {
    id: trimmedId,
    // 名称兜底用 id：后端 DTO 要求 name 非空，而部分历史消息可能缺 senderName。
    name: name?.trim() || trimmedId,
    ...(sanitizeFaceURL(faceURL) ? { faceURL: sanitizeFaceURL(faceURL) } : {}),
  };
}

export function buildNoteCollectSource(
  message: ChatMessage,
  context: NoteCollectContext,
): CollectNoteSource | null {
  if (message.type !== 'note-card' || !message.noteCard) return null;
  if (!context.conversationID || !context.sourceID) return null;

  if (context.conversationType === 'group') {
    const group = buildPeer(
      context.sourceID,
      context.conversationTitle,
      context.conversationAvatarUrl,
    );
    // 群消息：接收方向带 senderID；自己发的消息回落到当前用户。
    // senderAvatarUrl 必须一起带上 —— 漏传会让群来源的分享人永远存成无头像快照，
    // 而私聊来源有头像，同一个人在笔记列表里两种样子。
    const sender =
      buildPeer(message.senderID, message.senderName, message.senderAvatarUrl) ??
      buildPeer(
        context.currentUser?.id,
        context.currentUser?.name,
        context.currentUser?.faceURL,
      );
    if (!group || !sender) return null;
    return {
      conversationType: 'group',
      conversationID: context.conversationID,
      clientMsgID: message.id,
      sender,
      group,
    };
  }

  // 私聊：名片主体固定是会话对方（“谁发给我的/在哪个会话”），
  // 即使这条笔记消息是自己转发的，跳转定位仍然落在这个会话。
  const sender = buildPeer(
    context.sourceID,
    context.conversationTitle,
    context.conversationAvatarUrl,
  );
  if (!sender) return null;
  return {
    conversationType: 'private',
    conversationID: context.conversationID,
    clientMsgID: message.id,
    sender,
  };
}

export function buildCollectionInputFromMessage(
  message: ChatMessage,
  context: CollectionContext,
): CreateCollectionInput | null {
  if (message.type === 'date') return null;
  // 笔记卡片不再进「收藏」：改走 collectNote 直接复制进「我的笔记」。
  if (message.type === 'note-card') return null;

  const payload: CollectedOpenIMMessagePayload = {
    kind: 'openim-message',
    messageID: message.id,
    messageType: message.type,
    conversationID: context.conversationID,
    conversationTitle: context.conversationTitle,
    sourceID: context.sourceID,
    conversationType: context.conversationType,
    senderID: message.senderID,
    senderName: message.senderName,
    time: message.time,
  };

  if (message.type === 'sent' || message.type === 'received') {
    payload.text = message.text ?? '';
  }

  if (message.type === 'image') {
    payload.image = {
      url: message.imageUrl,
      width: message.imageWidth,
      height: message.imageHeight,
    };
  }

  if (message.type === 'voice') {
    payload.voice = {
      ...(context.voiceKey ? { key: context.voiceKey } : {}),
      sourceUrl: message.voiceUrl,
      soundPath: message.voicePath,
      duration: message.voiceDuration,
      dataSize: message.voiceSize,
    };
  }

  if (message.type === 'friend-card') payload.friendCard = message.friendCard;
  if (message.type === 'transfer-card') payload.transferCard = message.transferCard;

  return {
    type: getCollectionType(message),
    title: getCollectionTitle(message),
    summary: getCollectionSummary(message) ?? undefined,
    sourceID: message.id,
    payload: payload as Record<string, unknown>,
  };
}

/**
 * 重发一条收藏时「该发什么」的计划（纯数据，不依赖组件作用域）。
 *
 * 原则：收藏的是啥就原样发啥 —— 不加 title / ⭐ 等装饰。能按原类型还原的
 * （文本 / 语音 / 笔记 / 名片）就忠实重建；其余（图片等暂无法脱离原始消息
 * 还原的类型）回退成一段干净文本，绝不重复正文。
 */
export type CollectionSendPlan =
  | { kind: 'text'; text: string }
  | {
      kind: 'voice';
      /** 对象存储 key —— 自研栈重发语音的唯一凭据。 */
      key: string;
      duration: number;
      dataSize?: number;
    }
  | { kind: 'note'; noteCard: NoteCardData }
  | { kind: 'friend'; friendCard: FriendCardData }
  /**
   * 拿不到 key 的旧语音收藏。必须显式表达成「这条发不了」而不是让它走进
   * 发送流程再抛错 —— 抛出来会被当成一次普通发送失败提示「请重试」,
   * 而重试一万次都不可能成功。调用方据此禁用入口并给迁移说明。
   */
  | { kind: 'unsupported'; reason: 'legacy-voice' };

export function resolveCollectionSendPlan(
  item: Pick<UserCollection, 'title' | 'summary' | 'payload'>,
): CollectionSendPlan {
  const payload = getCollectedOpenIMMessagePayload(item.payload);

  if (payload) {
    if (
      (payload.messageType === 'sent' || payload.messageType === 'received') &&
      typeof payload.text === 'string' &&
      payload.text.trim().length > 0
    ) {
      return { kind: 'text', text: payload.text };
    }

    if (payload.messageType === 'voice' && payload.voice) {
      const key = payload.voice.key;
      if (typeof key !== 'string' || key.length === 0) {
        // OpenIM 时代(以及本次修复之前)的语音收藏只存了会过期的播放地址。
        return { kind: 'unsupported', reason: 'legacy-voice' };
      }
      return {
        kind: 'voice',
        key,
        duration: payload.voice.duration ?? 1,
        dataSize: payload.voice.dataSize,
      };
    }

    if (payload.messageType === 'note-card' && payload.noteCard) {
      return { kind: 'note', noteCard: payload.noteCard };
    }

    if (payload.messageType === 'friend-card' && payload.friendCard) {
      return { kind: 'friend', friendCard: payload.friendCard };
    }
  }

  // 兜底：原文优先，其次摘要，再次标题；都没有 ⭐ / title 装饰，也不重复。
  const text =
    payload?.text?.trim() || item.summary?.trim() || item.title?.trim() || '';
  return { kind: 'text', text };
}

/** 这条收藏能不能重发(选择器据此禁用不可发的行,不把入口先亮出来再报错)。 */
export function canResendCollection(
  item: Pick<UserCollection, 'title' | 'summary' | 'payload'>,
): boolean {
  return resolveCollectionSendPlan(item).kind !== 'unsupported';
}

export function getCollectedOpenIMMessagePayload(
  payload: UserCollection['payload'],
): CollectedOpenIMMessagePayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<CollectedOpenIMMessagePayload>;
  if (candidate.kind !== 'openim-message') return null;
  if (typeof candidate.messageID !== 'string') return null;
  if (typeof candidate.messageType !== 'string') return null;
  return candidate as CollectedOpenIMMessagePayload;
}
