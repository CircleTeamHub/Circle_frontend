import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import CreateMomentScreen from './CreateMomentScreen';
import { createMoment } from '@/services/api/moments';
import { requestUploadPresign, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';
import { ApiError } from '@/services/api/api-error';

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
let mockKeySequence = 0;
jest.mock('@/utils/idempotency-key', () => ({ generateIdempotencyKey: () => `key-${++mockKeySequence}` }));
jest.mock('@/services/api/errors', () => ({ getApiErrorMessage: (_e: unknown, fallback: string) => fallback }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/constants/config', () => ({ LIMITS: { POST_MAX_MEDIA: 9, IMAGE_MAX_SIZE_MB: 50, VIDEO_MAX_SIZE_MB: 500 } }));
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
  mockKeySequence = 0;
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
  ] }), { idempotencyKey: 'key-1' });
  expect(prepareChatImageForUpload).toHaveBeenCalledTimes(1);
  const progress = { progressKey: expect.any(String), foreground: true };
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'video/mp4', 'file:///clip.mp4', expect.any(Object), 5 * 60_000, progress,
  );
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'image/jpeg', 'file:///photo.jpg', expect.any(Object), undefined, progress,
  );
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'video/quicktime', 'file:///clip2.mov', expect.any(Object), 5 * 60_000, progress,
  );
});

test('starts uploading picked media before publish is pressed', async () => {
  render(<CreateMomentScreen />);
  fireEvent.press(screen.getByText('0/9'));
  await waitFor(() => expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(3));
  expect(createMoment).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByPlaceholderText('moment.contentPlaceholder'), 'ready');
  fireEvent.press(screen.getByText('moment.publish'));
  await waitFor(() => expect(createMoment).toHaveBeenCalledTimes(1));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(3);
});

test('turns away a video over the server 100 MB limit when it is picked', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ ...assets[0], fileSize: 101 * 1024 * 1024 }, assets[1]] } as never);
  render(<CreateMomentScreen />);
  fireEvent.press(screen.getByText('0/9'));
  await waitFor(() => expect(screen.getByText('1/9')).toBeTruthy());
  expect(Alert.alert).toHaveBeenCalledWith('plaza.create.pickerFailed', 'upload.errors.fileTooLarge:100');
  await waitFor(() => expect(requestUploadPresign).toHaveBeenCalledTimes(1));
  expect(requestUploadPresign).toHaveBeenCalledWith(expect.objectContaining({ filename: 'photo.jpg' }));
});

test.each(['image', 'video', 'mixed'])('limits %s selections to nine total media and publishes all nine', async (kind) => {
  const selected = Array.from({ length: 10 }, (_, index) => {
    const asset = assets[kind === 'video' || (kind === 'mixed' && index % 2 === 0) ? 0 : 1];
    return { ...asset, uri: `file:///media-${index}`, fileName: `media-${index}.${asset.type === 'video' ? 'mp4' : 'jpg'}` };
  });
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: selected } as never);
  render(<CreateMomentScreen />);
  fireEvent.press(screen.getByText('0/9'));
  await waitFor(() => expect(screen.getAllByLabelText('moment.removeMedia')).toHaveLength(9));
  expect(screen.queryByLabelText('moment.selectMedia')).toBeNull();
  expect(screen.getByText('moment.mediaLimitHint')).toBeTruthy();
  fireEvent.changeText(screen.getByPlaceholderText('moment.contentPlaceholder'), 'nine media');
  fireEvent.press(screen.getByText('moment.publish'));
  await waitFor(() => expect(createMoment).toHaveBeenCalledTimes(1));
  expect(jest.mocked(createMoment).mock.calls[0][0].attachments?.map(item => item.type)).toEqual(selected.slice(0, 9).map(item => item.type));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(9);
});

test('reserves remaining shared slots when adding another batch of images and videos', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValueOnce({ canceled: false, assets: [...assets, ...assets] } as never)
    .mockResolvedValueOnce({ canceled: false, assets: [...assets, ...assets] } as never);
  render(<CreateMomentScreen />);
  fireEvent.press(screen.getByText('0/9'));
  await waitFor(() => expect(screen.getByText('6/9')).toBeTruthy());
  fireEvent.press(screen.getByText('6/9'));
  await waitFor(() => expect(screen.getAllByLabelText('moment.removeMedia')).toHaveLength(9));
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 3 }));
  expect(screen.queryByLabelText('moment.selectMedia')).toBeNull();
});

const sentKeys = () => jest.mocked(createMoment).mock.calls.map(([, options]) => options.idempotencyKey);

async function pickOnePhotoAndWrite(text: string) {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [assets[1]] } as never);
  render(<CreateMomentScreen />);
  fireEvent.press(screen.getByText('0/9'));
  await waitFor(() => expect(screen.getByText('1/9')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('moment.contentPlaceholder'), text);
}

test('two taps before React re-renders publish once', async () => {
  await pickOnePhotoAndWrite('once');
  let node = screen.getByText('moment.publish');
  while (!node.props.onPress) node = node.parent!;
  const { onPress } = node.props;
  act(() => {
    onPress();
    onPress();
  });

  await waitFor(() => expect(createMoment).toHaveBeenCalled());
  expect(createMoment).toHaveBeenCalledTimes(1);
  expect(requestUploadPresign).toHaveBeenCalledTimes(1);
});

test('retrying a timed-out publish reuses its key and the already uploaded media', async () => {
  jest.mocked(createMoment)
    .mockRejectedValueOnce(new ApiError('timeout', { status: 0, failureKind: 'timeout' }))
    .mockResolvedValue({ id: 'new' } as never);
  await pickOnePhotoAndWrite('retry me');

  fireEvent.press(screen.getByText('moment.publish'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('moment.publishFailed', 'moment.publishFailed'));
  fireEvent.press(screen.getByText('moment.publish'));

  await waitFor(() => expect(createMoment).toHaveBeenCalledTimes(2));
  expect(sentKeys()).toEqual(['key-1', 'key-1']);
  expect(jest.mocked(createMoment).mock.calls[1][0]).toEqual(jest.mocked(createMoment).mock.calls[0][0]);
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(1);
});

test('a definitive rejection or edited text publishes with a new key', async () => {
  jest.mocked(createMoment)
    .mockRejectedValueOnce(new ApiError('bad', { status: 400, errorCode: 'TRACE_EMPTY_COMMENT' }))
    .mockRejectedValueOnce(new ApiError('timeout', { status: 0, failureKind: 'timeout' }))
    .mockResolvedValue({ id: 'new' } as never);
  await pickOnePhotoAndWrite('first');

  fireEvent.press(screen.getByText('moment.publish'));
  await waitFor(() => expect(createMoment).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText('moment.publish')).toBeTruthy());
  fireEvent.press(screen.getByText('moment.publish'));
  await waitFor(() => expect(createMoment).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText('moment.publish')).toBeTruthy());
  fireEvent.changeText(screen.getByPlaceholderText('moment.contentPlaceholder'), 'edited');
  fireEvent.press(screen.getByText('moment.publish'));

  await waitFor(() => expect(createMoment).toHaveBeenCalledTimes(3));
  expect(sentKeys()).toEqual(['key-1', 'key-2', 'key-3']);
});
