/**
 * im/mappers.ts — OpenIM SDK 原始类型 → UI 类型映射
 *
 * - mapConversationItemToUI：ConversationItem → Conversation（会话列表行数据）
 * - mapMessageItemToChatMessage：MessageItem → ChatMessage（聊天气泡数据）
 * - getMessagePreview：从 MessageItem 提取消息预览文本（用于会话列表最后一条消息）
 */
import type {
  Conversation,
  ChatMessage,
  NoteCardData,
  FriendCardData,
  TransferCardData,
  VerificationCardData,
  PlazaPostCardData,
  CallRecordData,
} from '@/types';
import {
  MessageType,
  SessionType,
  type ConversationItem,
  type MessageItem,
} from '@openim/rn-client-sdk';
import {
  NOTE_CARD_EXTENSION,
  TRANSFER_CARD_EXTENSION,
  VERIFICATION_CARD_EXTENSION,
  PLAZA_POST_CARD_EXTENSION,
  CALL_RECORD_EXTENSION,
  FRIEND_ADDED_NOTICE_EXTENSION,
  fromImUserId,
} from '@/im/client';
import { allowPeerMediaUrl, normalizeMediaUrl } from '@/services/api/utils';
import i18n from '@/i18n';
import { getLocalizedDateTimeLocale } from '@/utils/locale';

// 所有 mapper 产出的字符串走 i18n.t；当前 locale 尚未提供对应 key 时回落到 defaultValue
// （现有中文文案），这样不动 locale JSON 也能让英文用户在补 key 后立即生效。
function tImNotification(
  key: string,
  fallback: string,
  vars?: Record<string, unknown>,
) {
  return i18n.t(`im.notification.${key}`, { defaultValue: fallback, ...vars });
}
function tImPreview(key: string, fallback: string, vars?: Record<string, unknown>) {
  return i18n.t(`im.preview.${key}`, { defaultValue: fallback, ...vars });
}
function tImTime(key: string, fallback: string) {
  return i18n.t(`im.time.${key}`, { defaultValue: fallback });
}

// OpenIM 自动产生的系统/群通知类消息（GroupCreated / MemberInvited / RevokeMessage 等），
// 不应作为普通气泡渲染——SDK 没有公开按 base 数值区分通知的常量，这里按 enum 显式列出。
const SYSTEM_NOTIFICATION_CONTENT_TYPES = new Set<number>([
  MessageType.FriendAdded,
  MessageType.OANotification,
  MessageType.GroupCreated,
  MessageType.GroupInfoUpdated,
  MessageType.MemberQuit,
  MessageType.GroupOwnerTransferred,
  MessageType.MemberKicked,
  MessageType.MemberInvited,
  MessageType.MemberEnter,
  MessageType.GroupDismissed,
  MessageType.GroupMemberMuted,
  MessageType.GroupMemberCancelMuted,
  MessageType.GroupMuted,
  MessageType.GroupCancelMuted,
  MessageType.GroupAnnouncementUpdated,
  MessageType.GroupNameUpdated,
  MessageType.BurnMessageChange,
  MessageType.RevokeMessage,
]);

function isSystemNotification(contentType: number) {
  return SYSTEM_NOTIFICATION_CONTENT_TYPES.has(contentType);
}

// OpenIM 入群/邀请通知的 notificationElem.detail（JSON 字符串）里带成员信息：
// MemberEnter → { entrantUser: { nickname } }；MemberInvited → { invitedUserList: [{ nickname }] }。
// 解析出昵称用「张三、李四」形式拼接；拿不到时返回空串，调用方回落到通用文案。
function getJoinedMemberNames(message: MessageItem): string {
  const detail = message.notificationElem?.detail;
  if (!detail) {
    return '';
  }
  try {
    const parsed = JSON.parse(detail) as {
      entrantUser?: { nickname?: unknown };
      invitedUserList?: { nickname?: unknown }[];
    };
    const candidates = parsed.entrantUser
      ? [parsed.entrantUser]
      : Array.isArray(parsed.invitedUserList)
        ? parsed.invitedUserList
        : [];
    const names = candidates
      .map((m) => (typeof m?.nickname === 'string' ? m.nickname.trim() : ''))
      .filter(Boolean);
    return names.join('、');
  } catch {
    return '';
  }
}

