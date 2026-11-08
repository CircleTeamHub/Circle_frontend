import React from 'react';
import { Alert, Platform, Text } from 'react-native';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { getCropLibraryPickerOptions, useImageCropStep, type ImageCropShape } from './image-crop-step';
import { reportHandledFailure } from '@/observability/report-failure';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/components/app/UploadProgressHost', () => ({ UploadProgressHost: () => null }));
jest.mock('@/theme', () => ({ Spacing: { sm: 8, md: 16 }, Typography: { body: {}, h3: {} } }));

// 手势和几何已由 free-photo-cropper.spec 与 photo-editor.test 覆盖,这里只需要它上报的裁剪框。
let mockReportCrop: (crop: unknown) => void;
let mockSquare: boolean | undefined;
jest.mock('@/features/chat/components/free-photo-cropper', () => ({
  FreePhotoCropper: ({ onCropChange, square }: { onCropChange: (crop: unknown) => void; square?: boolean }) => {
    mockReportCrop = onCropChange;
    mockSquare = square;
    return null;
  },
}));

const photo = { uri: 'file:///a.heic', width: 1200, height: 800, fileName: 'IMG_1.heic', mimeType: 'image/heic', fileSize: 9000, type: 'image', assetId: 'x' } as ImagePickerAsset;
const crop = { originX: 200, originY: 0, width: 800, height: 800 };
const originalOS = Platform.OS;

function Harness({ onReady, shape }: { onReady: (api: ReturnType<typeof useImageCropStep>) => void; shape: ImageCropShape }) {
  const api = useImageCropStep(shape);
  onReady(api);
  return <><Text>host</Text>{api.cropper}</>;
}
function start(asset: ImagePickerAsset = photo, shape: ImageCropShape = 'square') {
  let api!: ReturnType<typeof useImageCropStep>;
  render(<Harness shape={shape} onReady={(next) => { api = next; }} />);
  let result!: Promise<ImagePickerAsset | null>;
  act(() => { result = api.cropIfNeeded(asset); });
  return result;
}
async function advance(ms: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}
/** 走完等待系统相册关闭的那段时间，裁剪页已经出现。 */
async function open(asset: ImagePickerAsset = photo, shape: ImageCropShape = 'square') {
  const result = start(asset, shape);
  await advance(1000);
  return { result };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(manipulateAsync).mockResolvedValue({ uri: 'file:///cropped', width: 800, height: 800 });
});
afterEach(() => jest.useRealTimers());
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS }));

test.each([
  ['square', { allowsEditing: true, aspect: [1, 1] }],
  ['free', { allowsEditing: true }],
] as const)('%s crops: iOS picks with the instant library and Android keeps the system editor', (shape, android) => {
  expect(getCropLibraryPickerOptions(shape)).toEqual({});
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  expect(getCropLibraryPickerOptions(shape)).toEqual(android);
});

test('where the system already cropped, the asset passes through with no extra step', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const { result } = renderHook(() => useImageCropStep('square'));
  await expect(result.current.cropIfNeeded(photo)).resolves.toBe(photo);
  expect(result.current.cropper).toBeNull();
});

test('the crop step waits for the system picker to finish closing, or UIKit drops the presentation', async () => {
  start();
  await advance(300);
  expect(screen.queryByLabelText('common.confirm')).toBeNull();
  await advance(200);
  expect(screen.getByLabelText('common.confirm')).toBeTruthy();
});

test('the crop step locks the frame to a square', async () => {
  await open();
  expect(mockSquare).toBe(true);
  expect(screen.getByText('chat.photoEditor.cropSquare')).toBeTruthy();
});

test('covers and backgrounds crop at any ratio', async () => {
  await open(photo, 'free');
  expect(mockSquare).toBe(false);
  expect(screen.getByText('chat.photoEditor.freeCropTitle')).toBeTruthy();
});

test('confirming writes the selected square and describes the new file for upload', async () => {
  const { result } = await open();
  act(() => mockReportCrop(crop));
  fireEvent.press(screen.getByLabelText('common.confirm'));
  await expect(result).resolves.toEqual(expect.objectContaining({
    uri: 'file:///cropped', width: 800, height: 800, mimeType: 'image/jpeg', fileName: 'IMG_1.jpg', fileSize: undefined,
  }));
  expect(manipulateAsync).toHaveBeenCalledWith(photo.uri, [{ crop }], { compress: 0.8, format: SaveFormat.JPEG });
  await waitFor(() => expect(screen.queryByLabelText('common.confirm')).toBeNull());
});

test('a transparent PNG badge stays PNG so its background is not flattened', async () => {
  const { result } = await open({ ...photo, uri: 'file:///b.png', fileName: 'badge.png', mimeType: 'image/png' });
  act(() => mockReportCrop(crop));
  fireEvent.press(screen.getByLabelText('common.confirm'));
  await expect(result).resolves.toEqual(expect.objectContaining({ mimeType: 'image/png', fileName: 'badge.png' }));
  expect(manipulateAsync).toHaveBeenCalledWith('file:///b.png', [{ crop }], { compress: 1, format: SaveFormat.PNG });
});

test('canceling resolves to nothing and writes no file', async () => {
  const { result } = await open();
  fireEvent.press(screen.getByLabelText('common.cancel'));
  await expect(result).resolves.toBeNull();
  expect(manipulateAsync).not.toHaveBeenCalled();
});

test('confirm does nothing until the frame has been measured', async () => {
  await open();
  fireEvent.press(screen.getByLabelText('common.confirm'));
  expect(manipulateAsync).not.toHaveBeenCalled();
});

test('a double tap on confirm writes one file', async () => {
  let finish!: (value: { uri: string; width: number; height: number }) => void;
  jest.mocked(manipulateAsync).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const { result } = await open();
  act(() => mockReportCrop(crop));
  fireEvent.press(screen.getByLabelText('common.confirm'));
  fireEvent.press(screen.getByLabelText('common.confirm'));
  await act(async () => finish({ uri: 'file:///cropped', width: 800, height: 800 }));
  await result;
  expect(manipulateAsync).toHaveBeenCalledTimes(1);
});

test('a failed write reports, keeps the step open and allows retrying', async () => {
  jest.mocked(manipulateAsync).mockRejectedValueOnce(new Error('disk full'));
  await open();
  act(() => mockReportCrop(crop));
  fireEvent.press(screen.getByLabelText('common.confirm'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('chat.photoEditor.editFailedTitle', 'chat.photoEditor.editFailedMessage'));
  expect(reportHandledFailure).toHaveBeenCalledWith('imageCrop', 'squareCrop', expect.any(Error));
  fireEvent.press(screen.getByLabelText('common.confirm'));
  await waitFor(() => expect(manipulateAsync).toHaveBeenCalledTimes(2));
});
