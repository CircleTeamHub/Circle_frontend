import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { requestUploadPresign, uploadLocalFileToPresignedUrl } from '@/services/api/upload';
import { prepareChatImageForUpload } from '@/features/chat/utils/chat-image-compress';
import { useCircleForm } from './use-circle-form';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/observability/report-failure', () => ({ reportHandledFailure: jest.fn() }));
jest.mock('@/features/chat/utils/chat-image-compress', () => ({
  prepareChatImageForUpload: jest.fn(async (input: { uri: string }) => ({
    ...input,
    uri: `${input.uri}.small.jpg`,
    contentType: 'image/jpeg',
    filename: 'avatar.jpg',
  })),
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  uploadLocalFileToPresignedUrl: jest.fn(),
  resolveUploadContentType: ({ mimeType }: { mimeType?: string }) => mimeType,
  sanitizeUploadFilename: (name: string) => name,
}));

const photo = (uri: string) => ({ uri, width: 4000, height: 3000, mimeType: 'image/jpeg', type: 'image' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requestUploadPresign).mockImplementation(async ({ fileUri }) => ({
    uploadUrl: 'https://upload.test',
    fileUrl: `https://cdn.test/avatars/${String(fileUri).split('/').pop()}`,
    key: 'avatars/a.jpg',
    requiredHeaders: { 'Content-Type': 'image/jpeg', 'Content-Length': '12', 'If-None-Match': '*' },
  }) as never);
  jest.mocked(uploadLocalFileToPresignedUrl).mockResolvedValue(undefined as never);
});

test('a picked avatar is compressed and uploaded right away, and settle reuses the result', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [photo('file:///big.jpg')],
  } as never);
  const { result } = renderHook(() => useCircleForm());

  await act(async () => {
    await result.current.handlePickAvatar();
  });
  expect(result.current.pickedAvatarUri).toBe('file:///big.jpg');
  expect(prepareChatImageForUpload).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///big.jpg' }));
  await waitFor(() => expect(result.current.avatarUpload?.status).toBe('done'));
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledWith(
    'https://upload.test', 'image/jpeg', 'file:///big.jpg.small.jpg', expect.any(Object), undefined,
    { progressKey: result.current.avatarUpload?.id, foreground: true },
  );

  let url: string | null = null;
  await act(async () => {
    url = await result.current.settleAvatar();
  });
  expect(url).toBe('https://cdn.test/avatars/big.jpg.small.jpg');
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(1);
});

test('picking another avatar replaces the first one', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValueOnce({ canceled: false, assets: [photo('file:///first.jpg')] } as never)
    .mockResolvedValueOnce({ canceled: false, assets: [photo('file:///second.jpg')] } as never);
  const { result } = renderHook(() => useCircleForm());

  await act(async () => {
    await result.current.handlePickAvatar();
  });
  await act(async () => {
    await result.current.handlePickAvatar();
  });

  let url: string | null = null;
  await act(async () => {
    url = await result.current.settleAvatar();
  });
  expect(result.current.avatarUri).toBe('file:///second.jpg');
  expect(url).toBe('https://cdn.test/avatars/second.jpg.small.jpg');
});

test('settle gives null when the avatar still fails after the retry', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [photo('file:///big.jpg')],
  } as never);
  jest.mocked(uploadLocalFileToPresignedUrl).mockRejectedValue(new Error('network'));
  const { result } = renderHook(() => useCircleForm());

  await act(async () => {
    await result.current.handlePickAvatar();
  });
  let url: string | null = 'unset';
  await act(async () => {
    url = await result.current.settleAvatar();
  });
  expect(url).toBeNull();
  expect(uploadLocalFileToPresignedUrl).toHaveBeenCalledTimes(2);
});
