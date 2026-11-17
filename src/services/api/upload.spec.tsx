import { apiClient } from '@/services/api/client';
import { requestUploadPresign } from './upload';

jest.mock('@/services/api/client', () => ({ apiClient: jest.fn() }));
jest.mock('@/constants/config', () => ({
  API_URL: 'https://api.example.test/api/v1',
}));
jest.mock('@/stores/upload-progress-store', () => ({
  captureUploadProgressScope: jest.fn(() => () => true),
  startUploadProgress: jest.fn(),
}));
jest.mock('@/observability/sentry', () => ({ reportError: jest.fn() }));
jest.mock('@/observability/tracing', () => ({
  startOperationSpan: jest.fn(() => ({ end: jest.fn() })),
}));

const response = {
  uploadUrl: 'https://storage.example.test/signed-put',
  fileUrl: 'https://cdn.example.test/avatars/user/avatar.jpg',
  key: 'avatars/user/avatar.jpg',
  requiredHeaders: {
    'Content-Type': 'image/jpeg',
    'Content-Length': '12',
    'If-None-Match': '*',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(apiClient).mockResolvedValue(response as never);
});

test('sends an eager-upload purpose unchanged', async () => {
  await requestUploadPresign({
    filename: 'avatar.jpg',
    contentType: 'image/jpeg',
    folder: 'avatars',
    purpose: 'PROFILE_AVATAR',
    sizeBytes: 12,
  });

  expect(apiClient).toHaveBeenCalledWith('/upload/presign', {
    method: 'POST',
    body: {
      filename: 'avatar.jpg',
      contentType: 'image/jpeg',
      folder: 'avatars',
      sizeBytes: 12,
      purpose: 'PROFILE_AVATAR',
    },
  });
});

test('omits purpose for existing non-eager uploads', async () => {
  await requestUploadPresign({
    filename: 'cover.jpg',
    contentType: 'image/jpeg',
    folder: 'covers',
    sizeBytes: 12,
  });

  expect(apiClient).toHaveBeenCalledWith(
    '/upload/presign',
    expect.objectContaining({
      body: expect.not.objectContaining({ purpose: expect.anything() }),
    }),
  );
});

test('rejects a purpose that does not match its upload folder locally', async () => {
  await expect(
    requestUploadPresign({
      filename: 'avatar.jpg',
      contentType: 'image/jpeg',
      folder: 'posts',
      purpose: 'PROFILE_AVATAR',
      sizeBytes: 12,
    }),
  ).rejects.toThrow('Upload purpose does not match folder');

  expect(apiClient).not.toHaveBeenCalled();
});
