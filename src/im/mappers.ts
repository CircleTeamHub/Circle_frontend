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
  fromImUserId,
} from '@/im/client';
import { normalizeMediaUrl } from '@/services/api/utils';
import i18n from '@/i18n';
import { getLocalizedDateTimeLocale } from '@/utils/locale';

// 所有 mapper 产出的字符串走 i18n.t；当前 locale 尚未提供对应 key 时回落到 defaultValue
// （现有中文文案），这样不动 locale JSON 也能让英文用户在补 key 后立即生效。
function tImNotification(key: string, fallback: string) {
  return i18n.t(`im.notification.${key}`, { defaultValue: fallback });
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
    if (message.contentType === MessageType.GroupCreated) return tImNotification('groupCreated', '群聊已创建');
    if (message.contentType === MessageType.MemberInvited) return tImNotification('memberInvited', '新成员加入群聊');
    if (message.contentType === MessageType.MemberQuit) return tImNotification('memberQuit', '有成员退出群聊');
    if (message.contentType === MessageType.MemberKicked) return tImNotification('memberKicked', '有成员被移出群聊');
    if (message.contentType === MessageType.GroupNameUpdated) return tImNotification('groupNameUpdated', '群名称已更新');
    if (message.contentType === MessageType.GroupDismissed) return tImNotification('groupDismissed', '群已解散');
    if (message.contentType === MessageType.RevokeMessage) return tImNotification('messageRevoked', '一条消息被撤回');
    return '';
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

  // 系统/群通知消息不渲染为聊天气泡（创建群聊后 SDK 自动塞的 GroupCreated
  // 之前会被当成普通文本显示成 [消息] 气泡）。
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
  };

  if (item.contentType === MessageType.LocationMessage) {
    return {
      ...base,
      type: 'location',
      outgoing: isSent,
      locationTitle: item.locationElem?.description ?? '位置消息',
      locationAddress: item.locationElem?.description ?? '未知位置',
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  if (item.contentType === MessageType.AtTextMessage) {
    return {
      ...base,
      type: isSent ? 'sent' : 'received',
      text: item.atTextElem?.text ?? item.content,
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  if (item.contentType === MessageType.QuoteMessage) {
    return {
      ...base,
      type: isSent ? 'sent' : 'received',
      text: item.quoteElem?.text ?? item.content,
      quotedText: getMessagePreview(item.quoteElem?.quoteMessage ?? null, ''),
      senderName: isSent ? undefined : (item.senderNickname || item.sendID),
    };
  }

  if (item.contentType === MessageType.CustomMessage) {
    const ext = item.customElem?.extension;
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
          ext = JSON.parse(card.ex);
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
        persona: ext.persona ?? null,
        displayIcons: ext.displayIcons ?? [],
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
    const rawUrl = pic?.url;
    if (rawUrl && rawUrl.length > 0) {
      return {
        ...base,
        type: 'image',
        outgoing: isSent,
        imageUrl: normalizeMediaUrl(rawUrl) ?? rawUrl,
        imageWidth: pic?.width ?? undefined,
        imageHeight: pic?.height ?? undefined,
        senderName: isSent ? undefined : (item.senderNickname || item.sendID),
      };
    }
    // 图片元数据存在但 url 空 —— 退化成文字气泡，避免渲染破图占位框。
    // 落进下方的通用 text 分支。
  }

  if (item.contentType === MessageType.VoiceMessage) {
    const voiceUrl = normalizeMediaUrl(item.soundElem?.sourceUrl ?? '') ?? item.soundElem?.sourceUrl;
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
    text: getMessagePreview(item, item.content),
    // 仅接收到的消息携带 senderName，优先用昵称，没有则 fallback 到 sendID
    senderName: isSent ? undefined : (item.senderNickname || item.sendID),
  };
}
