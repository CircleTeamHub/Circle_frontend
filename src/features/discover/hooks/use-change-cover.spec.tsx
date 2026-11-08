import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { readUserProfileCache, writeUserProfileCache } from '@/features/user/profile-cache';
import { useChangeCover } from './use-change-cover';
import { loadImagePickerModule } from '@/features/profile/image-picker';
import {
  requestUploadPresign,
  resolveUploadContentType,
  sanitizeUploadFilename,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { updateUserProfile } from '@/services/api/profile';

jest.mock('@/features/profile/image-picker', () => ({
  ...jest.requireActual('@/features/profile/image-picker'),
  loadImagePickerModule: jest.fn(),
}));
const mockCropIfNeeded = jest.fn();
const mockCropShapes: string[] = [];
let mockInAppCrop = false;
jest.mock('@/features/profile/image-crop-step', () => ({
  useImageCropStep: (shape: string) => {
    mockCropShapes.push(shape);
    return { cropIfNeeded: mockCropIfNeeded, cropper: 'cropper-node' };
  },
  getCropLibraryPickerOptions: () => (mockInAppCrop ? {} : { allowsEditing: true }),
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  resolveUploadContentType: jest.fn(),
  sanitizeUploadFilename: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));
jest.mock('@/services/api/profile', () => ({ updateUserProfile: jest.fn() }));
jest.mock('react-i18next', () => {
  const t = (key: string) => key;
  // profile-cache → services/api/friends → api client 会把 @/i18n 带进来。
  return { useTranslation: () => ({ t }), initReactI18next: { type: '3rdParty', init: () => {} } };
});
// 资料缓存在原生端只在加密库就绪后才工作;给它一个内存 MMKV。
jest.mock('@/storage/encrypted-init', () => {
  const instance = jest.requireActual('react-native-mmkv').createMMKV({ id: 'spec' });
  return { getEncryptedInstance: () => instance, initEncryptedStorage: async () => instance };
});
jest.mock('@/stores/authStore', () => {
  const store = { sessionEpoch: 11, user: { id: 'user-1' }, setUser: jest.fn() };
  const useAuthStore = (selector: (s: typeof store) => unknown) =>
    selector(store);
  useAuthStore.getState = () => store;
  return { useAuthStore };
});

const mockPicker = {
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInAppCrop = false;
  mockCropShapes.length = 0;
  mockCropIfNeeded.mockReset().mockImplementation((asset: unknown) => Promise.resolve(asset));
  Object.assign(useAuthStore.getState(), { sessionEpoch: 11, user: { id: 'user-1' } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (loadImagePickerModule as jest.Mock).mockReturnValue(mockPicker);
  mockPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
  });
  mockPicker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file://cover.jpg', fileName: 'cover.jpg', mimeType: 'image/jpeg' },
    ],
  });
  (resolveUploadContentType as jest.Mock).mockReturnValue('image/jpeg');
  (sanitizeUploadFilename as jest.Mock).mockReturnValue('cover.jpg');
  (requestUploadPresign as jest.Mock).mockResolvedValue({
    uploadUrl: 'https://upload',
    fileUrl: 'https://cdn/cover.jpg',
  });
  (uploadLocalFileToPresignedUrl as jest.Mock).mockResolvedValue(undefined);
  (updateUserProfile as jest.Mock).mockResolvedValue({
    id: 'user-1',
    cover: 'https://cdn/cover.jpg',
  });
});

test('concurrent changeCover calls upload only once', async () => {
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeCover('user-1', onChanged));

  // Two fast taps: the second must be rejected by the inFlightRef guard before
  // it can open a second picker or fire a second upload.
  await act(async () => {
    await Promise.all([
      result.current.changeCover(),
      result.current.changeCover(),
    ]);
  });

  expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  // 上传前先由原生编辑器确认封面裁剪。
  expect(mockPicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith({
    quality: 0.8,
    mediaTypes: ['images'],
    allowsEditing: true,
  });
  expect(requestUploadPresign).toHaveBeenCalledTimes(1);
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(1);
  expect(updateUserProfile).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledWith('https://cdn/cover.jpg');
});

