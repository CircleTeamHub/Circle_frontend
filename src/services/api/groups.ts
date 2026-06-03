import { apiClient } from './client';
import type { FriendReportCategory } from './friends';

export async function reportGroup(
  groupID: string,
  payload: {
    category: FriendReportCategory;
    description: string;
    evidence?: string[];
  },
) {
  return apiClient<void>(`/group/${groupID}/report`, {
    method: 'POST',
    body: payload,
  });
}
