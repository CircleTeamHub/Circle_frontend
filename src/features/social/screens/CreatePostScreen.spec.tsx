import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import CreatePostScreen from './CreatePostScreen';
import { usePostFormStore } from '@/features/discover/store/use-post-form-store';
import { createPlazaPost } from '@/services/api/plaza';
import { requestUploadPresign, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';

const mockBack = jest.fn();
const mockPrepend = jest.fn();
const mockFetchMyCircles = jest.fn();
const circle = { id: 'c1', name: 'Circle' };

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/theme', () => ({
  ...jest.requireActual('@/theme/tokens'),
  useTheme: () => ({ colors: {} }),
}));
jest.mock('@/components/ui/themed-switch', () => ({ ThemedSwitch: () => null }));
jest.mock('@/components/ui/divider', () => ({ Divider: () => null }));
jest.mock('@/components/ui/nav-header', () => ({ NavHeader: () => null }));
jest.mock('@/components/ui/menu-row', () => ({ MenuRow: () => null }));
jest.mock('@/components/ui/option-picker-sheet', () => ({ OptionPickerSheet: () => null }));
jest.mock('@/components/ui/keyboard-avoiding-container', () => ({
  KeyboardAvoidingContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/features/discover/store/use-circles-store', () => ({
  useCirclesStore: () => mockFetchMyCircles,
}));
jest.mock('@/features/discover/store/use-discover-store', () => ({
  useDiscoverStore: () => mockPrepend,
}));
jest.mock('@/services/api/plaza', () => ({ createPlazaPost: jest.fn() }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_error: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/utils/idempotency-key', () => ({ generateIdempotencyKey: () => 'post-key' }));
jest.mock('@/features/chat/utils/chat-image-compress', () => ({
  prepareChatImageForUpload: jest.fn(async (input: unknown) => input),
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(async () => undefined),
  resolveUploadContentType: ({ mimeType }: { mimeType: string }) => mimeType,
  sanitizeUploadFilename: (name: string) => name,
}));

test('publishes a selected video with photos in separate media fields', async () => {
  usePostFormStore.setState({ selectedCircles: [circle], selectedCities: [], selectedNote: null });
  mockFetchMyCircles.mockResolvedValue({ ok: true, created: [], joined: [circle] });
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { type: 'video', uri: 'file:///clip.mov', fileName: 'clip.mov', mimeType: 'video/quicktime', width: 720, height: 1280 },
      { type: 'image', uri: 'file:///photo.jpg', fileName: 'photo.jpg', mimeType: 'image/jpeg', width: 1200, height: 800 },
    ],
  });
  jest.mocked(requestUploadPresign).mockImplementation(async ({ filename, contentType }) => ({
    uploadUrl: 'https://upload.test',
    fileUrl: `https://cdn.test/posts/me/${filename}`,
    key: `posts/me/${filename}`,
    requiredHeaders: { 'Content-Type': contentType, 'Content-Length': '12', 'If-None-Match': '*' },
  }));
  jest.mocked(createPlazaPost).mockResolvedValue({ id: 'published' } as never);
  render(<CreatePostScreen />);

  fireEvent.press(screen.getByText('0 / 9'));
  await screen.findByText('2 / 9');
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
    mediaTypes: ['images', 'videos'],
    selectionLimit: 9,
  }));
  fireEvent.changeText(screen.getByPlaceholderText('plaza.create.contentPlaceholder'), 'Post with a clip');
  fireEvent.press(screen.getByText('plaza.create.submit'));

  await waitFor(() => expect(createPlazaPost).toHaveBeenCalledWith(
    expect.objectContaining({
      content: 'Post with a clip',
      images: ['https://cdn.test/posts/me/photo.jpg'],
      videos: ['https://cdn.test/posts/me/clip.mov'],
    }),
    { idempotencyKey: 'post-key' },
  ));
  expect(prepareChatImageForUpload).toHaveBeenCalledTimes(1);
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test',
    'video/quicktime',
    'file:///clip.mov',
    expect.any(Object),
    5 * 60_000,
  );
  expect(mockBack).toHaveBeenCalledTimes(1);
});
