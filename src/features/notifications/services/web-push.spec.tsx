import { webcrypto } from 'node:crypto';
import { Platform } from 'react-native';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import { registerPushToken, revokePushToken } from '@/services/api/notifications';
import { reportHandledFailure } from '@/observability/report-failure';
import type { SettingsDetailRow } from '@/features/profile/components/settings-detail';
import { WebPushSession } from '../components/WebPushSession';
import { useWebPushSettings } from '../hooks/use-web-push-settings';
import { saveWebPush } from './web-push';

type LogoutHandler = (context: { sessionEpoch: number; isCurrent: () => boolean }) => Promise<void> | void;

const mockAuth = { state: { user: { id: 'u1' } as { id: string } | null, sessionEpoch: 1 } };
const mockLogoutHandlers: LogoutHandler[] = [];

jest.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (state: typeof mockAuth.state) => unknown) => selector(mockAuth.state),
    { getState: () => mockAuth.state },
  ),
}));
jest.mock('@/services/auth/session', () => ({
  registerLogoutHandler: (handler: LogoutHandler) => {
    mockLogoutHandlers.push(handler);
    return () => { mockLogoutHandlers.splice(mockLogoutHandlers.indexOf(handler), 1); };
  },
}));
jest.mock('@/services/api/notifications', () => ({
  fetchWebPushPublicKey: jest.fn(),
  registerPushToken: jest.fn(),
  revokePushToken: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const OWNER_KEY = 'windnote.web-push-owner';
const ENDPOINT = 'https://web.push.apple.com/fixture';
const KEYS = { p256dh: 'BPublicKeyOfThisBrowser', auth: 'YXV0aC1zZWNyZXQ' };
const TOKEN = JSON.stringify([ENDPOINT, KEYS.p256dh, KEYS.auth]);

type FakeSubscription = { endpoint: string; toJSON: () => PushSubscriptionJSON; unsubscribe: jest.Mock };
const browser = {
  permission: 'granted' as NotificationPermission,
  subscription: null as FakeSubscription | null,
  storage: new Map<string, string>(),
  events: [] as string[],
};

function makeSubscription(): FakeSubscription {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: KEYS }),
    unsubscribe: jest.fn(async () => {
      browser.events.push('unsubscribe');
      browser.subscription = null;
      return true;
    }),
  };
}

const pushManager = {
  getSubscription: jest.fn(async () => browser.subscription),
  subscribe: jest.fn(async () => (browser.subscription = makeSubscription())),
};
const registration = { pushManager };

