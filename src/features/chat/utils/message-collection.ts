import type { CreateCollectionInput, UserCollection } from '@/services/api/collections';
import type { ChatMessage } from '@/types';

export type CollectedOpenIMMessagePayload = {
  kind: 'openim-message';
  messageID: string;
  messageType: ChatMessage['type'];
  conversationID: string;
  conversationTitle: string;
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
};

function compactText(value: string | null | undefined, max = 80) {
  const text = value?.trim() ?? '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function getCollectionType(message: ChatMessage): CreateCollectionInput['type'] {
  if (message.type === 'voice') return 'VOICE';
  if (message.type === 'note-card') return 'NOTE';
  return 'MESSAGE';
}

function getCollectionTitle(message: ChatMessage) {
  if (message.type === 'voice') return '语音消息';
  if (message.type === 'image') return '图片消息';
  if (message.type === 'location') return message.locationTitle || '位置消息';
  if (message.type === 'note-card') return message.noteCard?.title || '笔记';
  if (message.type === 'friend-card') {
    return `名片: ${message.friendCard?.nickname ?? '好友'}`;
  }
  if (message.type === 'transfer-card') return '积分转账';
  return compactText(message.text, 40) || '聊天消息';
}

function getCollectionSummary(message: ChatMessage) {
  if (message.type === 'voice') {
    const seconds = Math.max(1, Math.round(message.voiceDuration ?? 1));
    return `${seconds} 秒语音`;
  }
  if (message.type === 'image') return '图片';
  if (message.type === 'location') return message.locationAddress ?? null;
  if (message.type === 'note-card') return compactText(message.noteCard?.contentPreview, 120) || null;
  if (message.type === 'friend-card') return '个人名片';
  if (message.type === 'transfer-card') {
    const amount = message.transferCard?.amount;
    return typeof amount === 'number' ? `${amount} 积分` : '积分转账';
  }
  return compactText(message.text, 120) || null;
}

export function buildCollectionInputFromMessage(
  message: ChatMessage,
  context: CollectionContext,
): CreateCollectionInput | null {
  if (message.type === 'date') return null;

  const payload: CollectedOpenIMMessagePayload = {
    kind: 'openim-message',
    messageID: message.id,
    messageType: message.type,
    conversationID: context.conversationID,
    conversationTitle: context.conversationTitle,
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
      sourceUrl: message.voiceUrl,
      soundPath: message.voicePath,
      duration: message.voiceDuration,
      dataSize: message.voiceSize,
    };
  }

  if (message.type === 'note-card') payload.noteCard = message.noteCard;
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
