import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import WebRoutePrefetch from './WebRoutePrefetch.web';

const first = '/_expo/static/js/web/Notes-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js';
const second = '/_expo/static/js/web/Media-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.js';
const third = '/_expo/static/js/web/+not-found-cccccccccccccccccccccccccccccccc.js';
const origin = 'https://example.test';

const mockAuth = {
  isAuthenticated: true,
  isLoading: false,
  webSessionInvalidated: false,
  onboardingRequired: false,
};
let mockFocused = true;

jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof mockAuth) => unknown) => selector(mockAuth),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));

type FakeLink = {
  rel: string;
  as: string;
  href: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  setAttribute: jest.Mock;
  remove: () => void;
};

let metadata: string | null;
let links: FakeLink[];
let resources: string[];
let visibility: 'visible' | 'hidden';
let events: EventTarget;
let saveData: boolean;
let createElement: jest.Mock;
let querySelectorAll: jest.Mock;
const originals = new Map<string, PropertyDescriptor | undefined>();

function display() {
  return (
    <>
      <WebRoutePrefetch />
      <Text>Home</Text>
    </>
  );
}

function changeVisibility(next: typeof visibility) {
  visibility = next;
  events.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.assign(mockAuth, {
    isAuthenticated: true,
    isLoading: false,
    webSessionInvalidated: false,
    onboardingRequired: false,
  });
  mockFocused = true;
  metadata = JSON.stringify([first, second, third]);
  links = [];
  resources = [];
  visibility = 'visible';
  events = new EventTarget();
  saveData = false;
  querySelectorAll = jest.fn(() => links);
  createElement = jest.fn(() => {
    const link: FakeLink = {
      rel: '',
      as: '',
      href: '',
      onload: null,
      onerror: null,
      setAttribute: jest.fn(),
      remove: () => {
        links = links.filter((entry) => entry !== link);
      },
    };
    return link;
  });

  const globals = {
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      getElementById: (id: string) =>
        id === 'windnote-web-prefetch-assets' && metadata !== null
          ? { getAttribute: () => 'application/json', textContent: metadata }
          : null,
      createElement,
      head: {
        append: (link: FakeLink) => links.push(link),
        querySelectorAll,
      },
    },
    location: { origin },
    performance: {
      getEntriesByName: (name: string) => resources.filter((url) => url === name),
    },
    navigator: {
      connection: {
        get saveData() {
          return saveData;
        },
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
});

afterEach(() => {
  jest.useRealTimers();
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  originals.clear();
});

test.each([
  ['isAuthenticated', false],
  ['isLoading', true],
  ['webSessionInvalidated', true],
  ['onboardingRequired', true],
] as const)('waits for eligible auth state when %s is %s', (key, value) => {
  mockAuth[key] = value;
  const home = render(display());
  jest.advanceTimersByTime(5000);
  expect(createElement).not.toHaveBeenCalled();

  mockAuth[key] = !value;
  home.rerender(display());
  jest.advanceTimersByTime(1499);
  expect(createElement).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(links.map(({ href }) => href)).toEqual([origin + first]);
});

test('preloads classic scripts serially with low priority after home commits', () => {
  render(display());
  jest.advanceTimersByTime(1499);
  expect(createElement).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(createElement.mock.calls).toEqual([['link']]);
  expect(links[0]).toMatchObject({ rel: 'preload', as: 'script', href: origin + first });
  expect(links[0].setAttribute).toHaveBeenCalledWith('fetchpriority', 'low');

  jest.advanceTimersByTime(5000);
  expect(links).toHaveLength(1);
  links[0].onload?.();
  jest.advanceTimersByTime(249);
  expect(links).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(links.map(({ href }) => href)).toEqual([origin + first, origin + second]);
});

test('skips invalid paths, duplicate entries, completed links and existing resource entries', () => {
  const home = render(display());
  resources = [origin + second];
  metadata = JSON.stringify([first, second, first, 'https://other.test' + third, '/other.js', third]);
  jest.advanceTimersByTime(1500);
  expect(links.map(({ href }) => href)).toEqual([origin + first]);
  links[0].onload?.();

  mockFocused = false;
  home.rerender(display());
  mockFocused = true;
  home.rerender(display());
  jest.advanceTimersByTime(1500);
  expect(links.map(({ href }) => href)).toEqual([origin + first, origin + third]);
});

test('advances after a preload error and after a 30-second timeout', () => {
  render(display());
  jest.advanceTimersByTime(1500);
  const errored = links[0];
  errored?.onerror?.();
  expect(errored?.onload).toBeNull();
  expect(links).toHaveLength(0);
  jest.advanceTimersByTime(250);
  expect(links.map(({ href }) => href)).toEqual([origin + second]);
  const stalled = links[0];
  jest.advanceTimersByTime(29999);
  expect(links).toEqual([stalled]);
  jest.advanceTimersByTime(1);
  expect(stalled.onerror).toBeNull();
  expect(links).toHaveLength(0);
  jest.advanceTimersByTime(250);
  expect(links.map(({ href }) => href)).toEqual([origin + third]);
});

test('pauses while hidden and resumes completed work when visible', () => {
  changeVisibility('hidden');
  render(display());
  jest.advanceTimersByTime(5000);
  expect(createElement).not.toHaveBeenCalled();
  changeVisibility('visible');
  jest.advanceTimersByTime(1500);
  expect(links.map(({ href }) => href)).toEqual([origin + first]);
  links[0].onload?.();
  jest.advanceTimersByTime(250);
  const unfinished = links[1];
  changeVisibility('hidden');
  expect(unfinished.onerror).toBeNull();
  expect(links.map(({ href }) => href)).toEqual([origin + first]);
  jest.advanceTimersByTime(35000);
  changeVisibility('visible');
  jest.advanceTimersByTime(1500);
  expect(links.map(({ href }) => href)).toEqual([origin + first, origin + second]);
});

test.each(['logout', 'blur', 'unmount'])('stops the unfinished preload on %s', (event) => {
  const home = render(display());
  jest.advanceTimersByTime(1500);
  const unfinished = links[0];
  if (event === 'unmount') {
    home.unmount();
  } else {
    mockAuth.isAuthenticated = event !== 'logout';
    mockFocused = event !== 'blur';
    home.rerender(display());
  }
  expect(unfinished?.onload).toBeNull();
  expect(unfinished?.onerror).toBeNull();
  expect(links).toHaveLength(0);
  changeVisibility('hidden');
  changeVisibility('visible');
  jest.advanceTimersByTime(35000);
  expect(createElement).toHaveBeenCalledTimes(1);
});

test.each(['save data', 'missing metadata', 'malformed metadata'])('does no work with %s', (condition) => {
  saveData = condition === 'save data';
  if (condition !== 'save data') {
    metadata = condition === 'missing metadata' ? null : '[';
  }
  render(display());
  jest.advanceTimersByTime(5000);
  expect(createElement).not.toHaveBeenCalled();
});

test('uses one DOM query when refocusing after hundreds of completed preloads', () => {
  const assets = Array.from(
    { length: 448 },
    (_, index) => '/_expo/static/js/web/Route-' + index.toString(16).padStart(32, '0') + '.js'
  );
  metadata = JSON.stringify(assets);
  const home = render(display());
  jest.advanceTimersByTime(1500);
  for (const asset of assets) {
    const link = links[links.length - 1];
    expect(link.href).toBe(origin + asset);
    link.onload?.();
    jest.advanceTimersByTime(250);
  }
  mockFocused = false;
  home.rerender(display());
  querySelectorAll.mockClear();
  createElement.mockClear();
  mockFocused = true;
  home.rerender(display());
  jest.advanceTimersByTime(1500);

  expect(createElement).not.toHaveBeenCalled();
  expect(querySelectorAll).toHaveBeenCalledTimes(1);
});
