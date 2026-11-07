import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { createFreshConnectionTransport } from './fresh-connection-transport';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));

const native = { get: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
});
afterEach(() => jest.restoreAllMocks());

test('on Android it sends the GET through the native module and hands back a normal Response', async () => {
  native.get.mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'srv-1' },
    body: '{"code":0,"message":"ok","data":{"id":1}}',
  });
  const transport = createFreshConnectionTransport();

  const res = await transport!('https://api.example.test/api/v1/note', {
    headers: { Authorization: 'Bearer t', 'X-Request-Id': 'req-1' },
    timeoutMs: 12_500,
  });

  expect(requireOptionalNativeModule).toHaveBeenCalledWith('FreshConnection');
  expect(native.get).toHaveBeenCalledWith(
    'https://api.example.test/api/v1/note',
    { Authorization: 'Bearer t', 'X-Request-Id': 'req-1' },
    12_500,
  );
  expect(res.status).toBe(200);
  expect(res.ok).toBe(true);
  expect(res.headers.get('X-Request-Id')).toBe('srv-1');
  expect(JSON.parse(await res.text()).data.id).toBe(1);
});

test('an empty body (204 / 304) becomes a Response without a body', async () => {
  native.get.mockResolvedValue({ status: 204, headers: {}, body: '' });
  const res = await createFreshConnectionTransport()!('https://x.test/a', { headers: {}, timeoutMs: 5_000 });
  expect(res.status).toBe(204);
  expect(await res.text()).toBe('');
});

test('a native failure rejects, so the client treats it as a network failure', async () => {
  native.get.mockRejectedValue(new Error('ERR_FRESH_CONNECTION'));
  await expect(createFreshConnectionTransport()!('https://x.test/a', { headers: {}, timeoutMs: 5_000 })).rejects.toThrow();
});

test.each(['ios', 'web'] as const)('there is no fresh-connection transport on %s', (os) => {
  jest.replaceProperty(Platform, 'OS', os);
  expect(createFreshConnectionTransport()).toBeNull();
  expect(requireOptionalNativeModule).not.toHaveBeenCalled();
});

test('an older Android binary without the native module falls back to fetch', () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValueOnce(null);
  expect(createFreshConnectionTransport()).toBeNull();
});
