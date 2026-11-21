import { Platform } from 'react-native';

// Module state (the saved prompt, installed flag) lives for the page's lifetime, so every test
// loads a fresh copy — together with its own React / testing-library so hooks share one renderer.
type Loaded = typeof import('./home-screen-install') &
  typeof import('../hooks/use-add-to-home-screen') &
  Pick<typeof import('@testing-library/react-native/pure'), 'act' | 'renderHook'>;

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
const WECHAT_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

const browser = { standalone: false, userAgent: SAFARI_IPHONE, listeners: new Map<string, (event: Event) => void>() };

let loaded: Loaded;

function load(os: 'web' | 'ios' = 'web'): Loaded {
  // react-native exposes Platform through a lazy getter, so once the isolate block returns the
  // module reads the shared copy; set both.
  jest.replaceProperty(Platform, 'OS', os);
  jest.isolateModules(() => {
    jest.requireActual('react-native').Platform.OS = os;
    const { act, renderHook } = jest.requireActual('@testing-library/react-native/pure');
    loaded = { ...jest.requireActual('./home-screen-install'), ...jest.requireActual('../hooks/use-add-to-home-screen'), act, renderHook };
  });
  loaded.listenForInstallPrompt();
  return loaded;
}

function fire(type: string, event: Event) {
  loaded.act(() => browser.listeners.get(type)?.(event));
}

function installPromptEvent(outcome: 'accepted' | 'dismissed') {
  return {
    preventDefault: jest.fn(),
    prompt: jest.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  } as unknown as Event & { preventDefault: jest.Mock; prompt: jest.Mock };
}

beforeAll(() => {
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  define('window', globalThis);
  define('matchMedia', () => ({ matches: browser.standalone }));
  define('addEventListener', (type: string, listener: (event: Event) => void) => {
    browser.listeners.set(type, listener);
  });
  define('navigator', {
    get userAgent() { return browser.userAgent; },
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
});

beforeEach(() => {
  browser.standalone = false;
  browser.userAgent = SAFARI_IPHONE;
  browser.listeners.clear();
});

test('iPhone Safari outside the home screen gets the step-by-step guide', () => {
  const { homeScreenInstallMode, isAppleInAppBrowser } = load();
  expect(homeScreenInstallMode()).toBe('guide');
  expect(isAppleInAppBrowser()).toBe(false);
});

test('an app already opened from the home screen offers nothing', () => {
  browser.standalone = true;
  expect(load().homeScreenInstallMode()).toBeNull();
});

test('only in-app browsers on iPhone are told to switch to Safari', () => {
  browser.userAgent = WECHAT_IPHONE;
  expect(load().isAppleInAppBrowser()).toBe(true);
  browser.userAgent = CHROME_IPHONE;
  expect(load().isAppleInAppBrowser()).toBe(false);
});

test('a browser without an install prompt offers nothing until one arrives', () => {
  browser.userAgent = CHROME_ANDROID;
  Object.assign(navigator, { platform: 'Linux armv8l', maxTouchPoints: 5 });
  const { homeScreenInstallMode } = load();
  expect(homeScreenInstallMode()).toBeNull();
  Object.assign(navigator, { platform: 'iPhone' });
});

test('the add button shows the browser install prompt once, inside the tap', async () => {
  browser.userAgent = CHROME_ANDROID;
  const { useAddToHomeScreen, renderHook, act } = load();
  const { result } = renderHook(() => useAddToHomeScreen());
  const event = installPromptEvent('accepted');

  fire('beforeinstallprompt', event);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(result.current.mode).toBe('prompt');

  act(() => result.current.start());
  // prompt() needs the user's tap, so it must run before anything is awaited.
  expect(event.prompt).toHaveBeenCalledTimes(1);
  expect(result.current.guideVisible).toBe(false);
  expect(result.current.mode).toBeNull();
  await act(async () => {});
});

test('installing from the browser menu removes the entry', () => {
  browser.userAgent = CHROME_ANDROID;
  const { homeScreenInstallMode } = load();
  fire('beforeinstallprompt', installPromptEvent('dismissed'));
  fire('appinstalled', new Event('appinstalled'));
  expect(homeScreenInstallMode()).toBeNull();
});

test('on iPhone the add button opens the guide instead', () => {
  const { useAddToHomeScreen, renderHook, act } = load();
  const { result } = renderHook(() => useAddToHomeScreen());
  act(() => result.current.start());
  expect(result.current.guideVisible).toBe(true);
  act(() => result.current.closeGuide());
  expect(result.current.guideVisible).toBe(false);
});

test('native apps never show it', () => {
  expect(load('ios').homeScreenInstallMode()).toBeNull();
});
