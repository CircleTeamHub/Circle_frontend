import type { MyCirclePost } from '@/types';
import type { NotificationRowData } from './notification-summary';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

/** Maps one of the author's posts into a signup-management list row. */
export function mapMyPostToRow(p: MyCirclePost, t: TFunc): NotificationRowData {
  const title = p.excerpt || t('notifications.signupMgmt.untitledPost');
  const summary =
    p.unreadSignupCount > 0
      ? t('notifications.signupMgmt.rowWithUnread', {
          count: p.signupCount,
          unread: p.unreadSignupCount,
        })
      : t('notifications.signupMgmt.row', { count: p.signupCount });
  return {
    id: p.id,
    avatarName: title,
    avatarUrl: p.firstImage,
    title,
    summary,
    icon: 'megaphone-outline',
    previewImage: null,
    unread: p.unreadSignupCount > 0,
    createdAt: p.createdAt,
    verificationInvitationId: null,
  };
}
