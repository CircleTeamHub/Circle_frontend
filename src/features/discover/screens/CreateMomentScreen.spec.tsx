import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import CreateMomentScreen from './CreateMomentScreen';
import { createMoment } from '@/services/api/moments';
import { requestUploadPresign, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { maxMb?: number }) => options?.maxMb ? `${key}:${options.maxMb}` : key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }), Spacing: {}, Typography: {}, Radius: {} }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock('@/features/discover/store/use-moments-store', () => ({ useMomentsStore: () => jest.fn() }));
jest.mock('@/services/api/moments', () => ({ createMoment: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_e: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/constants/config', () => ({ LIMITS: { IMAGE_MAX_SIZE_MB: 50, VIDEO_MAX_SIZE_MB: 500 } }));
jest.mock('@/features/chat/utils/chat-image-compress', () => ({ prepareChatImageForUpload: jest.fn(async (input: unknown) => input) }));
jest.mock('@/features/chat/utils/chat-video-poster', () => ({ uploadChatVideoPoster: jest.fn(async () => null) }));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(async () => undefined),
  resolveUploadContentType: ({ mimeType }: { mimeType: string }) => mimeType,
  sanitizeUploadFilename: (name: string) => name,
}));

const assets = [
  { uri: 'file:///clip.mp4', fileName: 'clip.mp4', type: 'video', mimeType: 'video/mp4', width: 1280, height: 720, duration: 3000 },
  { uri: 'file:///photo.jpg', fileName: 'photo.jpg', type: 'image', mimeType: 'image/jpeg', width: 1200, height: 800 },
  { uri: 'file:///clip2.mov', fileName: 'clip2.mov', type: 'video', mimeType: 'video/quicktime', width: 720, height: 1280 },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets } as never);
  jest.mocked(requestUploadPresign).mockImplementation(async ({ filename }) => ({ uploadUrl: 'https://upload.test', fileUrl: `https://cdn.test/posts/me/${filename}`, key: `posts/me/${filename}`, requiredHeaders: { 'Content-Type': 'image/jpeg', 'Content-Length': '12', 'If-None-Match': '*' } }));
  jest.mocked(createMoment).mockResolvedValue({ id: 'new' } as never);
});

test('selects and publishes multiple videos mixed with images in selection order', async () => {
  render(<CreateMomentScreen />);
  fireEvent.press(screen.getByText('0/9'));
  await waitFor(() => expect(screen.getByText('3/9')).toBeTruthy());
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: 9, orderedSelection: true }));
  fireEvent.changeText(screen.getByPlaceholderText('moment.contentPlaceholder'), 'mixed');
  fireEvent.press(screen.getByText('moment.publish'));
  await waitFor(() => expect(createMoment).toHaveBeenCalled());
  expect(createMoment).toHaveBeenCalledWith(expect.objectContaining({ attachments: [
    expect.objectContaining({ type: 'video', key: 'posts/me/clip.mp4', duration: 3 }),
    expect.objectContaining({ type: 'image', key: 'posts/me/photo.jpg' }),
    expect.objectContaining({ type: 'video', key: 'posts/me/clip2.mov' }),
  ] }));
  expect(prepareChatImageForUpload).toHaveBeenCalledTimes(1);
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'video/mp4', 'file:///clip.mp4', expect.any(Object), 5 * 60_000,
  );
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'image/jpeg', 'file:///photo.jpg', expect.any(Object), undefined,
  );
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'video/quicktime', 'file:///clip2.mov', expect.any(Object), 5 * 60_000,
  );
});

test('rejects video over the server 100 MB limit before uploading', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ ...assets[0], fileSize: 101 * 1024 * 1024 }] } as never);
  render(<CreateMomentScreen />);
  fireEvent.press(screen.getByText('0/9'));
  await waitFor(() => expect(screen.getByText('1/9')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('moment.contentPlaceholder'), 'big');
  fireEvent.press(screen.getByText('moment.publish'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect(Alert.alert).toHaveBeenCalledWith('moment.publishFailed', 'upload.errors.fileTooLarge:100');
  expect(requestUploadPresign).not.toHaveBeenCalled();
  expect(createMoment).not.toHaveBeenCalled();
});