test('a second changeCover after the first completes is allowed', async () => {
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeCover('user-1', onChanged));

  await act(async () => {
    await result.current.changeCover();
  });
  await act(async () => {
    await result.current.changeCover();
  });

  // The guard releases on completion, so sequential edits still work.
  expect(requestUploadPresign).toHaveBeenCalledTimes(2);
});

test('upload failures show generic copy and log redacted diagnostics', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const sensitiveError = new Error(
    'upload failed https://upload.example.com/covers/private-key?token=secret',
  );
  (uploadLocalFileToPresignedUrl as jest.Mock).mockRejectedValue(sensitiveError);

  const { result } = renderHook(() => useChangeCover('user-1', jest.fn()));

  await act(async () => {
    await result.current.changeCover();
  });

  expect(Alert.alert).toHaveBeenCalledWith(
    'moment.coverUpdateFailed',
    'common.networkError',
  );
  expect(Alert.alert).not.toHaveBeenCalledWith(
    'moment.coverUpdateFailed',
    expect.stringContaining('upload.example.com'),
  );
  expect(warnSpy).toHaveBeenCalledWith(
    '[profile] coverUpdate failed',
    expect.objectContaining({ errorName: 'Error' }),
  );
  expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('upload.example.com');
  warnSpy.mockRestore();
});

test('successful cover update refreshes the existing account-scoped album cache', async () => {
  writeUserProfileCache(11, 'user-1', { album: { at: 1, value: { id: 'user-1', nickname: 'Me', avatarUrl: 'avatar', cover: 'old', signature: '' } } });
  const { result } = renderHook(() => useChangeCover('user-1', jest.fn()));
  await act(async () => { await result.current.changeCover(); });
  expect(readUserProfileCache(11, 'user-1')?.album?.value.cover).toBe('https://cdn/cover.jpg');
});

test('a completed cover update cannot replace another signed-in account', async () => {
  let finishUpdate: (user: Awaited<ReturnType<typeof updateUserProfile>>) => void = () => {};
  (updateUserProfile as jest.Mock).mockImplementation(() => new Promise((resolve) => { finishUpdate = resolve; }));
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeCover('user-1', onChanged));
  let operation: Promise<void>;
  await act(async () => { operation = result.current.changeCover(); });
  expect(updateUserProfile).toHaveBeenCalled();
  Object.assign(useAuthStore.getState(), { sessionEpoch: 12, user: { id: 'another-user' } });
  await act(async () => { finishUpdate({ id: 'user-1', cover: 'https://cdn/cover.jpg' } as Awaited<ReturnType<typeof updateUserProfile>>); await operation; });
  expect(useAuthStore.getState().setUser).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});

describe('free crop on the fast library picker', () => {
  beforeEach(() => { mockInAppCrop = true; });

  test('the library opens without native editing and asks for a free crop', async () => {
    const { result } = renderHook(() => useChangeCover('user-1', jest.fn()));
    await act(async () => { await result.current.changeCover(); });
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith({ quality: 0.8, mediaTypes: ['images'] });
    expect(mockCropShapes[0]).toBe('free');
    expect(result.current.cropper).toBe('cropper-node');
  });

  test('the cropped image is what gets uploaded', async () => {
    mockCropIfNeeded.mockResolvedValueOnce({ uri: 'file://cropped.jpg', fileName: 'cover.jpg', mimeType: 'image/jpeg' });
    const { result } = renderHook(() => useChangeCover('user-1', jest.fn()));
    await act(async () => { await result.current.changeCover(); });
    expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith('https://upload', 'image/jpeg', 'file://cropped.jpg', undefined);
  });

  test('canceling the crop keeps the current cover and allows choosing again', async () => {
    mockCropIfNeeded.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useChangeCover('user-1', jest.fn()));
    await act(async () => { await result.current.changeCover(); });
    expect(requestUploadPresign).not.toHaveBeenCalled();
    await act(async () => { await result.current.changeCover(); });
    expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(2);
  });
});
