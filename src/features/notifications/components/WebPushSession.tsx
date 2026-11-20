import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { registerLogoutHandler } from '@/services/auth/session';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  clearWebPushOwner,
  currentWebPushSubscription,
  disableWebPush,
  isWebPushOwner,
  saveWebPush,
} from '../services/web-push';

export function WebPushSession() {
  const userId = useAuthStore(state => state.user?.id);
  const sessionEpoch = useAuthStore(state => state.sessionEpoch);

  useEffect(() => {
    if (!userId) return;
    const isCurrent = () => useAuthStore.getState().sessionEpoch === sessionEpoch;
    const removeIfOwned = registerLogoutHandler(async context => {
      if (!context.isCurrent() || !isCurrent()) return;
      const subscription = await currentWebPushSubscription();
      if (subscription && await isWebPushOwner(subscription, userId)) {
        await disableWebPush(subscription, isCurrent);
      }
    });
    void (async () => {
      const subscription = await currentWebPushSubscription();
      if (!subscription) {
        // The browser dropped the subscription (site data or permission reset): show the toggle as off.
        clearWebPushOwner();
        return;
      }
      // A web reload can leave the previous account's subscription behind, and a
      // permission blocked in browser settings must not keep the toggle on.
      if (!await isWebPushOwner(subscription, userId) || Notification.permission !== 'granted') {
        await disableWebPush(subscription, isCurrent);
        return;
      }
      // Native re-registers on every launch; doing the same here revives a row the
      // server disabled after a transient push-service error.
      await saveWebPush(subscription, userId, isCurrent);
    })().catch(error => reportHandledFailure('webPush', 'sessionSync', error));
    return removeIfOwned;
  }, [sessionEpoch, userId]);

  return null;
}
