import i18n from '@/i18n';
import { allowPeerMediaUrl } from '@/services/api/utils';
import type {
  CallRecordData,
  ChatMessage,
  DisplayIcon,
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
 *   voice {key,url?,duration,localUri?} · location {latitude,longitude,title?,address?,description}
 *   各卡片类型的 content = 卡片 payload 本体。
 * 乐观消息(height=0):sendStatus=1;failed=true → 3;已确认 → 2。
 */

export interface ChatMessageMapCache {
  userID: string | null;
  peerReadHeight: number;
  peerDeliveredHeight: number;
  cache: WeakMap<object, ChatMessage>;
}

export function createChatMessageMapCache(
  userID: string | null,
): ChatMessageMapCache {
  return {
    userID,
    peerReadHeight: 0,
    peerDeliveredHeight: 0,
    cache: new WeakMap(),
  };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 本机文件 uri(乐观消息用):只认没有 host 的本地 scheme,绝不放行网络地址。
 * 导出给聊天记录·媒体页复用 —— 那边也要从同一份 content 里取缩略图,
 * 两处判定必须是同一条规则,否则挡住的信标换个入口照样打得出去。
 */
export function allowLocalMediaUri(
  value: string | null | undefined,
): string | undefined {
  const local = str(value);
  if (!local) return undefined;
  return /^(file:|content:|ph:|assets-library:|data:image\/)/i.test(local)
    ? local
    : undefined;
}

function localPreviewUri(content: Record<string, unknown>): string | undefined {
  return allowLocalMediaUri(str(content['localUri']));
}

/**
 * 媒体地址解析。content 是对端可控的(整个 content 由发送方构造、服务端只校验
 * object key),所以这里的每一个候选都必须过来源白名单:
 *
 * - 正常情况下 url/thumbUrl 由服务端 presign-on-read 当场签出,天然在白名单内;
 *   但客户端也能把这两个字段塞进 content,而签名失败(存储不可用)时服务端不会
 *   覆盖它 —— 那份客户端值就会原样渲染出来。
 * - localUri 更直接:它本该只是发送方自己的本机文件路径,一旦被塞成
 *   https://attacker/1x1.gif,每个滑过这条消息的人都会静默发起一次 GET,
 *   把 IP、User-Agent 和精确到秒的已读时刻交给对方(不需要点击)。
 *
 * 所以:远端地址过 allowPeerMediaUrl,本地回退只接受无 host 的本地 scheme。
 */
function mediaUrl(content: Record<string, unknown>, field: string): string | undefined {
  const remote = str(content[field]);
  if (remote) {
    const allowed = allowPeerMediaUrl(remote);
    if (allowed) return allowed;
    // 远端地址不可信:退回本地预览(自己发的那条),而不是照常请求。
  }
  return localPreviewUri(content);
}

/** 名片上最多展示的图标数(与 FriendCardBubble 的 slice(0,4) 对齐)。 */
const FRIEND_CARD_ICON_CAP = 4;
/** 对端可控文本进气泡前的长度上限(服务端另有 4000 字上限,这里是渲染侧兜底)。 */
const PEER_TEXT_CAP = 500;

function clampText(value: unknown, cap = PEER_TEXT_CAP): string {
  const text = str(value);
  if (!text) return '';
  return text.length > cap ? text.slice(0, cap) : text;
}

/**
 * 名片 payload 完全由对端构造 —— 服务端只管 content 的总字节数,不认识里面的形状。
 * 这里必须逐字段收口,不能像以前那样直接 cast:
 *
 * - displayIcons 若被塞成字符串,FriendCardBubble 的 `.length > 0` 会通过,
 *   而 `.slice(0,4).map` 在字符串上没有 map —— 一条消息就能把整个会话页打崩,
 *   且因为它已落库,每次进这个会话都会再崩一次(修不好的坏消息);
 * - 图标数组本身不设上限的话,超大数组会被整份带进渲染路径;
 * - persona / nickname 等文本不封顶,一条超长文本能把气泡撑到卡顿。
 */
function sanitizeDisplayIcon(value: unknown): DisplayIcon | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = str(raw['id']);
  if (!id) return null;
  // 只构造消费方真正会读的字段,不整份 spread 对端对象。
  return {
    id,
    type: (str(raw['type']) ?? 'SYSTEM') as DisplayIcon['type'],
    title: clampText(raw['title'], 40),
    imageUrl: allowPeerMediaUrl(str(raw['imageUrl'])),
    fallbackIconName: str(raw['fallbackIconName']) ?? null,
    sortOrder: num(raw['sortOrder']) ?? 0,
  };
}

function sanitizeFriendCard(content: Record<string, unknown>): FriendCardData {
  const rawIcons = content['displayIcons'];
  const icons: DisplayIcon[] = [];
  if (Array.isArray(rawIcons)) {
    for (const entry of rawIcons) {
      if (icons.length >= FRIEND_CARD_ICON_CAP) break;
      const icon = sanitizeDisplayIcon(entry);
      if (icon) icons.push(icon);
    }
  }
  return {
    userID: str(content['userID']) ?? '',
    nickname: clampText(content['nickname'], 60),
    faceURL: allowPeerMediaUrl(str(content['faceURL'])) ?? '',
    persona: str(content['persona']) ? clampText(content['persona'], 120) : null,
    displayIcons: icons,
  };
}

/**
 * 卡片 payload 完全由发送方构造,服务端只管 content 的总字节数、不认识里面的形状。
 * 所以每种卡片都必须逐字段解析,不能只过一遍 URL 就整体 cast:
 *
 * - 字符串字段被塞成对象时,NoteCardBubble 的 `note.contentPreview.trim()` 直接抛 ——
 *   一条消息就能把这个会话打崩,而且它已落库,之后每次进来都会再崩一次;
 * - 非字符串值还会被当成 React 文本子节点渲染,同样炸在渲染路径上;
 * - 数字/数组字段错型会让计数与列表渲染跟着出错。
 *
 * 缺字段一律给安全默认值(空串 / null / 0 / 空数组),不让半个对象进渲染层。
 */
function textField(content: Record<string, unknown>, key: string, cap = 200): string {
  const value = str(content[key]);
  if (!value) return '';
  return value.length > cap ? value.slice(0, cap) : value;
}

function optionalTextField(
  content: Record<string, unknown>,
  key: string,
  cap = 200,
): string | null {
  return textField(content, key, cap) || null;
}

function countField(content: Record<string, unknown>, key: string): number {
  const value = num(content[key]);
  if (value === undefined || value < 0) return 0;
  return Math.floor(value);
}

function stringArrayField(
  content: Record<string, unknown>,
  key: string,
  cap = 20,
): string[] {
  const raw = content[key];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= cap) break;
    const value = str(entry);
    if (value) out.push(value.length > 40 ? value.slice(0, 40) : value);
  }
  return out;
}

