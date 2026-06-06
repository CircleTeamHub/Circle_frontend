import type { Ionicons } from '@expo/vector-icons';
import type { CircleActivityItem, CircleActivityType } from '@/types';

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

function iconFor(type: CircleActivityType): keyof typeof Ionicons.glyphMap {
  if (type.startsWith('POST_SIGNUP')) return 'hand-right-outline';
  if (type.startsWith('VERIFICATION')) return 'shield-checkmark-outline';
  return 'people-circle-outline';
}

export function mapActivityToRow(
  a: CircleActivityItem,
  t: TFunc,
): NotificationRowData {
  const excerpt = a.post?.excerpt ?? '';
  const label = t(`notifications.activity.${a.type}`, {
    circle: a.circleName,
    post: excerpt,
    defaultValue: a.circleName,
  });
  // When the i18n string does not interpolate the post excerpt itself (e.g.
  // a template without a {{post}} slot), still surface it so signup rows read
  // meaningfully. If `label` already contains the excerpt, don't duplicate.
  const summary =
    excerpt && !label.includes(excerpt) ? `${label} · ${excerpt}` : label;
  return {
    id: a.id,
    avatarName: a.actor.nickname,
    avatarUrl: a.actor.avatarUrl,
    title: a.actor.nickname,
    summary,
    icon: iconFor(a.type),
    previewImage: null,
    unread: a.readAt === null,
    createdAt: a.createdAt,
  };
}
