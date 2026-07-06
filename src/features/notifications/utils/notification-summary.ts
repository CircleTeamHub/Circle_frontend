import type { Ionicons } from '@expo/vector-icons';
import type { NotificationItem, NotificationType } from '@/types';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

export interface NotificationRowData {
  id: string;
  avatarName: string;
  avatarUrl: string | null;
  title: string;
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
  if (
    type === 'CIRCLE_POST_SIGNUP_CREATED' ||
    type === 'CIRCLE_POST_AUTO_ENDED'
  )
    return 'megaphone-outline';
  if (type.startsWith('FRIEND_REQUEST')) return 'person-add-outline';
  if (type === 'CIRCLE_VERIFICATION_REQUESTED')
    return 'shield-checkmark-outline';
  if (type.startsWith('CIRCLE_')) return 'people-circle-outline';
  return 'notifications-outline';
}

export function mapNotificationToRow(
  n: NotificationItem,
  t: TFunc,
): NotificationRowData {
  const name = n.fromUser?.nickname ?? t('notifications.system');
  const summary =
    n.type === 'SYSTEM'
      ? n.content
      : t(`notifications.summary.${n.type}`, {
          defaultValue: n.content || t('notifications.summary.default'),
          circle: n.fromCircle?.name ?? '',
        });
  return {
    id: n.id,
    avatarName: name,
    avatarUrl: n.fromUser?.avatarUrl ?? null,
    title: name,
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
