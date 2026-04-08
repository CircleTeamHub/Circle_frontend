import { apiClient } from '@/services/api/client';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
]);

const CONTENT_TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
} as const;

export type UploadFolder = 'avatars' | 'covers' | 'posts';

export type UploadPresignResponse = {
  uploadUrl: string;
  fileUrl: string;
  key: string;
};

export function sanitizeUploadFilename(filename: string) {
  return filename
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]/g, '-');
}

export function resolveUploadContentType({
  mimeType,
  fileName,
}: {
  mimeType?: string | null;
  fileName?: string | null;
}) {
  if (mimeType && ALLOWED_CONTENT_TYPES.has(mimeType)) {
    return mimeType;
  }

  const extension = fileName?.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXTENSION[
    extension as keyof typeof CONTENT_TYPE_BY_EXTENSION
  ] ?? null;
}

export async function requestUploadPresign(payload: {
  filename: string;
  contentType: string;
  folder: UploadFolder;
}) {
  return apiClient<UploadPresignResponse>('/upload/presign', {
    method: 'POST',
    body: payload,
  });
}

export async function uploadFileToPresignedUrl(
  uploadUrl: string,
  contentType: string,
  body: Blob,
) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`头像上传失败 (${response.status})`);
  }
}
