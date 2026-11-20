import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { fetchWebPushPublicKey } from '@/services/api/notifications';
import { useAuthStore } from '@/stores/authStore';
import { reportHandledFailure } from '@/observability/report-failure';
import {
  currentWebPushSubscription,
  disableWebPush,
  isWebPushOwner,
  saveWebPush,
  webPushSupport,
} from '../services/web-push';

const prefix = 'settingsDetails.notifications.webPush';
type WebPushState =
  | { status: 'loading' | 'install' | 'unsupported' | 'unavailable' | 'error' }
  | { status: 'ready'; registration: ServiceWorkerRegistration; publicKey: string; subscribed: boolean };

export function useWebPushSettings() {
  const userId = useAuthStore(state => state.user?.id);
  const epoch = useAuthStore(state => state.sessionEpoch);
  const [state, setState] = useState<WebPushState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || !userId) return;
    let mounted = true;
    const support = webPushSupport();
    if (support !== 'available') {
      setState({ status: support });
      return;
    }
    setState({ status: 'loading' });
    setHint('');
    void Promise.all([
      fetchWebPushPublicKey(),
      navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready),
    ]).then(async ([publicKey, registration]) => {
      const subscription = await registration.pushManager.getSubscription();
      const subscribed = Boolean(subscription && Notification.permission === 'granted' &&
        await isWebPushOwner(subscription, userId));
      if (!mounted) return;
      setState(publicKey ? { status: 'ready', registration, publicKey, subscribed } : { status: 'unavailable' });
    }).catch(error => {
      reportHandledFailure('webPush', 'loadSettings', error);
      if (mounted) setState({ status: 'error' });
    });
    return () => { mounted = false; };
  }, [epoch, retry, userId]);

  async function toggle(value: boolean) {
    if (busy || !userId || state.status !== 'ready') return;
    const isCurrent = () => useAuthStore.getState().sessionEpoch === epoch;
    if (!isCurrent()) return;
    setBusy(true);
    setHint('');
    let stage: 'subscribe' | 'register' | 'disable' = value ? 'subscribe' : 'disable';
    try {
      if (value) {
        // Safari needs subscribe to be initiated by the user's tap.
        const subscription = await state.registration.pushManager.subscribe({
          applicationServerKey: state.publicKey, userVisibleOnly: true,
        });
        if (!isCurrent()) return;
        stage = 'register';
        try {
          await saveWebPush(subscription, userId, isCurrent);
        } catch (error) {
          await disableWebPush(subscription, isCurrent).catch(rollbackError =>
            reportHandledFailure('webPush', 'enableRollback', rollbackError));
          throw error;
        }
      } else {
        const subscription = await currentWebPushSubscription();
        if (subscription && await isWebPushOwner(subscription, userId)) {
          await disableWebPush(subscription, isCurrent);
        }
      }
      if (isCurrent()) setState({ ...state, subscribed: value });
    } catch (error) {
      // Declining the permission prompt is the user's choice, not a failure.
      if (stage !== 'subscribe' || Notification.permission === 'granted') {
        reportHandledFailure('webPush', 'toggle', error, { stage });
      }
      if (isCurrent()) setHint(Notification.permission === 'denied' ? `${prefix}.blocked` : `${prefix}.error`);
    } finally {
      setBusy(false);
    }
  }

  const labelKey = `${prefix}.label`;
  if (state.status === 'ready') {
    return {
      id: 'push', labelKey, type: 'toggle' as const, value: state.subscribed,
      subtitleKey: hint || `${prefix}.ready`, disabled: busy,
      onValueChange: (value: boolean) => void toggle(value),
    };
  }
  return {
    id: 'push', labelKey, subtitleKey: `${prefix}.${state.status}`,
    ...(state.status === 'error' ? { onPress: () => setRetry(n => n + 1) } : { type: 'info' as const }),
  };
}
