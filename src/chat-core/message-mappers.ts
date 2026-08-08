import i18n from '@/i18n';
import { normalizeMediaUrl } from '@/services/api/utils';
import type {
  CallRecordData,
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
    case 'call-record': {
      // 服务端在通话结束时下发的留痕消息。缺这一支的话它会掉进 default,
      // 渲染成一条空文本气泡 —— 拆栈后通话记录在会话里整体消失了
      // (CallRecordBubble / CallRecordData / 词条都还在,只是没人喂数据)。
      const callRecord = parseCallRecord(content);
      if (!callRecord) break;
      return { ...base, type: 'call-record', callRecord };
    }
    case 'system':
      return {
        id: dto.id,
        type: 'system-notice',
        time: formatChatTimestamp(dto.createdAt),
        text: systemNoticeText(content),
      };
    default:
      break;
  }
  // text 与未知/畸形类型都落文本气泡(显示其 text 字段或空串,不渲染破位)。
  return {
    ...base,
    type: isSent ? 'sent' : 'received',
    text: str(content['text']) ?? '',
  };
}

const CALL_END_REASONS = new Set([
  'NORMAL',
  'CANCELED',
  'ALL_LEFT',
  'NO_ANSWER',
  'TIMEOUT',
  'NETWORK',
  'ERROR',
]);

/**
 * call-record content → CallRecordData。对端可控载荷,逐字段校验:
 * 任一必填字段缺失或取值不在枚举内就整条判废(调用方回落文本气泡),
 * 不把半个对象塞给只认完整形状的 CallRecordBubble。
 */
function parseCallRecord(
  content: Record<string, unknown>,
): CallRecordData | null {
  const callId = str(content['callId']);
  const callType = str(content['callType']);
  const sessionType = str(content['sessionType']);
  const endReason = str(content['endReason']);
  const initiatorID = str(content['initiatorID']);
  if (!callId || !initiatorID) return null;
  if (callType !== 'AUDIO' && callType !== 'VIDEO') return null;
  if (sessionType !== 'single' && sessionType !== 'group') return null;
  if (!endReason || !CALL_END_REASONS.has(endReason)) return null;
  const rawDuration = content['durationSeconds'];
  const durationSeconds =
    typeof rawDuration === 'number' && Number.isFinite(rawDuration)
      ? rawDuration
      : null;
  return {
    callId,
    callType,
    sessionType,
    endReason: endReason as CallRecordData['endReason'],
    durationSeconds,
    initiatorID,
  };
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

/** 结构化系统消息 → 本地化文案(im.notification.* 词表;未知 kind 兜底空串隐藏)。 */
function systemNoticeText(content: Record<string, unknown>): string {
  const kind = typeof content['kind'] === 'string' ? content['kind'] : '';
  switch (kind) {
    case 'member-joined': {
      const names = Array.isArray(content['names'])
        ? (content['names'] as unknown[]).filter(
            (n): n is string => typeof n === 'string',
          )
        : [];
      return i18n.t('im.notification.memberJoined', {
        names: names.join('、'),
      });
    }
    case 'member-left':
      return i18n.t('im.notification.memberQuit');
    case 'group-created':
      return i18n.t('im.notification.groupCreated');
    default:
      return '';
  }
}
