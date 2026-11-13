import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import { resolveGalleryAssets } from './media-gallery';
import { reportHandledFailure } from '@/observability/report-failure';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///app/Library/Caches/',
  copyAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 4_096 })),
  makeDirectoryAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-media-library', () => ({
  MediaType: { photo: 'photo', video: 'video' },
  getAssetInfoAsync: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));

const libraryUri = 'file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.MOV';
const videoAsset = {
  id: 'asset-1/L0/001',
  filename: 'IMG_0001.MOV',
  mediaType: 'video',
  width: 1920,
  height: 1080,
  duration: 12,
} as unknown as MediaLibrary.Asset;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(MediaLibrary.getAssetInfoAsync).mockResolvedValue({ localUri: libraryUri } as never);
});

// iOS 的 localUri 在照片库里:后台上传会话的系统进程读不到它,压缩没产出新文件时原片上传立刻失败。
test('on iOS the picked file is cloned into the app cache before it reaches the send pipeline', async () => {
  const [resolved] = await resolveGalleryAssets([videoAsset]);

  expect(FileSystem.copyAsync).toHaveBeenCalledWith({
    from: libraryUri,
    to: expect.stringMatching(/^file:\/\/\/app\/Library\/Caches\/chat-gallery\/[^/]+\.mov$/),
  });
  const copied = jest.mocked(FileSystem.copyAsync).mock.calls[0][0].to;
  expect(resolved).toEqual(expect.objectContaining({ uri: copied, fileName: 'IMG_0001.MOV', type: 'video', duration: 12_000 }));
  expect(FileSystem.getInfoAsync).toHaveBeenCalledWith(copied);
});

test('a failed copy reports and falls back to the library file instead of dropping the item', async () => {
  jest.mocked(FileSystem.copyAsync).mockRejectedValueOnce(new Error('not readable'));

  const [resolved] = await resolveGalleryAssets([videoAsset]);

  expect(resolved?.uri).toBe(libraryUri);
  expect(reportHandledFailure).toHaveBeenCalledWith('chatMediaPicker', 'copyAsset', expect.any(Error));
});

test('Android keeps the media store file as is, without reading asset info', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const androidAsset = { ...videoAsset, uri: 'file:///storage/emulated/0/DCIM/a.mp4' } as MediaLibrary.Asset;

  const [resolved] = await resolveGalleryAssets([androidAsset]);

  // getAssetInfoAsync also reads each photo's EXIF location on Android 10+, which needs
  // ACCESS_MEDIA_LOCATION — app.json leaves it off, so asset.uri is used directly.
  expect(MediaLibrary.getAssetInfoAsync).not.toHaveBeenCalled();
  expect(FileSystem.copyAsync).not.toHaveBeenCalled();
  expect(resolved?.uri).toBe('file:///storage/emulated/0/DCIM/a.mp4');
});
