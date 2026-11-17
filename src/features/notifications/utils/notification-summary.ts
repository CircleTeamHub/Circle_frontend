import type { NotificationItem } from '@/types';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export interface NotificationRowData {
  id: string;
  avatarName: string;
  avatarUrl: string | null;
  title: string;
  // 发送者 userId（名字特效上色用）；SYSTEM 通知无发送者时为 null。
  fromUserId: string | null;
  summary: string;
  previewImage: string | null;
  unread: boolean;
  createdAt: string;
  // 非空时，点击该通知直达对应的入圈担保验证页。
  verificationInvitationId: string | null;
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
    previewImage: n.fromTrace?.firstImage ?? null,
    unread: !n.read,
    createdAt: n.createdAt,
    verificationInvitationId:
      n.type === 'CIRCLE_VERIFICATION_REQUESTED'
        ? (n.fromInvitation?.id ?? null)
        : null,
  };
}
