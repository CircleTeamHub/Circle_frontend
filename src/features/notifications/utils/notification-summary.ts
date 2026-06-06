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
}

function iconFor(type: NotificationType): keyof typeof Ionicons.glyphMap {
  if (type === 'TRACE_COMMENT' || type === 'COMMENT_REPLY')
    return 'chatbubble-outline';
  if (type === 'TRACE_LIKE') return 'heart-outline';
  if (type.startsWith('FRIEND_REQUEST')) return 'person-add-outline';
  if (type.startsWith('SQUAD_REQUEST')) return 'people-outline';
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
  };
}
