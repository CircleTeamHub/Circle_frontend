import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { registerLogoutHandler } from '@/services/auth/session';
import { reportHandledFailure } from '@/observability/report-failure';
import { currentWebPushSubscription, disableWebPush, isWebPushOwner } from '../services/web-push';

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
    // A web reload can leave the previous push subscription active after its JS session is gone.
    void currentWebPushSubscription().then(async subscription => {
      if (subscription && !await isWebPushOwner(subscription, userId)) {
        await disableWebPush(subscription, isCurrent);
      }
    }).catch(error => reportHandledFailure('webPush', 'validateOwner', error));
    return removeIfOwned;
  }, [sessionEpoch, userId]);

  return null;
}
