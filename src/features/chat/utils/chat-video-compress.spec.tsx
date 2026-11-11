import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { prepareChatVideoForUpload } from './chat-video-compress';
import { reportHandledFailure } from '@/observability/report-failure';

jest.mock('expo', () => ({ requireOptionalNativeModule: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const source = { uri: 'file:///original.mov', width: 1920, height: 1080, duration: 8_000, fileSize: 8_000_000 };
const output = { id: 'owned-output', uri: 'file:///compressed.mp4', width: 720, height: 1280, duration: 8_000, fileSize: 1_000_000 };
const native = { compress: jest.fn(), release: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  native.compress.mockResolvedValue(output);
  native.release.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test.each(['android', 'ios'] as const)('uses %s output dimensions, byte count and MP4 type, then releases only its owned output', async (os) => {
  jest.replaceProperty(Platform, 'OS', os);
  const prepared = await prepareChatVideoForUpload(source, 'original.mov', 'video/quicktime');
  expect(native.compress).toHaveBeenCalledWith(source.uri);
  expect(prepared).toMatchObject({ asset: { uri: output.uri, width: 720, height: 1280, fileSize: 1_000_000, duration: 8_000 }, filename: 'original.mp4', contentType: 'video/mp4' });
  await prepared.cleanup?.();
  expect(native.release).toHaveBeenCalledWith(output.id);
});

test.each(['android', 'ios', 'web'] as const)('keeps sending the original on %s when the binary has no native module', async (os) => {
  jest.replaceProperty(Platform, 'OS', os);
  jest.mocked(requireOptionalNativeModule).mockReturnValueOnce(null);
  expect(await prepareChatVideoForUpload(source, 'original.mov', 'video/quicktime')).toEqual({ asset: source, filename: 'original.mov', contentType: 'video/quicktime' });
});

test('keeps the original when native compression reports no useful size reduction', async () => {
  native.compress.mockResolvedValueOnce(null);
  const prepared = await prepareChatVideoForUpload(source, 'original.mov', 'video/quicktime');
  expect(prepared.asset).toBe(source);
  expect(prepared.cleanup).toBeUndefined();
  expect(native.release).not.toHaveBeenCalled();
});

test('falls back on a codec error without recording the private source or native error text', async () => {
  native.compress.mockRejectedValueOnce(new Error('decoder failed at file:///private/account/video.mov'));
  expect((await prepareChatVideoForUpload(source, 'original.mov', 'video/quicktime')).asset).toBe(source);
  expect(reportHandledFailure).toHaveBeenCalledWith('chatMedia', 'videoCompression', expect.any(Error));
  expect((jest.mocked(reportHandledFailure).mock.calls[0][2] as Error).message).toBe('Video compression failed');
});

test('a cleanup failure does not turn a successful upload into a failed message', async () => {
  native.release.mockRejectedValueOnce(new Error('private cache path'));
  const prepared = await prepareChatVideoForUpload(source, 'original.mov', 'video/quicktime');
  await expect(prepared.cleanup?.()).resolves.toBeUndefined();
  expect(reportHandledFailure).toHaveBeenCalledWith('chatMedia', 'videoCompressionCleanup', expect.any(Error));
});
