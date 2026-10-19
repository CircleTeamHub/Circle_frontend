import { Platform } from 'react-native';

const store = new Map<string, string>();
const mockKv = {
  getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
};
const mockGetAndroidId = jest.fn();

jest.mock('@/storage/secure-kv', () => ({ getSecureKv: async () => mockKv }));
jest.mock('expo-application', () => ({
  getAndroidId: () => mockGetAndroidId(),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_alg: string, input: string) => {
    const { createHash } = jest.requireActual<typeof import('crypto')>('crypto');
    return createHash('sha256').update(input).digest('hex');
  }),
  randomUUID: jest.fn(() => '11111111-2222-4333-8444-555555555555'),
}));

function loadFresh(): typeof import('./device-id') {
  let mod!: typeof import('./device-id');
  jest.isolateModules(() => {
    mod = jest.requireActual('./device-id');
  });
  return mod;
}

const VALID = /^[A-Za-z0-9_-]{16,128}$/;

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(35);
  mockGetAndroidId.mockReturnValue('b83ac4219d56ef07');
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('android: a reinstall (empty secure storage) derives the same device id again', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const first = await loadFresh().getDeviceId();
  store.clear(); // 卸载重装：安全存储被清空
  const afterReinstall = await loadFresh().getDeviceId();

  expect(first).toMatch(VALID);
  expect(first).toMatch(/^a1-[0-9a-f]{64}$/);
  expect(afterReinstall).toBe(first);
  // 只发加盐摘要，不发 ANDROID_ID 原值。
  expect(first).not.toContain('b83ac4219d56ef07');
});

test('android: an install that already stored an id keeps it (its sessions are bound to it)', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  store.set('circle.device-id.v1', 'legacy-random-id-0001');

  await expect(loadFresh().getDeviceId()).resolves.toBe('legacy-random-id-0001');
});

test('android: a short or missing ANDROID_ID still yields a valid id', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  mockGetAndroidId.mockReturnValue('1a');
  await expect(loadFresh().getDeviceId()).resolves.toBe('11111111-2222-4333-8444-555555555555');

  store.clear();
  mockGetAndroidId.mockImplementation(() => {
    throw new Error('unavailable');
  });
  await expect(loadFresh().getDeviceId()).resolves.toBe(
    '11111111-2222-4333-8444-555555555555',
  );
});

test('ios keeps a random keychain id and never asks for ANDROID_ID', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  await expect(loadFresh().getDeviceId()).resolves.toBe(
    '11111111-2222-4333-8444-555555555555',
  );
  expect(mockGetAndroidId).not.toHaveBeenCalled();
});

test('pre-Oreo Android never derives device trust from the shared system ID', async () => {
 jest.replaceProperty(Platform, 'OS', 'android');
 jest.spyOn(Platform, 'Version', 'get').mockReturnValue(25);
 await expect(loadFresh().getDeviceId()).resolves.toBe('11111111-2222-4333-8444-555555555555');
 expect(mockGetAndroidId).not.toHaveBeenCalled();
});
test('a high-entropy unpadded Android ID remains stable across reinstalls', async () => {
 jest.replaceProperty(Platform, 'OS', 'android');
 mockGetAndroidId.mockReturnValue('b83ac4219d56ef0');
 const first=await loadFresh().getDeviceId();store.clear();
 expect(first).toMatch(/^a1-[0-9a-f]{64}$/);
 await expect(loadFresh().getDeviceId()).resolves.toBe(first);
});