// 群通知类消息的展示文案：会话列表预览与聊天流灰条共用。
// 返回 null 的类型（OA 通知/禁言变更等）不在聊天流渲染。
function getGroupNoticeText(message: MessageItem): string | null {
  switch (message.contentType) {
    case MessageType.GroupCreated:
      return tImNotification('groupCreated', '群聊已创建');
    case MessageType.MemberInvited:
    case MessageType.MemberEnter: {
      const names = getJoinedMemberNames(message);
      return names
        ? tImNotification('memberJoined', '{{names}} 加入群聊', { names })
        : tImNotification('memberInvited', '新成员加入群聊');
    }
    case MessageType.MemberQuit:
      return tImNotification('memberQuit', '有成员退出群聊');
    case MessageType.MemberKicked:
      return tImNotification('memberKicked', '有成员被移出群聊');
    case MessageType.GroupNameUpdated:
      return tImNotification('groupNameUpdated', '群名称已更新');
    case MessageType.GroupDismissed:
      return tImNotification('groupDismissed', '群已解散');
    case MessageType.RevokeMessage:
      return tImNotification('messageRevoked', '一条消息被撤回');
    default:
      return null;
  }
}

/**
 * 净化对方可控的 displayIcons。
 *
 * 名片消息的 cardElem.ex 是一段对端完全可控的 JSON，且**不经过 circle_be**
 * （客户端 SDK 直发 OpenIM），所以服务端没有任何 DTO 能拦。这里是唯一的收口点。
 *
 * 只保留气泡真正会渲染的那几个字段并强制类型：id 用作 key、imageUrl 决定分支、
 * title 直接进 <Text>。任一为异常类型都会在渲染期抛异常 —— 而聊天页没有
 * error boundary、消息又是持久化的，一条构造过的名片就能永久打不开这个会话。
 */
type SanitizedDisplayIcon = NonNullable<
  FriendCardData['displayIcons']
>[number];

function sanitizeDisplayIcons(value: unknown): SanitizedDisplayIcon[] {
  if (!Array.isArray(value)) return [];
  const icons: SanitizedDisplayIcon[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const icon = raw as Record<string, unknown>;
    if (typeof icon.id !== 'string' || typeof icon.title !== 'string') continue;
    icons.push({
      ...(icon as unknown as SanitizedDisplayIcon),
      id: icon.id,
      title: icon.title,
      imageUrl: typeof icon.imageUrl === 'string' ? icon.imageUrl : null,
    });
  }
  return icons;
}

/**
 * 渲染文本的长度上限。
 *
 * 消息正文、位置描述、群通知里的成员昵称都由对端控制，且不经过 circle_be
 * （客户端 SDK 直发 OpenIM），服务端没有任何校验。气泡也没有设 numberOfLines，
 * 于是一条几 MB 的单行文本会在 UI 线程上做一次同等规模的文字排版 —— 期间整个
 * 界面不响应，而消息是持久化的，重进会话再来一次。
 *
 * 8000 远高于任何真实聊天消息（微信一条上限 5000 字），只用来兜住失控的那种。
 * 在映射层截断而不是在输入框加 maxLength：攻击者根本不走我们的输入框，
 * maxLength 只是自家客户端的礼貌，不是防线。
 */
const MAX_RENDERED_TEXT_LENGTH = 8000;