/** 图片字段单独走来源白名单(对端可控地址 = 静默追踪信标)。 */
function mediaField(
  content: Record<string, unknown>,
  key: string,
): string | null {
  return allowPeerMediaUrl(str(content[key]));
}

function sanitizeNoteCard(content: Record<string, unknown>): NoteCardData {
  return {
    noteId: textField(content, 'noteId', 64),
    ownerId: optionalTextField(content, 'ownerId', 64),
    title: textField(content, 'title', 80),
    contentPreview: optionalTextField(content, 'contentPreview', 200),
    coverUrl: mediaField(content, 'coverUrl'),
    imageCount: countField(content, 'imageCount'),
    videoCount: countField(content, 'videoCount'),
    groupNames: stringArrayField(content, 'groupNames'),
    hasText: content['hasText'] === true,
    showcaseCount: countField(content, 'showcaseCount'),
    hasLocation: content['hasLocation'] === true,
  };
}

function sanitizeCircleCard(content: Record<string, unknown>): CircleCardData {
  return {
    circleId: textField(content, 'circleId', 64),
    name: textField(content, 'name', 60),
    avatarUrl: mediaField(content, 'avatarUrl'),
  };
}

function sanitizePlazaPostCard(
  content: Record<string, unknown>,
): PlazaPostCardData {
  return {
    postId: textField(content, 'postId', 64),
    title: textField(content, 'title', 80),
    contentPreview: optionalTextField(content, 'contentPreview', 200),
    coverUrl: mediaField(content, 'coverUrl'),
    circleName: textField(content, 'circleName', 60),
    city: optionalTextField(content, 'city', 40),
    signupCount: countField(content, 'signupCount'),
    authorNickname: textField(content, 'authorNickname', 60),
  };
}

