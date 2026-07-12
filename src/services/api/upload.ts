import { apiClient } from '@/services/api/client';
import { API_URL } from '@/constants/config';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type * as NativeFS from 'react-native-fs';
import {
  expectShape,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';
import { reportError } from '@/observability/sentry';
import i18n from '@/i18n';

const SIGNED_URL_PATTERN = /https?:\/\/[^\s"'<>)]*\?[^\s"'<>)]*/gi;

function sanitizeUploadErrorForReport(error: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const safe = new Error(
    original.message.replace(SIGNED_URL_PATTERN, '[REDACTED_URL]'),
  );
  safe.name = original.name || 'UploadError';
  if (original.stack) {
    safe.stack = original.stack.replace(SIGNED_URL_PATTERN, '[REDACTED_URL]');
  }
  return safe;
}

/**
 * Runs a storage upload (raw PUT, not via apiClient so the API chokepoint never
 * sees it) and reports any failure to Sentry before re-throwing it unchanged.
 * The presigned URL is deliberately NOT included in the context — it carries a
 * signature.
 */
async function runStorageUpload<T>(
  context: { kind: string; contentType: string },
  task: () => Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    reportError(sanitizeUploadErrorForReport(error), {
      operation: 'upload',
      platform: Platform.OS,
      ...context,
    });
    throw error;
  }
}

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

export type UploadFolder =
  | 'avatars'
  | 'covers'
  | 'posts'
  | 'notes'
  | 'chat'
  | 'friends';

export type UploadPresignResponse = {
  uploadUrl: string;
  fileUrl: string;
  key: string;
};

// presign 返回的两个 URL 即将被当作信任凭证使用（PUT 上传时直接拼到 fetch）。
// 字段缺失或类型漂移会让 `new URL(...)` 抛 / fetch 直接挂；运行时守一道。
function isUploadPresignShape(value: unknown): value is UploadPresignResponse {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.uploadUrl) &&
    isNonEmptyString(value.fileUrl) &&
    isNonEmptyString(value.key)
  );
}

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

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

function rewriteLocalhostFileUrlForNativeDev(value: string) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return value;
  }

  try {
    const uploadUrl = new URL(value);
    const apiUrl = new URL(API_URL);

    if (
      LOCALHOST_HOSTNAMES.has(uploadUrl.hostname) &&
      !LOCALHOST_HOSTNAMES.has(apiUrl.hostname)
    ) {
      uploadUrl.protocol = apiUrl.protocol;
      uploadUrl.hostname = apiUrl.hostname;
      return uploadUrl.toString();
    }
  } catch {
    return value;
  }

  return value;
}

function assertPresignedUploadUrlReachableOnCurrentPlatform(value: string) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return;
  }

  try {
    const uploadUrl = new URL(value);
    const apiUrl = new URL(API_URL);

    if (
      LOCALHOST_HOSTNAMES.has(uploadUrl.hostname) &&
      !LOCALHOST_HOSTNAMES.has(apiUrl.hostname)
    ) {
      throw new Error(
        '后端返回了 localhost 的预签名上传地址。手机端无法访问宿主 localhost，且预签名 URL 的 host 参与签名，客户端改写 host 会导致 403。请把对象存储对外访问地址配置成宿主机 IP 或正式域名后再试。',
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
  }
}

function assertUploadUrlReachableOnCurrentPlatform(payload: UploadPresignResponse) {
  const rewritten = {
    ...payload,
    fileUrl: rewriteLocalhostFileUrlForNativeDev(payload.fileUrl),
  };

  assertPresignedUploadUrlReachableOnCurrentPlatform(rewritten.uploadUrl);

  return rewritten;
}

export async function requestUploadPresign(payload: {
  filename: string;
  contentType: string;
  folder: UploadFolder;
}) {
  const raw = await apiClient<UploadPresignResponse>('/upload/presign', {
    method: 'POST',
    body: payload,
  });
  const response = expectShape(
    raw,
    isUploadPresignShape,
    i18n.t('upload.errors.presignDataInvalid', {
      defaultValue: '预签名上传数据格式异常',
    }),
  );

  return assertUploadUrlReachableOnCurrentPlatform(response);
}

const UPLOAD_TIMEOUT_MS = 60_000;
type NativeFSModule = typeof NativeFS & { default?: typeof NativeFS };
let rnfsModule: typeof NativeFS | null = null;

function loadNativeFS() {
  if (!rnfsModule) {
    // Keep react-native-fs out of web/Expo Go startup paths.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-fs') as NativeFSModule;
    rnfsModule = loaded.default ?? loaded;
  }
  return rnfsModule;
}

export async function uploadFileToPresignedUrl(
  uploadUrl: string,
  contentType: string,
  body: Blob,
) {
  return runStorageUpload({ kind: 'presigned-put', contentType }, async () => {
    assertPresignedUploadUrlReachableOnCurrentPlatform(uploadUrl);
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
        throw new Error(
          i18n.t('common.errors.uploadTimeout', {
            defaultValue: '上传超时，请检查网络后重试',
          }),
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // 这个函数也被聊天图片 / 笔记附件 / 动态图等用，"头像上传失败" 误导用户。
      throw new Error(
        i18n.t('common.errors.uploadFailedWithStatus', {
          status: response.status,
          defaultValue: '上传失败 ({{status}})',
        }),
      );
    }
  });
}

/**
 * Race a long-running upload against a manual timeout. Android exposes an
 * RNFS job id, so that path can hard-cancel the native request on timeout.
 */
async function withUploadTimeout<T>(
  task: () => { promise: Promise<T>; jobId?: number },
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
): Promise<T> {
  const { promise, jobId } = task();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (typeof jobId === 'number') {
            const fs = loadNativeFS();
            if (typeof fs.stopUpload === 'function') {
              try {
                fs.stopUpload(jobId);
              } catch {
                // The Promise.race already rejects below; failed cleanup should
                // not mask the timeout reason shown to the user.
              }
            }
          }
          reject(new Error(
            i18n.t('common.errors.uploadTimeout', {
              defaultValue: '上传超时，请检查网络后重试',
            }),
          ));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function uploadLocalFileToPresignedUrl(
  uploadUrl: string,
  contentType: string,
  fileUri: string,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
) {
  return runStorageUpload({ kind: 'local-file', contentType }, async () => {
    assertPresignedUploadUrlReachableOnCurrentPlatform(uploadUrl);

    if (Platform.OS === 'android') {
      const RNFS = loadNativeFS();
      const response = await withUploadTimeout(() => {
        const handle = RNFS.uploadFiles({
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
        return { promise: handle.promise, jobId: handle.jobId };
      }, timeoutMs);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(
          i18n.t('common.errors.uploadFailedWithStatus', {
            status: response.statusCode,
            defaultValue: '上传失败 ({{status}})',
          }),
        );
      }

      return response;
    }

    const response = await withUploadTimeout(
      () => ({
        promise: FileSystem.uploadAsync(uploadUrl, fileUri, {
          headers: {
            'Content-Type': contentType,
          },
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        }),
      }),
      timeoutMs,
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        i18n.t('common.errors.uploadFailedWithStatus', {
          status: response.status,
          defaultValue: '上传失败 ({{status}})',
        }),
      );
    }

    return response;
  });
}
