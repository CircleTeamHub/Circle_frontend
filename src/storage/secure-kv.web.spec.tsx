import { getSecureKv } from './secure-kv.web';

test('web credentials stay in memory and legacy persistent values are removed', async () => {
  const entries = new Map<string, string>([
    ['circle-im.sec.access-token', 'legacy-access'],
    ['circle-im.sec.refresh-token', 'legacy-refresh'],
    ['unrelated', 'keep-me'],
  ]);
  let throwOnRemove = false;
  const localStorage = {
    get length() {
      return entries.size;
    },
    key: jest.fn((index: number) => [...entries.keys()][index] ?? null),
    getItem: jest.fn((key: string) => entries.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => entries.set(key, value)),
    removeItem: jest.fn((key: string) => {
      if (throwOnRemove) throw new Error('storage denied');
      entries.delete(key);
    }),
    clear: jest.fn(() => entries.clear()),
  } as unknown as Storage;
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });

  try {
    const secureKv = await getSecureKv();
    expect(entries.has('circle-im.sec.access-token')).toBe(false);
    expect(entries.has('circle-im.sec.refresh-token')).toBe(false);
    expect(entries.get('unrelated')).toBe('keep-me');

    await secureKv.setItemAsync('access-token', 'current-access');
    await secureKv.setItemAsync('refresh-token', 'current-refresh');
    expect(await secureKv.getItemAsync('access-token')).toBe('current-access');
    expect(await secureKv.getItemAsync('refresh-token')).toBe('current-refresh');
    expect(localStorage.setItem).not.toHaveBeenCalled();

    entries.set('circle-im.sec.failed-token', 'must-not-leak');
    throwOnRemove = true;
    expect(await secureKv.getItemAsync('failed-token')).toBeNull();
  } finally {
    if (priorWindow) {
      Object.defineProperty(globalThis, 'window', priorWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
