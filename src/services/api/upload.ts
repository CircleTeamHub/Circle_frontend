import { apiClient } from '@/services/api/client';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import RNFS from 'react-native-fs';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
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
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
} as const;

export type UploadFolder = 'avatars' | 'covers' | 'posts' | 'notes' | 'chat';

export type UploadPresignResponse = {
  uploadUrl: string;
  fileUrl: string;
  key: string;
};

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

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

function assertUploadUrlReachableOnCurrentPlatform(payload: UploadPresignResponse) {
  if (Platform.OS !== 'android') {
    return payload;
  }

  let uploadUrl: URL;
  let fileUrl: URL;

  try {
    uploadUrl = new URL(payload.uploadUrl);
    fileUrl = new URL(payload.fileUrl);
  } catch {
    return payload;
  }

  if (
    LOCALHOST_HOSTNAMES.has(uploadUrl.hostname) ||
    LOCALHOST_HOSTNAMES.has(fileUrl.hostname)
  ) {
    throw new Error(
      '后端返回了 localhost 的头像上传地址。Android 设备/模拟器无法使用该地址，且预签名 URL 不能在客户端改写 host。请把对象存储对外访问地址配置成宿主机 IP 或正式域名后再试。',
    );
  }

  return payload;
}

export async function requestUploadPresign(payload: {
  filename: string;
  contentType: string;
  folder: UploadFolder;
}) {
  const response = await apiClient<UploadPresignResponse>('/upload/presign', {
    method: 'POST',
    body: payload,
  });

  return assertUploadUrlReachableOnCurrentPlatform(response);
}

const UPLOAD_TIMEOUT_MS = 60_000;

export async function uploadFileToPresignedUrl(
  uploadUrl: string,
  contentType: string,
  body: Blob,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('上传超时，请检查网络后重试');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`头像上传失败 (${response.status})`);
  }
}

export async function uploadLocalFileToPresignedUrl(
  uploadUrl: string,
  contentType: string,
  fileUri: string,
) {
  if (Platform.OS === 'android') {
    const { promise } = RNFS.uploadFiles({
      toUrl: uploadUrl,
      binaryStreamOnly: true,
      files: [
        {
          name: 'file',
          filename: fileUri.split('/').pop() || 'upload',
          filepath: fileUri.replace(/^file:\/\//, ''),
          filetype: contentType,
        },
      ],
      headers: {
        'Content-Type': contentType,
      },
      method: 'PUT',
    });

    const response = await promise;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`头像上传失败 (${response.statusCode})`);
    }

    return response;
  }

  const response = await FileSystem.uploadAsync(uploadUrl, fileUri, {
    headers: {
      'Content-Type': contentType,
    },
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`头像上传失败 (${response.status})`);
  }

  return response;
}
