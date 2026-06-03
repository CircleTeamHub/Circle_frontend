import { apiClient } from '@/services/api/client';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  expectShape,
  isNonEmptyString,
  isPlainObject,
} from '@/utils/validate';

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
  // iOS 模拟器和 Android 模拟器对 localhost 的处理不同 —— iOS 模拟器可以访问宿主
  // localhost；Android emulator 用 10.0.2.2；**物理设备两边都不行**。模拟器命中 localhost
  // 我们多报一次错也无害（其实模拟器 dev 也很少自己发上传），所以两个平台都检查。
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
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
      '后端返回了 localhost 的上传地址。手机端无法访问宿主 localhost；预签名 URL 又不能在客户端改写 host。请把对象存储对外访问地址配置成宿主机 IP 或正式域名后再试。',
    );
  }

  return payload;
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
    '预签名上传数据格式异常',
  );

  return assertUploadUrlReachableOnCurrentPlatform(response);
}

const UPLOAD_TIMEOUT_MS = 60_000;
type NativeFS = typeof import('react-native-fs');
type NativeFSModule = NativeFS & { default?: NativeFS };
let rnfsPromise: Promise<NativeFS> | null = null;

async function loadNativeFS() {
  rnfsPromise ??= import('react-native-fs').then((module) => {
    const loaded = module as NativeFSModule;
    return loaded.default ?? loaded;
  });
  return rnfsPromise;
}

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
    // 这个函数也被聊天图片 / 笔记附件 / 动态图等用，"头像上传失败" 误导用户。
    throw new Error(`上传失败 (${response.status})`);
  }
}

/**
 * Race a long-running upload against a manual timeout. Both platform paths
 * (`RNFS.uploadFiles` on Android, `FileSystem.uploadAsync` on iOS) lack a
 * native cancel-on-timeout signal in this version, so we wrap with Promise.race.
 * The underlying request keeps running after timeout — the timeout only prevents
 * the UI from waiting forever. Android exposes `RNFS.stopUpload(jobId)` for hard
 * cancel; we use it when available.
 */
async function withUploadTimeout<T>(
  task: () => { promise: Promise<T>; jobId?: number },
): Promise<T> {
  const { promise, jobId } = task();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          if (typeof jobId === 'number') {
            // RNFS 是惰性加载的；此时已在 android 上传路径中，缓存的 promise
            // 已解析，stopUpload 取消底层任务。失败就算了 —— 我们已经 reject 了。
            void loadNativeFS().then((fs) => {
              if (typeof fs.stopUpload === 'function') {
                try {
                  fs.stopUpload(jobId);
                } catch {
                  // stopUpload 抛错就算了 —— 我们已经 reject 了。
                }
              }
            });
          }
          reject(new Error('上传超时，请检查网络后重试'));
        }, UPLOAD_TIMEOUT_MS);
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
) {
  if (Platform.OS === 'android') {
    const RNFS = await loadNativeFS();
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
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`上传失败 (${response.statusCode})`);
    }

    return response;
  }

  const response = await withUploadTimeout(() => ({
    promise: FileSystem.uploadAsync(uploadUrl, fileUri, {
      headers: {
        'Content-Type': contentType,
      },
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    }),
  }));

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`上传失败 (${response.status})`);
  }

  return response;
}
