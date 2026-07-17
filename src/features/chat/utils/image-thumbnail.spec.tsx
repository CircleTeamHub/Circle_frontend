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
});