beforeAll(() => {
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  define('window', globalThis);
  define('isSecureContext', true);
  define('matchMedia', () => ({ matches: false }));
  define('PushManager', function PushManager() {});
  define('Notification', { get permission() { return browser.permission; } });
  define('crypto', webcrypto);
  define('localStorage', {
    getItem: (key: string) => browser.storage.get(key) ?? null,
    setItem: (key: string, value: string) => { browser.storage.set(key, value); },
    removeItem: (key: string) => { browser.storage.delete(key); },
  });
  define('navigator', {
    ...globalThis.navigator,
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0',
    platform: 'Linux x86_64',
    maxTouchPoints: 0,
    serviceWorker: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.state = { user: { id: 'u1' }, sessionEpoch: 1 };
  mockLogoutHandlers.length = 0;
  browser.permission = 'granted';
  browser.subscription = makeSubscription();
  browser.storage.clear();
  browser.events = [];
  jest.mocked(registerPushToken).mockResolvedValue({ deviceBound: true });
  jest.mocked(revokePushToken).mockImplementation(async () => { browser.events.push('revoke'); });
});

/** Puts the browser in the state a successful enable leaves behind for `userId`. */
async function enableFor(userId: string) {
  await saveWebPush(browser.subscription as unknown as PushSubscription, userId, () => true);
  jest.mocked(registerPushToken).mockClear();
}

describe('WebPushSession', () => {
  it('revokes and unsubscribes inside the logout handler, before the session is cleared', async () => {
    await enableFor('u1');
    render(<WebPushSession />);
    await waitFor(() => expect(registerPushToken).toHaveBeenCalledTimes(1));

    // session.ts runs every handler to completion, then clears auth.
    await Promise.all(mockLogoutHandlers.map(handler => handler({ sessionEpoch: 1, isCurrent: () => true })));
    browser.events.push('clearSession');

    expect(revokePushToken).toHaveBeenCalledWith(TOKEN, expect.any(String));
    expect(browser.events).toEqual(['revoke', 'unsubscribe', 'clearSession']);
    expect(browser.storage.has(OWNER_KEY)).toBe(false);
  });

  it('drops a subscription another account left behind and clears its owner state', async () => {
    await enableFor('u1');
    mockAuth.state = { user: { id: 'u2' }, sessionEpoch: 2 };
    render(<WebPushSession />);

    await waitFor(() => expect(browser.storage.has(OWNER_KEY)).toBe(false));
    expect(browser.events).toEqual(['revoke', 'unsubscribe']);
    expect(revokePushToken).toHaveBeenCalledWith(TOKEN, expect.any(String));
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it('re-registers its own subscription once per signed-in session', async () => {
    await enableFor('u1');
    const { rerender } = render(<WebPushSession />);
    await waitFor(() => expect(registerPushToken).toHaveBeenCalledTimes(1));
    rerender(<WebPushSession />);

    expect(registerPushToken).toHaveBeenCalledTimes(1);
    expect(registerPushToken).toHaveBeenCalledWith({
      token: TOKEN, revocationSecret: expect.any(String), provider: 'web_push', platform: 'web',
    });
    expect(browser.subscription?.unsubscribe).not.toHaveBeenCalled();
    expect(browser.storage.has(OWNER_KEY)).toBe(true);
  });

  it('reports a failed re-registration without touching the subscription', async () => {
    await enableFor('u1');
    const failure = new Error('register failed');
    jest.mocked(registerPushToken).mockRejectedValueOnce(failure);
    render(<WebPushSession />);

    await waitFor(() => expect(reportHandledFailure).toHaveBeenCalledWith('webPush', 'sessionSync', failure));
    expect(browser.subscription?.unsubscribe).not.toHaveBeenCalled();
  });

  it('clears the owner state when the browser no longer has the subscription', async () => {
    await enableFor('u1');
    browser.subscription = null;
    render(<WebPushSession />);

    await waitFor(() => expect(browser.storage.has(OWNER_KEY)).toBe(false));
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it('turns the subscription off when notifications were blocked in browser settings', async () => {
    await enableFor('u1');
    browser.permission = 'denied';
    render(<WebPushSession />);

    await waitFor(() => expect(browser.storage.has(OWNER_KEY)).toBe(false));
    expect(browser.events).toEqual(['revoke', 'unsubscribe']);
    expect(registerPushToken).not.toHaveBeenCalled();
  });
});

describe('useWebPushSettings', () => {
  it('subscribes within the tap, then rolls back to off and reports a failed registration', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const { fetchWebPushPublicKey } = jest.requireMock('@/services/api/notifications');
    jest.mocked(fetchWebPushPublicKey).mockResolvedValue('BServerKey');
    browser.subscription = null;
    const failure = new Error('register failed');
    jest.mocked(registerPushToken).mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useWebPushSettings(jest.fn()) as SettingsDetailRow);
    await waitFor(() => expect(result.current.type).toBe('toggle'));
    expect(result.current.value).toBe(false);

    act(() => result.current.onValueChange?.(true));
    // Safari only honours subscribe() when it starts before the first await of the tap.
    expect(pushManager.subscribe).toHaveBeenCalledWith({ applicationServerKey: 'BServerKey', userVisibleOnly: true });

    await waitFor(() => expect(result.current.subtitleKey).toBe('settingsDetails.notifications.webPush.error'));
    expect(result.current.value).toBe(false);
    expect(browser.events).toEqual(['revoke', 'unsubscribe']);
    expect(browser.subscription).toBeNull();
    expect(browser.storage.has(OWNER_KEY)).toBe(false);
    expect(reportHandledFailure).toHaveBeenCalledWith('webPush', 'toggle', failure, { stage: 'register' });
  });

  it('on iPhone Safari the row opens the add-to-home-screen steps instead of a dead hint', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const userAgent = navigator.userAgent;
    Object.assign(navigator, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Safari/604.1' });
    const onInstall = jest.fn();
    try {
      const { result } = renderHook(() => useWebPushSettings(onInstall) as SettingsDetailRow);
      expect(result.current.subtitleKey).toBe('settingsDetails.notifications.webPush.install');
      expect(result.current.type).toBeUndefined();
      act(() => result.current.onPress?.());
      expect(onInstall).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(navigator, { userAgent });
    }
  });
});
