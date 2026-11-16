import type { Ionicons } from '@expo/vector-icons';
import type { NotificationItem, NotificationType } from '@/types';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export interface NotificationRowData {
  id: string;
  avatarName: string;
  avatarUrl: string | null;
  title: string;
  // 发送者 userId（名字特效上色用）；SYSTEM 通知无发送者时为 null。
  fromUserId: string | null;
  summary: string;
  icon: keyof typeof Ionicons.glyphMap;
  previewImage: string | null;
  unread: boolean;
  createdAt: string;
  // 非空时，点击该通知直达对应的入圈担保验证页。
  verificationInvitationId: string | null;
}

function iconFor(type: NotificationType): keyof typeof Ionicons.glyphMap {
  if (
    type === 'MESSAGE_RECEIVED' ||
    type === 'MEMBER_MENTION' ||
    type === 'MESSAGE_QUOTE'
  )
    return 'chatbubble-ellipses-outline';
  if (
    type === 'SQUAD_INVITE' ||
    type === 'SQUAD_REQUEST_RECEIVED' ||
    type === 'SQUAD_REQUEST_ACCEPTED' ||
    type === 'SQUAD_REQUEST_REJECTED'
  )
    return 'people-outline';
  if (type === 'MISSION_INVITE') return 'flag-outline';
  if (type === 'TRACE_COMMENT' || type === 'COMMENT_REPLY')
    return 'chatbubble-outline';
  if (type === 'TRACE_LIKE') return 'heart-outline';
  if (type === 'PROFILE_LIKE') return 'thumbs-up-outline';
  if (type === 'CIRCLE_POST_COLLABORATION_RECOGNIZED') return 'ribbon-outline';
  if (
    type === 'CIRCLE_POST_SIGNUP_CREATED' ||
    type === 'CIRCLE_POST_AUTO_ENDED'
  )
    return 'megaphone-outline';
  if (type === 'GROUP_MEMBER_REMOVED' || type === 'CIRCLE_MEMBER_REMOVED')
    return 'exit-outline';
  if (type === 'GROUP_DISSOLVED' || type === 'CIRCLE_DISSOLVED')
    return 'close-circle-outline';
  if (type === 'SYSTEM') return 'megaphone-outline';
  if (type.startsWith('FRIEND_REQUEST')) return 'person-add-outline';
  if (type === 'CIRCLE_VERIFICATION_REQUESTED')
    return 'shield-checkmark-outline';
  if (type.startsWith('CIRCLE_')) return 'people-circle-outline';
  return 'notifications-outline';
}

/**
 * 不以「谁」开头的通知：被移出 / 解散（主角是那个群或圈子，fromUser 记的是本人，
 * 不点名操作者）和系统公告（fromUser 是发布公告的管理员账号，不该露出来）。
 */
function subjectRow(n: NotificationItem, t: TFunc): { title: string; summary: string } | null {
  if (n.type === 'GROUP_MEMBER_REMOVED' || n.type === 'GROUP_DISSOLVED') {
    return {
      title: n.content.trim() || t('notifications.notice.unnamedGroup'),
      summary: t(`notifications.summary.${n.type}`),
    };
  }
  if (n.type === 'CIRCLE_MEMBER_REMOVED' || n.type === 'CIRCLE_DISSOLVED') {
    return {
      title: n.fromCircle?.name || n.content.trim() || t('notifications.notice.unnamedCircle'),
      summary: t(`notifications.summary.${n.type}`),
    };
  }
  if (n.type === 'SYSTEM') {
    return {
      title: t('notifications.system'),
      summary: n.systemAnnouncement?.title || n.content,
    };
  }
  return null;
}

/**
 * 同一条动态的点赞合并成一组，排在最新那个赞的位置（列表本身新的在前）。其余通知各自一组。
 * 只合并已经加载的部分：往下翻页时，这一行的人数会跟着变大。
 */
export function groupTraceLikes(
  items: readonly NotificationItem[],
): NotificationItem[][] {
  const groups: NotificationItem[][] = [];
  const likesByTrace = new Map<string, NotificationItem[]>();
  for (const item of items) {
    const traceId = item.type === 'TRACE_LIKE' ? item.fromTrace?.id : undefined;
    const group = traceId ? likesByTrace.get(traceId) : undefined;
    if (group) {
      group.push(item);
      continue;
    }
    const created = [item];
    if (traceId) likesByTrace.set(traceId, created);
    groups.push(created);
  }
  return groups;
}

/** 一组 → 一行：头像和名字是最新点赞的人，摘要写「和另外 N 人点赞了你的动态」，任一条未读即未读。 */
export function mapNotificationGroupToRow(
  group: readonly NotificationItem[],
  t: TFunc,
): NotificationRowData {
  const row = mapNotificationToRow(group[0], t);
  if (group.length === 1) return row;
  const likers = new Set(group.map((n) => n.fromUser?.id ?? n.id)).size;
  return {
    ...row,
    summary:
      likers > 1
        ? t('notifications.summary.TRACE_LIKE_GROUPED', { others: likers - 1 })
        : row.summary,
    unread: group.some((n) => !n.read),
  };
}

export function mapNotificationToRow(
  n: NotificationItem,
  t: TFunc,
): NotificationRowData {
  const subject = subjectRow(n, t);
  if (subject) {
    return {
      id: n.id,
      avatarName: subject.title,
      avatarUrl: null,
      title: subject.title,
      fromUserId: null,
      summary: subject.summary,
      icon: iconFor(n.type),
      previewImage: null,
      unread: !n.read,
      createdAt: n.createdAt,
      verificationInvitationId: null,
    };
  }
  const name = n.fromUser?.nickname ?? t('notifications.system');
  const summary = t(`notifications.summary.${n.type}`, {
    defaultValue: n.content || t('notifications.summary.default'),
    circle: n.fromCircle?.name ?? '',
  });
  return {
    id: n.id,
    avatarName: name,
    avatarUrl: n.fromUser?.avatarUrl ?? null,
    title: name,
    fromUserId: n.fromUser?.id ?? null,
    summary,
    icon: iconFor(n.type),
    previewImage: n.fromTrace?.firstImage ?? null,
    unread: !n.read,
    createdAt: n.createdAt,
    verificationInvitationId:
      n.type === 'CIRCLE_VERIFICATION_REQUESTED'
        ? (n.fromInvitation?.id ?? null)
        : null,
  };
}
