import { reportHandledFailure } from '@/observability/report-failure';
import { markFriendActivityRead } from '@/services/api/friends';
import { useFriendActivityUnreadStore } from '@/stores/friendActivityUnreadStore';

export async function markFriendActivitiesRead(activityIds: string[]): Promise<string[]> {
  const ids = [...new Set(activityIds)];
  const unreadStore = useFriendActivityUnreadStore.getState();

  // The server broadcasts the authoritative count before returning each read
  // response. Apply the local decrement first so those events cannot be
  // followed by a second decrement for the same activities.
  unreadStore.markRead(ids);
  const results = await Promise.all(
    ids.map(async (activityId) => {
      try {
        await markFriendActivityRead(activityId);
        return activityId;
      } catch (error) {
        reportHandledFailure('friendActivity', 'markRead', error);
        return null;
      }
    }),
  );
  const readIds = results.filter((id): id is string => id !== null);

  if (readIds.length !== ids.length) {
    await unreadStore.refresh();
  }

  return readIds;
}
