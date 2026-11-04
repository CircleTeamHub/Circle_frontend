import type { ChatMessageDto } from '@/chat-core/protocol';
import { mapChatMessageDtoToUI } from '@/chat-core/message-mappers';
import { isEphemeralPeerMessage } from '@/features/chat/utils/ephemeral-message';
import type { UserCollection } from '@/services/api/collections';
import type { ChatMessage } from '@/types';

export type CollectionContent = {
  message: ChatMessage | null;
  dto?: ChatMessageDto;
  kind: 'image' | 'video' | 'voice' | 'text' | 'friend-card' | 'location' | 'other';
  text: string;
  imageUri?: string;
  videoUri?: string;
  posterUri?: string;
  voiceUri?: string;
  duration?: number;
  width?: number;
  height?: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

function fallbackText(item: UserCollection): string {
  return [item.summary, item.title].map((value) => value?.trim() ?? '').find((value) =>
    value && !/^(?:\[(?:image|photo|picture|video|voice|audio|message|图片|视频|语音|消息)\]|(?:图片|视频|语音|聊天)(?:消息)?|消息|(?:image|photo|picture|video|voice|audio|chat)(?:\s+message)?|message)$/iu.test(value),
  ) ?? '';
}

function kindOf(type: string): CollectionContent['kind'] {
  switch (type) {
    case 'image': case 'video': case 'voice': case 'friend-card': case 'location': return type;
    case 'sent': case 'received': case 'text': case 'quote': return 'text';
    default: return 'other';
  }
}

/** Read source DTOs only from the API's validated additive field. Legacy media is display-only. */
export function resolveCollectionContent(item: UserCollection, currentUserID: string | null): CollectionContent {
  const payload = record(item.payload);
  const legacy = payload.kind === 'openim-message' ? payload : {};
  const source = item.message;
  const type = source?.type || text(legacy.messageType) ||
    (item.type === 'VIDEO' ? 'video' : item.type === 'VOICE' ? 'voice' : 'text');
  const kind = kindOf(type);
  const body = text(source?.content.text) || text(payload.text) || fallbackText(item);
  if (source === null || source?.deleted || source?.revokedAt) return { message: null, kind, text: body };

  let dto: ChatMessageDto;
  if (source) {
    // The shared chat mapper may use local optimistic previews; a collection is always a remote source.
    dto = { ...source, content: { ...source.content,
      ...(kind === 'text' ? { text: body } : {}), localUri: undefined,
    } };
  } else {
    let content: Record<string, unknown>;
    switch (kind) {
      case 'text': content = { text: body }; break;
      case 'image': content = record(legacy.image); break;
      case 'video': content = record(legacy.video); break;
      case 'voice': {
        const voice = record(legacy.voice);
        content = { url: voice.sourceUrl ?? voice.url, duration: voice.duration, size: voice.dataSize };
        break;
      }
      case 'friend-card': content = record(legacy.friendCard); break;
      case 'location': content = record(legacy.location); break;
      default:
        if (type !== 'note-card') return { message: null, kind, text: body };
        content = record(legacy.noteCard);
    }
    const senderID = text(legacy.senderID) || (type === 'sent' ? item.userID : '');
    dto = {
      id: text(legacy.messageID) || `collection:${item.id}`,
      conversationId: text(legacy.conversationID) || `collection:${item.id}`,
      height: 0, type: kind === 'text' ? 'text' : type, content: { ...content, localUri: undefined },
      sender: senderID ? { id: senderID, nickname: text(legacy.senderName), avatarUrl: null } : null,
      replyToId: null, d: null, createdAt: item.createdAt,
    };
  }

  const message = mapChatMessageDtoToUI({ ...dto, d: null }, currentUserID, 0);
  // Card content is peer-controlled too. Use the mapper's bounded, URL-filtered shape for forwarding.
  const card = message.friendCard ?? message.noteCard ?? message.circleCard ??
    message.verificationCard ?? message.plazaPostCard ?? message.qrCard;
  if (card) dto = { ...dto, content: { ...card } };
  if (source && (kind === 'image' || kind === 'video' || kind === 'voice')) {
    dto = { ...dto, content: { ...dto.content,
      url: message.imageUrl ?? message.videoUrl ?? message.voiceUrl,
      thumbUrl: message.imageThumbUrl ?? message.videoThumbUrl,
    } };
  }
  const forwardDto = source || card ? dto : undefined;
  return {
    message, ...(forwardDto ? { dto: forwardDto } : {}), kind,
    text: kind === 'text' ? message.text ?? body : body,
    imageUri: message.imageUrl,
    videoUri: message.videoUrl,
    posterUri: message.imageThumbUrl ?? message.videoThumbUrl,
    voiceUri: message.voiceUrl,
    duration: message.videoDuration ?? message.voiceDuration,
    width: message.imageWidth ?? message.videoWidth,
    height: message.imageHeight ?? message.videoHeight,
  };
}

export function getCollectionForwardItem(item: UserCollection, currentUserID: string | null): { message: ChatMessage; dto?: ChatMessageDto } | null {
  const resolved = resolveCollectionContent(item, currentUserID);
  const { message, dto, kind } = resolved;
  if (!message || isEphemeralPeerMessage(message, false)) return null;
  if (kind === 'image' || kind === 'video' || kind === 'voice') {
    if (!item.message || !dto || dto.height <= 0 || (item.sourceID && dto.id !== item.sourceID)) return null;
    return { message, dto };
  }
  if (kind === 'text') return message.text?.trim() ? { message, ...(dto ? { dto } : {}) } : null;
  // Match ForwardPickerScreen's FORWARDABLE_CARD_TYPES; other cards have no send path.
  if (message.friendCard?.userID || message.noteCard?.noteId || message.circleCard?.circleId) {
    return { message, dto };
  }
  if (kind === 'location' && message.locationLatitude !== undefined && message.locationLongitude !== undefined) {
    return { message, dto };
  }
  return null;
}
