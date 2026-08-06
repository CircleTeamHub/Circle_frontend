import { normalizeMediaUrl } from '@/services/api/utils';
import type {
  ChatMessage,
  CircleCardData,
  FriendCardData,
  NoteCardData,
  PlazaPostCardData,
  TransferCardData,
  VerificationCardData,
} from '@/types';
import { formatChatTimestamp } from './mappers';
import type { StoredChatMessage } from './store';

/**
 * chat-core 消息 DTO → UI ChatMessage(替代 src/im/mappers 的消息侧)。
 * content 形状是 FE 定义、BE 透传的契约:
 *   text/quote {text, quotedText?} · image {key,url?,thumbUrl?,width?,height?,localUri?}
 *   voice {key,url?,duration,localUri?} · location {latitude,longitude,description}
 *   各卡片类型的 content = 卡片 payload 本体。
 * 乐观消息(height=0):sendStatus=1;failed=true → 3;已确认 → 2。
 */

export interface ChatMessageMapCache {
  userID: string | null;
  peerReadHeight: number;
  cache: WeakMap<object, ChatMessage>;
}

export function createChatMessageMapCache(
  userID: string | null,
): ChatMessageMapCache {
  return { userID, peerReadHeight: 0, cache: new WeakMap() };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mediaUrl(content: Record<string, unknown>, field: string): string | undefined {
  const remote = str(content[field]);
  if (remote) return normalizeMediaUrl(remote) ?? remote;
  // 乐观消息还没有签名 URL:用本地文件 uri 先渲染,服务端回执后被替换。
  return str(content['localUri']);
}

export function mapChatMessageDtoToUI(
  dto: StoredChatMessage,
  currentUserId: string | null,
  peerReadHeight: number,
): ChatMessage {
  const isSent = dto.sender !== null && dto.sender.id === currentUserId;
  const content = dto.content ?? {};
  const sendStatus: 1 | 2 | 3 = dto.height > 0 ? 2 : dto.failed ? 3 : 1;
  const base = {
    id: dto.id,
    time: formatChatTimestamp(dto.createdAt),
    senderID: isSent ? undefined : (dto.sender?.id ?? undefined),
    senderName: isSent ? undefined : (dto.sender?.nickname ?? undefined),
    senderAvatarUrl: isSent
      ? undefined
      : (normalizeMediaUrl(dto.sender?.avatarUrl ?? null) ?? undefined),
    outgoing: isSent,
    sendStatus: isSent ? sendStatus : undefined,
    isRead: isSent && dto.height > 0 ? dto.height <= peerReadHeight : undefined,
  } satisfies Partial<ChatMessage>;

  switch (dto.type) {
    case 'quote':
      return {
        ...base,
        type: isSent ? 'sent' : 'received',
        text: str(content['text']) ?? '',
        quotedText: str(content['quotedText']),
      };
    case 'image':
      return {
        ...base,
        type: 'image',
        imageUrl: mediaUrl(content, 'url'),
        imageThumbUrl: str(content['thumbUrl'])
          ? (normalizeMediaUrl(str(content['thumbUrl']) ?? null) ?? undefined)
          : undefined,
        imageWidth: num(content['width']),
        imageHeight: num(content['height']),
      };
    case 'voice':
      return {
        ...base,
        type: 'voice',
        voiceUrl: mediaUrl(content, 'url'),
        voiceDuration: num(content['duration']),
        voiceSize: num(content['size']),
      };
    case 'location':
      return {
        ...base,
        type: 'location',
        locationTitle: str(content['description']) ?? '位置消息',
        locationAddress: str(content['description']) ?? '未知位置',
      };
    case 'note-card':
      return { ...base, type: 'note-card', noteCard: content as unknown as NoteCardData };
    case 'friend-card':
      return {
        ...base,
        type: 'friend-card',
        friendCard: content as unknown as FriendCardData,
      };
    case 'circle-card':
      return {
        ...base,
        type: 'circle-card',
        circleCard: content as unknown as CircleCardData,
      };
    case 'transfer-card':
      return {
        ...base,
        type: 'transfer-card',
        transferCard: content as unknown as TransferCardData,
      };
    case 'verification-card':
      return {
        ...base,
        type: 'verification-card',
        verificationCard: content as unknown as VerificationCardData,
      };
    case 'plaza-post-card':
      return {
        ...base,
        type: 'plaza-post-card',
        plazaPostCard: content as unknown as PlazaPostCardData,
      };
    default:
      // text 与未知类型都落文本气泡(未知类型显示其 text 字段或空串,不渲染破位)。
      return {
        ...base,
        type: isSent ? 'sent' : 'received',
        text: str(content['text']) ?? '',
      };
  }
}

/**
 * 列表映射(inverted FlatList:index 0 = 最新):升序输入反向遍历。
 * 按 DTO 引用做 WeakMap 缓存;乐观消息(height=0)不缓存 —— 其对象在
 * 确认/失败时会被替换,但"发送中"期间内容不变、引用不变,缓存会卡住状态。
 * currentUserId 或对端已读水位变化时整体失效(isRead 依赖后者)。
 */
export function mapChatMessageDtosToUI(
  source: readonly StoredChatMessage[],
  currentUserId: string | null,
  peerReadHeight: number,
  box: ChatMessageMapCache,
): ChatMessage[] {
  if (box.userID !== currentUserId || box.peerReadHeight !== peerReadHeight) {
    box.userID = currentUserId;
    box.peerReadHeight = peerReadHeight;
    box.cache = new WeakMap();
  }
  const result: ChatMessage[] = [];
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const raw = source[i];
    const cacheable = raw.height > 0;
    let mapped = cacheable ? box.cache.get(raw) : undefined;
    if (!mapped) {
      mapped = mapChatMessageDtoToUI(raw, currentUserId, peerReadHeight);
      if (cacheable) box.cache.set(raw, mapped);
    }
    result.push(mapped);
  }
  return result;
}
