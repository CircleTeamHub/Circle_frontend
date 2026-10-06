import { useNotificationCenterStore } from './use-notification-center-store';
import type { MyCirclePost, NotificationItem } from '@/types';

test('logout reset clears notifications from every domain and author signup posts', () => {
  const store = useNotificationCenterStore.getState();
  store.setInteractive([
    { id: 'private-moment', type: 'TRACE_LIKE' } as NotificationItem,
    { id: 'private-circle', type: 'CIRCLE_POST_PUBLISHED' } as NotificationItem,
  ]);
  store.setSignupPosts([{ id: 'private-post', unreadSignupCount: 2 } as MyCirclePost]);

  store.reset();

  expect(useNotificationCenterStore.getState().interactive).toEqual([]);
  expect(useNotificationCenterStore.getState().signupPosts).toEqual([]);
});