function sanitizeTransferCard(
  content: Record<string, unknown>,
): TransferCardData {
  const amount = num(content['amount']);
  return {
    // 金额错型/负数一律归零,总比把 NaN 或对象渲染成金额好。
    amount: amount !== undefined && amount >= 0 ? amount : 0,
    message: optionalTextField(content, 'message', 120),
  };
}

function sanitizeVerificationCard(
  content: Record<string, unknown>,
): VerificationCardData {
  return {
    invitationId: textField(content, 'invitationId', 64),
    circleName: textField(content, 'circleName', 60),
    applicantName: textField(content, 'applicantName', 60),
  };
}

export function mapChatMessageDtoToUI(
  dto: StoredChatMessage,
  currentUserId: string | null,
  peerReadHeight: number,
  peerDeliveredHeight = 0,
): ChatMessage {
  const isSent = dto.sender !== null && dto.sender.id === currentUserId;
  const content = dto.content ?? {};
  const sendStatus: 1 | 2 | 3 = dto.height > 0 ? 2 : dto.failed ? 3 : 1;
  // G-02 撤回:整条翻成居中灰条,原类型不再渲染(content 已被服务端清空)。
  if (dto.revokedAt) {
    const revokerIsSelf =
      currentUserId !== null && dto.revokedBy === currentUserId;
    const revokerIsSender =
      dto.sender !== null && dto.revokedBy === dto.sender.id;
    const text = revokerIsSelf
      ? i18n.t('im.message.revokedBySelf', {
          defaultValue: '你撤回了一条消息',
        })
      : revokerIsSender
        ? i18n.t('im.message.revokedByOther', {
            defaultValue: '"{{name}}"撤回了一条消息',
            name: dto.sender?.nickname ?? '',
          })
        : i18n.t('im.message.revokedByModerator', {
            defaultValue: '一条消息已被管理员撤回',
          });
    return {
      id: dto.id,
      type: 'system-notice',
      time: formatChatTimestamp(dto.createdAt),
      text,
    };
  }

  const base = {
    id: dto.id,
    time: formatChatTimestamp(dto.createdAt),
    senderID: isSent ? undefined : (dto.sender?.id ?? undefined),
    senderName: isSent ? undefined : (dto.sender?.nickname ?? undefined),
    senderAvatarUrl: isSent
      ? undefined
      : (allowPeerMediaUrl(dto.sender?.avatarUrl ?? null) ?? undefined),
    outgoing: isSent,
    sendStatus: isSent ? sendStatus : undefined,
    isRead: isSent && dto.height > 0 ? dto.height <= peerReadHeight : undefined,
    isDelivered:
      isSent && dto.height > 0
        ? dto.height <= peerDeliveredHeight
        : undefined,
    // G-07:回应聚合翻成 UI 形状;编辑标记驱动「(已编辑)」后缀。
    reactions:
      dto.reactions && dto.reactions.length > 0
        ? dto.reactions.map((r) => ({
            emoji: r.emoji,
            count: r.userIds.length,
            mine:
              currentUserId !== null && r.userIds.includes(currentUserId),
          }))
        : undefined,
    edited: dto.editedAt ? true : undefined,
    // G-01:失败气泡重发要按 d 找 outbox 条目。
    deliveryId: dto.d ?? undefined,
  } satisfies Partial<ChatMessage>;

  switch (dto.type) {
    case 'quote': {
      // 真引用优先:replyTo 快照给出权威预览与跳转坐标;
      // 原消息被物理删除时快照缺省,回落发送时固化的 quotedText 文本。
      const replyTo = dto.replyTo;
      const quotedText = replyTo
        ? replyTo.revoked
          ? i18n.t('im.message.revokedQuote', { defaultValue: '消息已撤回' })
          : `${replyTo.senderNickname}: ${replyTo.preview}`.replace(/^: /, '')
        : str(content['quotedText']);
      return {
        ...base,
        type: isSent ? 'sent' : 'received',
        text: str(content['text']) ?? '',
        quotedText,
        quoteMessageId: replyTo?.id,
        quoteHeight: replyTo && !replyTo.revoked ? replyTo.height : undefined,
        quoteRevoked: replyTo?.revoked,
      };
    }
    case 'image':
      return {
        ...base,
        type: 'image',
        imageUrl: mediaUrl(content, 'url'),
        imageThumbUrl: str(content['thumbUrl'])
          ? (allowPeerMediaUrl(str(content['thumbUrl']) ?? null) ?? undefined)
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
      const latitude = num(content['latitude']);
      const longitude = num(content['longitude']);
      const hasValidCoordinates =
        latitude !== undefined &&
        longitude !== undefined &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
      return {
        ...base,
        type: 'location',
        locationTitle:
          str(content['title']) ?? str(content['description']) ?? '位置消息',
        locationAddress:
          str(content['address']) ?? str(content['description']) ?? '未知位置',
        locationLatitude: hasValidCoordinates ? latitude : undefined,
        locationLongitude: hasValidCoordinates ? longitude : undefined,
      };
    case 'note-card':
      return {
        ...base,
        type: 'note-card',
        noteCard: sanitizeNoteCard(content),
      };
    case 'friend-card':
      return {
        ...base,
        type: 'friend-card',
        friendCard: sanitizeFriendCard(content),
      };
    case 'circle-card':
      return {
        ...base,
        type: 'circle-card',
        circleCard: sanitizeCircleCard(content),
      };
    case 'transfer-card':
      return {
        ...base,
        type: 'transfer-card',
        transferCard: sanitizeTransferCard(content),
      };
    case 'verification-card':
      return {
        ...base,
        type: 'verification-card',
        verificationCard: sanitizeVerificationCard(content),
      };
    case 'plaza-post-card':
      return {
        ...base,
        type: 'plaza-post-card',
        plazaPostCard: sanitizePlazaPostCard(content),
      };
    case 'call-record': {
      // 服务端在通话结束时下发的留痕消息。缺这一支的话它会掉进 default,
      // 渲染成一条空文本气泡 —— 拆栈后通话记录在会话里整体消失了
      // (CallRecordBubble / CallRecordData / 词条都还在,只是没人喂数据)。
      const callRecord = parseCallRecord(content);
      if (!callRecord) break;
      return { ...base, type: 'call-record', callRecord };
    }
    case 'file': {
      // 旧 OpenIM 栈遗留的文件消息(自研栈没有发送入口):渲染成带文件名的
      // 文本气泡,别让历史记录里出现一排空白。
      const fileName = str(content['fileName']) ?? str(content['name']);
      return {
        ...base,
        type: isSent ? 'sent' : 'received',
        text: fileName
          ? `\u{1F4C4} ${fileName}`
          : i18n.t('im.preview.file', { defaultValue: '[文件]' }),
      };
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
  // text 落文本气泡;未知类型优先显示其 text 字段,连 text 都没有的
  // (畸形 call-record、未来新增的类型)给占位词条,不渲染空白气泡。
  const fallbackText = str(content['text']);
  return {
    ...base,
    type: isSent ? 'sent' : 'received',
    text:
      fallbackText ??
      (dto.type === 'text'
        ? ''
        : i18n.t('im.message.unsupported', {
            defaultValue: '[暂不支持的消息类型]',
          })),
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
  peerDeliveredHeight = 0,
): ChatMessage[] {
  if (
    box.userID !== currentUserId ||
    box.peerReadHeight !== peerReadHeight ||
    box.peerDeliveredHeight !== peerDeliveredHeight
  ) {
    box.userID = currentUserId;
    box.peerReadHeight = peerReadHeight;
    box.peerDeliveredHeight = peerDeliveredHeight;
    box.cache = new WeakMap();
  }
  const result: ChatMessage[] = [];
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const raw = source[i];
    const cacheable = raw.height > 0;
    let mapped = cacheable ? box.cache.get(raw) : undefined;
    if (!mapped) {
      mapped = mapChatMessageDtoToUI(
        raw,
        currentUserId,
        peerReadHeight,
        peerDeliveredHeight,
      );
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
    case 'burn-changed': {
      // S-01 留痕:开关变化双方可见,防「对方偷偷开了焚毁」。
      const seconds =
        typeof content['seconds'] === 'number' ? content['seconds'] : 0;
      if (seconds <= 0) return i18n.t('im.notification.burnDisabled');
      return i18n.t('im.notification.burnEnabled', {
        duration: formatBurnDuration(seconds),
      });
    }
    default:
      return '';
  }
}

/** 焚毁档位 → 本地化时长标签(白名单外的值回落成秒数)。 */
export function formatBurnDuration(seconds: number): string {
  const key: Record<number, string> = {
    30: 'im.burn.s30',
    300: 'im.burn.m5',
    3600: 'im.burn.h1',
    86400: 'im.burn.d1',
    604800: 'im.burn.d7',
  };
  const found = key[seconds];
  return found ? i18n.t(found) : `${seconds}s`;
}
