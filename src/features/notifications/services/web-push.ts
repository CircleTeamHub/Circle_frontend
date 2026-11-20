import { registerPushToken, revokePushToken } from '@/services/api/notifications';

const OWNER_KEY = 'windnote.web-push-owner';

export function webPushSupport(): 'install' | 'unsupported' | 'available' {
  if (typeof window === 'undefined') return 'unsupported';
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (appleMobile && !window.matchMedia('(display-mode: standalone)').matches &&
      !(navigator as Navigator & { standalone?: boolean }).standalone) return 'install';
  return window.isSecureContext && 'serviceWorker' in navigator &&
    'PushManager' in window && 'Notification' in window ? 'available' : 'unsupported';
}

export async function currentWebPushSubscription(): Promise<PushSubscription | null> {
  if (webPushSupport() !== 'available') return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration ? registration.pushManager.getSubscription() : null;
}

function subscriptionValues(subscription: PushSubscription): [string, string, string] {
  const { keys } = subscription.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error('Invalid browser push subscription');
  return [subscription.endpoint, keys.p256dh, keys.auth];
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function isWebPushOwner(subscription: PushSubscription, userId: string): Promise<boolean> {
  const [, , auth] = subscriptionValues(subscription);
  return localStorage.getItem(OWNER_KEY) === await digest('owner:' + auth + ':' + userId);
}

export async function saveWebPush(subscription: PushSubscription, userId: string, isCurrent: () => boolean) {
  const values = subscriptionValues(subscription);
  const auth = values[2];
  const [revocationSecret, owner] = await Promise.all([
    digest('revoke:' + auth), digest('owner:' + auth + ':' + userId),
  ]);
  if (!isCurrent()) return;
  const input = { token: JSON.stringify(values), revocationSecret, provider: 'web_push', platform: 'web' } as const;
  await registerPushToken(input);
  if (!isCurrent()) {
    await revokePushToken(input.token, revocationSecret);
    return;
  }
  localStorage.setItem(OWNER_KEY, owner);
}

export async function disableWebPush(subscription: PushSubscription, isCurrent: () => boolean) {
  const values = subscriptionValues(subscription);
  const secret = await digest('revoke:' + values[2]);
  if (!isCurrent()) return;
  const revoked = revokePushToken(JSON.stringify(values), secret).then(() => true, () => false);
  const unsubscribed = await subscription.unsubscribe().catch(() => false);
  if (!unsubscribed && !await revoked) throw new Error('Could not disable Web Push');
  if (isCurrent()) clearWebPushOwner();
}

export function clearWebPushOwner() {
  localStorage.removeItem(OWNER_KEY);
}
