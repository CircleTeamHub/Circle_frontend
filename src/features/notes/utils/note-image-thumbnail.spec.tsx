import { manipulateAsync } from 'expo-image-manipulator';
import {
  requestUploadPresign,
  uploadLocalFileToPresignedUrl,
} from '@/services/api/upload';
import { uploadNoteImageThumbnail } from './note-image-thumbnail';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('@/services/api/upload', () => ({
  requestUploadPresign: jest.fn(),
  sanitizeUploadFilename: jest.fn((value: string) => value),
  uploadLocalFileToPresignedUrl: jest.fn(),
}));
jest.mock('@/observability/report-failure', () => ({
  reportHandledFailure: jest.fn(),
}));

const mockManipulateAsync = manipulateAsync as jest.MockedFunction<typeof manipulateAsync>;
const mockRequestUploadPresign = requestUploadPresign as jest.MockedFunction<
  typeof requestUploadPresign
>;
const mockUploadLocalFile = uploadLocalFileToPresignedUrl as jest.MockedFunction<
  typeof uploadLocalFileToPresignedUrl
>;

describe('uploadNoteImageThumbnail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManipulateAsync.mockResolvedValue({ uri: 'file:///thumb.jpg', width: 512, height: 384 });
  });

  it('uploads the small copy to the notes folder and returns its key', async () => {
    mockRequestUploadPresign.mockResolvedValue({
      uploadUrl: 'https://upload.test/thumb',
      key: 'notes/user-1/thumb.jpg',
      requiredHeaders: {},
    } as never);
    mockUploadLocalFile.mockResolvedValue(undefined);

    await expect(
      uploadNoteImageThumbnail('file:///original.jpg', 2048, 'original.jpg'),
    ).resolves.toBe('notes/user-1/thumb.jpg');

    expect(mockRequestUploadPresign).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'notes', contentType: 'image/jpeg', fileUri: 'file:///thumb.jpg' }),
    );
    // 和原图一样走 iOS 前台会话：人就停在编辑页等着。
    expect(mockUploadLocalFile).toHaveBeenCalledWith(
      'https://upload.test/thumb', 'image/jpeg', 'file:///thumb.jpg', {}, undefined, { foreground: true },
    );
  });

  it('skips images that are already small', async () => {
    await expect(
      uploadNoteImageThumbnail('file:///small.jpg', 400, 'small.jpg'),
    ).resolves.toBeNull();

    expect(mockRequestUploadPresign).not.toHaveBeenCalled();
  });

  it('never blocks the note upload when the thumbnail fails', async () => {
    mockRequestUploadPresign.mockRejectedValue(new Error('presign down'));

    await expect(
      uploadNoteImageThumbnail('file:///original.jpg', 2048, 'original.jpg'),
    ).resolves.toBeNull();

    expect(mockUploadLocalFile).not.toHaveBeenCalled();
  });
});
