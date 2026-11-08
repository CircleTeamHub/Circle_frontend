import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useChangeCircleCover } from './use-change-circle-cover';
import { loadImagePickerModule } from '@/features/profile/image-picker';
import { requestUploadPresign, resolveUploadContentType, sanitizeUploadFilename, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { setCircleCover } from '@/services/api/circles';

jest.mock('@/features/profile/image-picker', () => ({
  ...jest.requireActual('@/features/profile/image-picker'),
  loadImagePickerModule: jest.fn(),
}));
const mockCropIfNeeded = jest.fn();
const mockCropShapes: string[] = [];
jest.mock('@/features/profile/image-crop-step', () => ({
  useImageCropStep: (shape: string) => {
    mockCropShapes.push(shape);
    return { cropIfNeeded: mockCropIfNeeded, cropper: 'cropper-node' };
  },
  getCropLibraryPickerOptions: () => ({}),
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  resolveUploadContentType: jest.fn(),
  sanitizeUploadFilename: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));
jest.mock('@/services/api/circles', () => ({ setCircleCover: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

const mockPicker = {
  getMediaLibraryPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};
const picked = { uri: 'file://cover.jpg', fileName: 'cover.jpg', mimeType: 'image/jpeg' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCropShapes.length = 0;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (loadImagePickerModule as jest.Mock).mockReturnValue(mockPicker);
  mockPicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [picked] });
  mockCropIfNeeded.mockReset().mockImplementation((asset: unknown) => Promise.resolve(asset));
  (resolveUploadContentType as jest.Mock).mockReturnValue('image/jpeg');
  (sanitizeUploadFilename as jest.Mock).mockReturnValue('cover.jpg');
  (requestUploadPresign as jest.Mock).mockResolvedValue({ uploadUrl: 'https://upload', fileUrl: 'https://cdn/cover.jpg', requiredHeaders: {} });
  (uploadLocalFileToPresignedUrl as jest.Mock).mockResolvedValue(undefined);
  (setCircleCover as jest.Mock).mockResolvedValue(undefined);
});

test('the library opens without native editing and asks for a free crop', async () => {
  const { result } = renderHook(() => useChangeCircleCover('c1', jest.fn()));
  await act(async () => { await result.current.changeCover(); });
  expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledWith({ quality: 0.8, mediaTypes: ['images'] });
  expect(mockCropShapes[0]).toBe('free');
  expect(result.current.cropper).toBe('cropper-node');
});

test('the cropped image is uploaded and saved as the circle cover', async () => {
  mockCropIfNeeded.mockResolvedValueOnce({ ...picked, uri: 'file://cropped.jpg' });
  const onChanged = jest.fn();
  const { result } = renderHook(() => useChangeCircleCover('c1', onChanged));
  await act(async () => { await result.current.changeCover(); });
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith('https://upload', 'image/jpeg', 'file://cropped.jpg', {});
  expect(setCircleCover).toHaveBeenCalledWith('c1', 'https://cdn/cover.jpg');
  expect(onChanged).toHaveBeenCalledWith('https://cdn/cover.jpg');
});

test('canceling the crop keeps the current cover and allows choosing again', async () => {
  mockCropIfNeeded.mockResolvedValueOnce(null);
  const { result } = renderHook(() => useChangeCircleCover('c1', jest.fn()));
  await act(async () => { await result.current.changeCover(); });
  expect(requestUploadPresign).not.toHaveBeenCalled();
  await act(async () => { await result.current.changeCover(); });
  expect(mockPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(2);
});