function clampRenderedText<T extends string | null | undefined>(value: T): T {
  if (typeof value !== 'string' || value.length <= MAX_RENDERED_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_RENDERED_TEXT_LENGTH)}…` as T;
}

function parseNoteCardPayload(data: string): NoteCardData | null {
  try {
    const raw = JSON.parse(data) as Partial<NoteCardData>;
    if (typeof raw.noteId !== 'string' || typeof raw.title !== 'string') {
      return null;
    }
    const imageCount =
      typeof raw.imageCount === 'number' && Number.isFinite(raw.imageCount)
        ? Math.max(0, raw.imageCount)
        : 0;
    const videoCount =
      typeof raw.videoCount === 'number' && Number.isFinite(raw.videoCount)
        ? Math.max(0, raw.videoCount)
        : 0;
    const contentPreview =
      typeof raw.contentPreview === 'string' ? raw.contentPreview : null;
    return {
      noteId: raw.noteId,
      ownerId: raw.ownerId,
      title: raw.title,
      contentPreview,
      coverUrl: typeof raw.coverUrl === 'string' ? raw.coverUrl : null,
      imageCount,
      videoCount,
      groupNames: Array.isArray(raw.groupNames) ? raw.groupNames : [],
      hasText:
        typeof raw.hasText === 'boolean'
          ? raw.hasText
          : Boolean(contentPreview?.trim()),
      showcaseCount:
        typeof raw.showcaseCount === 'number' && Number.isFinite(raw.showcaseCount)
          ? Math.max(0, raw.showcaseCount)
          : imageCount,
      hasLocation:
        typeof raw.hasLocation === 'boolean' ? raw.hasLocation : false,
    };
  } catch {
    return null;
  }
}

function parseVerificationCardPayload(
  data: string,
): VerificationCardData | null {
  try {
    const raw = JSON.parse(data) as Partial<VerificationCardData>;
    // 空串/纯空白 invitationId 同样视为无效——否则点名片会跳到 /verification/ 的空路由。
    if (
      !raw ||
      typeof raw.invitationId !== 'string' ||
      raw.invitationId.trim() === ''
    ) {
      return null;
    }
    return {
      invitationId: raw.invitationId,
      circleName: typeof raw.circleName === 'string' ? raw.circleName : '',
      applicantName:
        typeof raw.applicantName === 'string' ? raw.applicantName : '',
    };
  } catch {
    return null;
  }
}

const PLAZA_POST_CARD_ID_MAX_LENGTH = 256;
const PLAZA_POST_CARD_TITLE_MAX_LENGTH = 200;

/** 通话留痕卡片（#115）：服务端在通话终局下发。字段校验从宽——endReason 未知值照渲染。 */
export function parseCallRecordData(data: string): CallRecordData | null {
  try {
    const raw = JSON.parse(data) as Partial<CallRecordData> & {
      type?: string;
    };
    if (raw.type !== 'call_record' || typeof raw.callId !== 'string') {
      return null;
    }
    return {
      callId: raw.callId,
      callType: raw.callType === 'VIDEO' ? 'VIDEO' : 'AUDIO',
      sessionType: raw.sessionType === 'group' ? 'group' : 'single',
      endReason: (raw.endReason ?? 'NORMAL') as CallRecordData['endReason'],
      // round 2 review：Number.isFinite 拒掉 1e309→Infinity/NaN（typeof 也是
      // 'number'），floor 归一到非负整数 —— 否则渲染出 'Infinity:NaN'。
      durationSeconds:
        typeof raw.durationSeconds === 'number' &&
        Number.isFinite(raw.durationSeconds) &&
        raw.durationSeconds >= 0
          ? Math.floor(raw.durationSeconds)
          : null,
      initiatorID: typeof raw.initiatorID === 'string' ? raw.initiatorID : '',
    };
  } catch {
    return null;
  }
}

export function parsePlazaPostCardData(data: string): PlazaPostCardData | null {
  try {
    const raw = JSON.parse(data) as Partial<PlazaPostCardData>;
    if (typeof raw.postId !== 'string' || typeof raw.title !== 'string') {
      return null;
    }
    const postId = raw.postId.trim();
    const title = raw.title.trim();
    if (
      postId.length === 0 ||
      postId.length > PLAZA_POST_CARD_ID_MAX_LENGTH ||
      title.length === 0 ||
      title.length > PLAZA_POST_CARD_TITLE_MAX_LENGTH
    ) {
      return null;
    }
    const signupCount =
      typeof raw.signupCount === 'number' && Number.isFinite(raw.signupCount)
        ? Math.max(0, raw.signupCount)
        : 0;
    return {
      postId,
      title,
      contentPreview:
        typeof raw.contentPreview === 'string' ? raw.contentPreview : null,
      coverUrl: typeof raw.coverUrl === 'string' ? raw.coverUrl : null,
      circleName: typeof raw.circleName === 'string' ? raw.circleName : '',
      city: typeof raw.city === 'string' ? raw.city : null,
      signupCount,
      authorNickname:
        typeof raw.authorNickname === 'string' ? raw.authorNickname : '',
    };
  } catch {
    return null;
  }
}

// 将毫秒时间戳格式化为显示文本：今天显示时间，昨天显示"昨天"，更早显示日期
// 注意：timestamp <= 0 视为无效值，返回空字符串
function formatTimestamp(timestamp: number) {
  if (timestamp == null || timestamp <= 0) {
    return '';
  }

  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(getLocalizedDateTimeLocale(i18n.language), {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return tImTime('yesterday', '昨天');
  }

  // 月/日 格式按当前 i18n 语言走原生 toLocaleDateString；集中到 getLocalizedDateTimeLocale
  // 覆盖 zh/en/ja/ko/es，避免旧的 zh/en 二元判断让新语言错用格式。
  const locale = getLocalizedDateTimeLocale(i18n.language);
  return date.toLocaleDateString(locale, {
    month: 'numeric',
    day: 'numeric',
  });
}

// ConversationItem.latestMsg 是 JSON 字符串，需要解析后才能提取预览文本
// 解析失败时返回 null，上层会 fallback 到原始字符串
function parseLatestMessage(latestMsg: string) {
  if (!latestMsg) {
    return null;
  }

  try {
    return JSON.parse(latestMsg) as MessageItem;
  } catch {
    return null;
  }
}

export function getMessagePreview(message: MessageItem | null, fallback = '') {
  if (!message) {
    return fallback;
  }

  if (isSystemNotification(message.contentType)) {
    // 好友刚建立的 FriendAdded 通知——会话列表也要给出预览（对话渲染见下方），
    // 否则最后一条是它时列表这行会空白。
    if (message.contentType === MessageType.FriendAdded) return tImNotification('friendAdded', '你们已经是好友了，开始聊天吧');
    return getGroupNoticeText(message) ?? '';
  }

  switch (message.contentType) {
    case MessageType.TextMessage:
      return message.textElem?.content ?? fallback;
    case MessageType.AtTextMessage:
      return message.atTextElem?.text ?? fallback;
    case MessageType.QuoteMessage:
      return message.quoteElem?.text ?? fallback;
    case MessageType.PictureMessage:
      return tImPreview('image', '[图片]');
    case MessageType.VideoMessage:
      return tImPreview('video', '[视频]');
    case MessageType.VoiceMessage:
      return tImPreview('voice', '[语音]');
    case MessageType.FileMessage:
      return tImPreview('file', '[文件]');
    case MessageType.LocationMessage:
      return message.locationElem?.description ?? tImPreview('location', '[位置]');
    case MessageType.TypingMessage:
      return tImPreview('typing', '[正在输入]');
    case MessageType.CardMessage:
      return tImPreview('card', '[名片] {{name}}', { name: message.cardElem?.nickname ?? '' }).trim();
    case MessageType.CustomMessage: {
      // 卡片消息优先用结构化 data 还原预览：description 字段是发送时拼好的字符串，
      // 历史脏数据（例如 amount 缺失时拼出 "[转账] undefined 积分"）会一直跟着会话走。
      const ext = message.customElem?.extension;
      if (ext === TRANSFER_CARD_EXTENSION) {
        try {
          const raw = JSON.parse(message.customElem?.data ?? '') as Partial<TransferCardData>;
          if (typeof raw.amount === 'number' && raw.amount > 0) {
            return tImPreview('transferWithAmount', '[转账] {{amount}} 积分', { amount: raw.amount });
          }
        } catch {
          // 落到通用兜底
        }
        return tImPreview('transfer', '[转账]');
      }
      if (ext === NOTE_CARD_EXTENSION) {
        const payload = parseNoteCardPayload(message.customElem?.data ?? '');
        if (payload) return tImPreview('note', '[笔记] {{title}}', { title: payload.title });
      }
      if (ext === PLAZA_POST_CARD_EXTENSION) {
        const payload = parsePlazaPostCardData(message.customElem?.data ?? '');
        if (payload)
          return tImPreview('plazaPost', '[活动] {{title}}', {
            title: payload.title,
          });
      }
      if (ext === CALL_RECORD_EXTENSION) {
        const payload = parseCallRecordData(message.customElem?.data ?? '');
        if (payload)
          return tImPreview(
            payload.callType === 'VIDEO' ? 'videoCall' : 'voiceCall',
            payload.callType === 'VIDEO' ? '[视频通话]' : '[语音通话]',
          );
      }
      if (ext === VERIFICATION_CARD_EXTENSION) {
        const payload = parseVerificationCardPayload(
          message.customElem?.data ?? '',
        );
        if (payload)
          return tImPreview('verification', '[验证] {{name}} 邀请你担保', {
            name: payload.applicantName,
          });
      }
      const desc = message.customElem?.description;
      if (desc && desc.trim()) return desc;
      return tImPreview('default', '[消息]');
    }
    default:
      return tImPreview('default', '[消息]');
  }
}

export function mapConversationItemToUI(item: ConversationItem): Conversation {
  const latestMessage = parseLatestMessage(item.latestMsg);
  // OpenIM 媒体 URL 同样可能指向 localhost（dev 物理机场景），走和后端 API 一样的归一化路径
  const normalizedAvatar = normalizeMediaUrl(item.faceURL || null);

  return {
    id: item.conversationID,
    // 单聊 sourceID 用 UUID 形式（item.userID 是去连字符的 IM id），
    // 这样跳个人资料 /user/:id 才匹配（与联系人页一致）；发消息侧再 toImUserId 转回。
    // 群聊保持 groupID 原样。
    sourceID:
      item.conversationType === SessionType.Group
        ? item.groupID
        : fromImUserId(item.userID),
    name: item.showName,
    message: getMessagePreview(latestMessage, item.latestMsg),
    time: formatTimestamp(item.latestMsgSendTime),
    avatarUrl: normalizedAvatar ?? undefined,
    unreadCount: item.unreadCount,
    conversationType:
      item.conversationType === SessionType.Group ? 'group' : 'private',
    pinned: item.isPinned === true,
    muted: item.recvMsgOpt !== 0,
  };
}

export function mapMessageItemToChatMessage(
  item: MessageItem,
  currentUserID: string | null
): ChatMessage | null {
  if (item.contentType === MessageType.TypingMessage) {
    return null;
  }

  // 好友刚建立时 OpenIM 会塞一条 FriendAdded 通知——渲染成一条居中灰色系统提示
  // （微信「你们已经是好友了，开始聊天吧」那条），让会话不再空着。必须放在下面
  // 通用的系统通知过滤之前。
  if (item.contentType === MessageType.FriendAdded) {
    return {
      id: item.clientMsgID,
      type: 'system-notice',
      systemNoticeKind: 'friend-added',
      systemNoticeSource: 'native',
      systemNoticeTimestamp: item.sendTime,
      text: tImNotification('friendAdded', '你们已经是好友了，开始聊天吧'),
      time: formatTimestamp(item.sendTime),
    };
  }

  // 群通知类消息（群已创建/新成员加入/退群/改名/解散/撤回）渲染成居中灰条，
  // 微信样式——否则新圈子群里只有这类消息时聊天页会显示成一片空白。
  const groupNoticeText = getGroupNoticeText(item);
  if (groupNoticeText) {
    return {
      id: item.clientMsgID,
      type: 'system-notice',
      text: clampRenderedText(groupNoticeText),
      time: formatTimestamp(item.sendTime),
    };
  }

  // 其余系统通知（OA 通知/禁言变更等）没有面向用户的文案，不渲染。
  if (isSystemNotification(item.contentType)) {
    return null;
  }

  const isSent = item.sendID === currentUserID;
  // 显式校验 status 在已知集合内再附给气泡，避免 SDK 版本漂移引入新值后
  // 用 `as 1 | 2 | 3` 骗过类型系统、UI 渲染出错的图标。
  const isKnownSendStatus =
    item.status === 1 || item.status === 2 || item.status === 3;
  const base = {
    id: item.clientMsgID,
    time: formatTimestamp(item.sendTime),
    // 发送状态/已读 状态对所有自己发出的消息都有意义；接收消息这两字段会被忽略。
    sendStatus: isSent && isKnownSendStatus ? (item.status as 1 | 2 | 3) : undefined,
    isRead: isSent ? Boolean(item.isRead) : undefined,
    // 接收消息带上发送者的用户 id（还原成 UUID 形式），群聊点头像可跳对方资料。
    senderID: isSent ? undefined : fromImUserId(item.sendID),
    // 发送者头像：群聊气泡必须用发送者本人的（会话头像在群聊里是群头像）。
    senderAvatarUrl: isSent
      ? undefined
      : (normalizeMediaUrl(item.senderFaceUrl || null) ?? undefined),
  };

  if (item.contentType === MessageType.LocationMessage) {
    return {
      ...base,
      type: 'location',
      outgoing: isSent,
      locationTitle: clampRenderedText(item.locationElem?.description) ?? '位置消息',
      locationAddress: clampRenderedText(item.locationElem?.description) ?? '未知位置',
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  if (item.contentType === MessageType.AtTextMessage) {
    return {
      ...base,
      type: isSent ? 'sent' : 'received',
      text: clampRenderedText(item.atTextElem?.text ?? item.content),
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  if (item.contentType === MessageType.QuoteMessage) {
    return {
      ...base,
      type: isSent ? 'sent' : 'received',
      text: clampRenderedText(item.quoteElem?.text ?? item.content),
      quotedText: getMessagePreview(item.quoteElem?.quoteMessage ?? null, ''),
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  if (item.contentType === MessageType.CustomMessage) {
    const ext = item.customElem?.extension;
    if (ext === FRIEND_ADDED_NOTICE_EXTENSION) {
      // Locally-inserted "you're now friends" notice (see
      // insertLocalFriendAddedNotice). Same centered line as the native
      // FriendAdded; the chat screen dedupes if both are present.
      return {
        id: item.clientMsgID,
        type: 'system-notice',
        systemNoticeKind: 'friend-added',
        systemNoticeSource: 'local',
        systemNoticeTimestamp: item.sendTime,
        text: tImNotification('friendAdded', '你们已经是好友了，开始聊天吧'),
        time: formatTimestamp(item.sendTime),
      };
    }
    if (ext === NOTE_CARD_EXTENSION) {
      const payload = parseNoteCardPayload(item.customElem?.data ?? '');
      if (payload) {
        return {
          ...base,
          type: 'note-card',
          outgoing: isSent,
          noteCard: payload,
          senderName: isSent ? undefined : (item.senderNickname || item.sendID),
        };
      }
    }
    if (ext === PLAZA_POST_CARD_EXTENSION) {
      const payload = parsePlazaPostCardData(item.customElem?.data ?? '');
      if (payload) {
        return {
          ...base,
          type: 'plaza-post-card',
          outgoing: isSent,
          plazaPostCard: {
            ...payload,
            // 封面同样来自对端可控的卡片 payload。
            coverUrl: allowPeerMediaUrl(payload.coverUrl),
          },
          senderName: isSent ? undefined : (item.senderNickname || item.sendID),
        };
      }
    }
    if (ext === CALL_RECORD_EXTENSION) {
      const payload = parseCallRecordData(item.customElem?.data ?? '');
      if (payload) {
        return {
          ...base,
          type: 'call-record',
          outgoing: isSent,
          callRecord: payload,
          senderName: isSent ? undefined : (item.senderNickname || item.sendID),
        };
      }
    }
    if (ext === VERIFICATION_CARD_EXTENSION) {
      const payload = parseVerificationCardPayload(item.customElem?.data ?? '');
      if (payload) {
        return {
          ...base,
          type: 'verification-card',
          outgoing: isSent,
          verificationCard: payload,
          senderName: isSent ? undefined : (item.senderNickname || item.sendID),
        };
      }
    }
    if (ext === TRANSFER_CARD_EXTENSION) {
      try {
        const raw = JSON.parse(item.customElem?.data ?? '') as Partial<TransferCardData>;
        if (typeof raw.amount === 'number' && raw.amount > 0) {
          return {
            ...base,
            type: 'transfer-card',
            outgoing: isSent,
            transferCard: {
              amount: raw.amount,
              message: typeof raw.message === 'string' ? raw.message : null,
            },
            senderName: isSent ? undefined : (item.senderNickname || item.sendID),
          };
        }
      } catch {
        // ignore — fall through to generic
      }
    }
  }

  if (item.contentType === MessageType.CardMessage) {
    const card = item.cardElem;
    if (card) {
      // 业务扩展塞在 cardElem.ex 里。kind === 'circle' 时是圈子名片，
      // 否则按好友名片解析（persona + displayIcons）。
      let ext: {
        kind?: string;
        avatarUrl?: string | null;
        persona?: string | null;
        displayIcons?: FriendCardData['displayIcons'];
      } = {};
      if (card.ex) {
        try {
          const parsed: unknown = JSON.parse(card.ex);
          // 必须校验解析结果是普通对象，不能直接赋值：JSON.parse('null') 不抛异常，
          // 它**成功**并返回 null，于是下面 try 之外的 ext.kind 解引用 null 抛
          // TypeError —— 异常逃出这个 catch，冒泡到 ChatDetailScreen 的 messages
          // useMemo，整个聊天页渲染失败。而消息是持久化的，重进会话会再次触发，
          // 等于对方一条构造过的名片消息就能永久搞坏这个会话。
          // 同理 '"abc"' / '123' 解析出原始值，属性访问虽不抛，但后续字段全是脏数据。
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            ext = parsed as typeof ext;
          }
        } catch {
          // 旧版本或非法 JSON，忽略，只保留基础字段
        }
      }

      if (ext.kind === 'circle') {
        const avatarUrl =
          card.faceURL ||
          (typeof ext.avatarUrl === 'string' && ext.avatarUrl.length > 0
            ? ext.avatarUrl
            : null);
        return {
          ...base,
          type: 'circle-card',
          outgoing: isSent,
          circleCard: {
            circleId: card.userID,
            name: card.nickname,
            avatarUrl,
          },
          senderName: isSent ? undefined : (item.senderNickname || item.sendID),
        };
      }

      const payload: FriendCardData = {
        userID: card.userID,
        nickname: card.nickname,
        faceURL: card.faceURL,
        // 必须 typeof 校验：气泡里是 card.persona?.trim()，`?.` 只挡 null/undefined，
        // 挡不住数字/对象 —— {"persona":123} 会抛 persona?.trim is not a function。
        persona: typeof ext.persona === 'string' ? ext.persona : null,
        // 光校验容器不够：数组本身合法，元素却可以是 null 或带对象字段的假图标，
        // 于是 icon.imageUrl 解引用 null、或 <Text>{icon.title}</Text> 收到对象
        // （React 直接抛 "Objects are not valid as a React child"）。
        // 逐个净化到「气泡真正会渲染的那几个字段都是安全类型」为止。
        displayIcons: sanitizeDisplayIcons(ext.displayIcons),
      };
      return {
        ...base,
        type: 'friend-card',
        outgoing: isSent,
        friendCard: payload,
        senderName: isSent ? undefined : (item.senderNickname || item.sendID),
      };
    }
  }

  if (item.contentType === MessageType.PictureMessage) {
    const pic =
      item.pictureElem?.bigPicture ??
      item.pictureElem?.sourcePicture ??
      item.pictureElem?.snapshotPicture;
    // 列表气泡优先用 snapshotPicture 缩略图，避免大群刷图时逐张拉原图。
    const thumb =
      item.pictureElem?.snapshotPicture ??
      item.pictureElem?.sourcePicture ??
      item.pictureElem?.bigPicture;
    const rawUrl = pic?.url;
    const thumbUrl = thumb?.url;
    if (rawUrl && rawUrl.length > 0) {
      return {
        ...base,
        type: 'image',
        outgoing: isSent,
        // 走来源白名单而不是直通的 normalizeMediaUrl：这两个 URL 由对端完全控制、
        // 且不经过 circle_be。指向任意主机时，每个滑过这条消息的人都会静默 GET 一次
        // （无需点击），等于把 IP、User-Agent 和精确的已读时刻送给对方。
        // 不可信时给 null，让气泡退化成占位符而不是照常发请求。
        imageUrl: allowPeerMediaUrl(rawUrl) ?? '',
        imageThumbUrl: allowPeerMediaUrl(thumbUrl) ?? undefined,
        imageWidth: pic?.width ?? undefined,
        imageHeight: pic?.height ?? undefined,
        senderName: isSent ? undefined : (item.senderNickname || item.sendID),
      };
    }
    // 图片元数据存在但 url 空 —— 退化成文字气泡，避免渲染破图占位框。
    // 落进下方的通用 text 分支。
  }

  if (item.contentType === MessageType.VoiceMessage) {
    // 同上：语音条渲染时就会建播放器指向这个地址，同样是对端可控的对外请求。
    const voiceUrl = allowPeerMediaUrl(item.soundElem?.sourceUrl);
    return {
      ...base,
      type: 'voice',
      outgoing: isSent,
      voiceUrl: voiceUrl || undefined,
      voicePath: item.soundElem?.soundPath ?? undefined,
      voiceDuration: item.soundElem?.duration ?? undefined,
      voiceSize: item.soundElem?.dataSize ?? undefined,
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  return {
    ...base,
    type: isSent ? 'sent' : 'received',
    text: clampRenderedText(getMessagePreview(item, item.content)),
    // 仅接收到的消息携带 senderName，优先用昵称，没有则 fallback 到 sendID
    senderName: isSent ? undefined : (item.senderNickname || item.sendID),
  };
}

export type MessageMapCache = {
  userID: string | null;
  cache: WeakMap<MessageItem, ChatMessage>;
};

export function createMessageMapCache(userID: string | null): MessageMapCache {
  return { userID, cache: new WeakMap() };
}

export function mapMessageItemsToChatMessages(
  source: readonly MessageItem[],
  currentUserID: string | null,
  box: MessageMapCache,
) {
  if (box.userID !== currentUserID) {
    box.userID = currentUserID;
    box.cache = new WeakMap();
  }

  const result: ChatMessage[] = [];
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const raw = source[i];
    // OpenIM can mutate the optimistic message object in place when sendMessage
    // completes. Do not cache the pending version or the row can stay "sending".
    const cacheable = raw.status !== 1;
    let mapped = cacheable ? box.cache.get(raw) : undefined;
    if (!mapped) {
      const next = mapMessageItemToChatMessage(raw, currentUserID);
      if (!next) continue;
      if (cacheable) box.cache.set(raw, next);
      mapped = next;
    }
    result.push(mapped);
  }
  return result;
}
