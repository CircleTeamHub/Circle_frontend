import { apiClient } from '@/services/api/client';
import { markGroupWrite } from './group-writes';

export type GroupReviewAction = 'approve' | 'reject' | 'blacklist';
export type GroupReviewStatus = 'INVITED' | 'PENDING' | 'JOINED' | 'REJECTED' | 'DECLINED' | 'EXPIRED' | 'LEFT' | 'CANCELLED' | 'BLACKLISTED';
export type GroupReviewSource = 'INVITE' | 'QR' | 'APPLICATION' | 'UNKNOWN';
export interface GroupReviewPerson { id: string; nickname: string; accountId: string; avatarUrl: string | null }
export interface GroupReviewItem {
  id: string;
  conversationId: string;
  applicant: GroupReviewPerson;
  inviter: GroupReviewPerson | null;
  source: GroupReviewSource;
  status: GroupReviewStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
}
export interface GroupReviewPage {
  group: { id: string; name: string; circleId: string | null };
  items: GroupReviewItem[];
  nextCursor: string | null;
}
export function fetchGroupReviews(conversationId: string, options: { cursor?: string; keyword?: string } = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set('cursor', options.cursor);
  if (options.keyword) query.set('keyword', options.keyword);
  const suffix = query.toString();
  return apiClient<GroupReviewPage>(`/chat/groups/${encodeURIComponent(conversationId)}/reviews${suffix ? `?${suffix}` : ''}`);
}
export function actOnGroupReviews(conversationId: string, ids: string[], action: GroupReviewAction) {
  return markGroupWrite(apiClient<{ results: { id: string; ok: boolean; errorCode?: string }[] }>(
    `/chat/groups/${encodeURIComponent(conversationId)}/reviews/actions`,
    { method: 'POST', body: { ids, action } },
  ));
}
