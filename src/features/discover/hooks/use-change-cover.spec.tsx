import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
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
  loadImagePickerModule: jest.fn(),
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
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/stores/authStore', () => {
  const store = { user: { id: 'user-1' }, setUser: jest.fn() };
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
    '[useChangeCover] cover update failed',
    expect.objectContaining({ message: expect.stringContaining('[redacted-url]') }),
  );
  expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('upload.example.com');
  warnSpy.mockRestore();
});
