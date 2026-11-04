import { manipulateAsync } from 'expo-image-manipulator';
import {
  requestUploadPresign,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { uploadChatImageThumbnail } from './image-thumbnail';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  sanitizeUploadFilename: jest.fn((value: string) => value),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));

const mockManipulateAsync = manipulateAsync as jest.MockedFunction<
  typeof manipulateAsync
>;
const mockRequestUploadPresign = requestUploadPresign as jest.MockedFunction<
  typeof requestUploadPresign
>;
const mockUploadLocalFile =
  uploadLocalFileToPresignedUrl as jest.MockedFunction<
    typeof uploadLocalFileToPresignedUrl
  >;

describe('uploadChatImageThumbnail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManipulateAsync.mockResolvedValue({
      uri: 'file:///thumb.jpg',
      width: 512,
      height: 384,
    });
  });

  it('returns null when thumbnail presigning fails', async () => {
    mockRequestUploadPresign.mockRejectedValue(new Error('presign down'));

    await expect(
      uploadChatImageThumbnail('file:///original.jpg', 2048, 'original.jpg'),
    ).resolves.toBeNull();

    expect(mockUploadLocalFile).not.toHaveBeenCalled();
  });

  it('checks the session after deferred presign and skips upload when the guard throws', async () => {
    let resolvePresign!: (value: never) => void;
    let markPresignStarted!: () => void;
    const presignStarted = new Promise<void>((resolve) => { markPresignStarted = resolve; });
    const presignWait = new Promise<never>((resolve) => { resolvePresign = resolve; });
    mockRequestUploadPresign.mockImplementationOnce(() => {
      markPresignStarted();
      return presignWait;
    });
    const beforeUpload = jest.fn(() => { throw new Error('session changed'); });
    const uploading = uploadChatImageThumbnail('file:///original.jpg', 2048, 'original.jpg', beforeUpload);
    await presignStarted;
    expect(beforeUpload).not.toHaveBeenCalled();
    resolvePresign({ uploadUrl: 'https://upload.test/thumb', key: 'chat/thumb.jpg', requiredHeaders: {} } as never);
    await expect(uploading).resolves.toBeNull();
    expect(beforeUpload).toHaveBeenCalledTimes(1);
    expect(mockUploadLocalFile).not.toHaveBeenCalled();
  });
});
