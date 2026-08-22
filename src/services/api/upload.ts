import { apiClient } from '@/services/api/client';
import { API_URL } from '@/constants/config';
import { Platform } from 'react-native';
// #112（有意保留 legacy）：仅剩 uploadAsync 一个用途。SDK 55 的新版
// expo-file-system 没有对等的原生流式上传 —— File.bytes() 会把整个视频读进
// JS 内存，expo/fetch 也尚不支持请求体流式。等上游补齐后随 SDK 升级迁移。
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

/** 只提取对象存储 XML 的短错误码，不把对象 key、request id 或签名 URL带进日志。 */
function storageErrorCode(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  return body.match(/<Code>([A-Za-z0-9._-]{1,64})<\/Code>/)?.[1] ?? null;
}

export class StorageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUploadError';
  }
}

function uploadStatusError(status: number, body?: unknown): Error {
  const code = storageErrorCode(body);
  return new StorageUploadError(
    i18n.t('common.errors.uploadFailedWithStatus', {
      status: code ? `${status}: ${code}` : status,
      defaultValue: '上传失败 ({{status}})',
    }),
  );
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

/**
 * contentType → 兜底扩展名。Web 端 picker/编辑器给的是 blob:/data: URI，
 * `uri.split('/').pop()` 只是一串 uuid，没有扩展名 —— 后端推不出类型时对象
 * 键会落 `.bin`。presign 入口统一按 contentType 补上。
 */
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'audio/mp4': 'm4a',
};

/** 文件名已带认识的扩展名则原样通过，否则按 contentType 补一个。 */
export function ensureFilenameExtension(
  filename: string,
  contentType: string,
): string {
  const trimmed = filename.trim();
  const extension = trimmed.includes('.')
    ? (trimmed.split('.').pop() ?? '').toLowerCase()
    : '';
  if (extension && extension in CONTENT_TYPE_BY_EXTENSION) {
    return trimmed;
  }
  const mapped = EXTENSION_BY_CONTENT_TYPE[contentType];
  return mapped ? `${trimmed || 'upload'}.${mapped}` : trimmed;
}

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
  requiredHeaders: UploadRequiredHeaders;
};

export type UploadRequiredHeaders = {
  'Content-Type': string;
  'Content-Length': string;
  'If-None-Match': string;
};

function isUploadRequiredHeaders(value: unknown): value is UploadRequiredHeaders {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value['Content-Type']) &&
    typeof value['Content-Length'] === 'string' &&
    /^\d+$/.test(value['Content-Length']) &&
    value['If-None-Match'] === '*'
  );
}

// presign 返回的两个 URL 即将被当作信任凭证使用（PUT 上传时直接拼到 fetch）。
// 字段缺失或类型漂移会让 `new URL(...)` 抛 / fetch 直接挂；运行时守一道。
function isUploadPresignShape(value: unknown): value is UploadPresignResponse {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.uploadUrl) &&
    isNonEmptyString(value.fileUrl) &&
    isNonEmptyString(value.key) &&
    isUploadRequiredHeaders(value.requiredHeaders)
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

/** 后端 PresignDto 的硬上限(100MB),提前拦下来给可读的错,而不是吃一个 400。 */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * 取本地文件的精确字节数。
 *
 * 后端 `PresignDto.sizeBytes` 是必填的 1..100MB 整数,并且会被写进签名的
 * PutObject 请求、计进上传配额与指标 —— 不能猜、不能给近似值,一律从**将要
 * 上传的那个文件**现取(所以 presign 收的是 fileUri 而不是调用方自己算的数字:
 * 两者一旦不同步,拿到的签名就对不上真正上传的内容)。
 */
export async function resolveLocalFileSize(fileUri: string): Promise<number> {
  if (Platform.OS === 'web') {
    return (await readLocalBlobOnWeb(fileUri)).size;
  }
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists || info.isDirectory) {
    throw new Error(
      i18n.t('upload.errors.fileUnreadable', {
        defaultValue: '找不到要上传的文件',
      }),
    );
  }
  return info.size;
}

/**
 * Web：picker/manipulator 给的本地地址是 blob:/data: URI，没有文件系统可 stat，
 * fetch 成 Blob 后 size 与内容天然同源（blob: 是内存引用，代价可忽略）。
 */
async function readLocalBlobOnWeb(fileUri: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(fileUri);
  } catch {
    response = null as never;
  }
  if (!response || !response.ok) {
    throw new Error(
      i18n.t('upload.errors.fileUnreadable', {
        defaultValue: '找不到要上传的文件',
      }),
    );
  }
  return response.blob();
}

function assertUploadSize(sizeBytes: number): number {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new Error(
      i18n.t('upload.errors.fileUnreadable', {
        defaultValue: '找不到要上传的文件',
      }),
    );
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(
      i18n.t('upload.errors.fileTooLarge', {
        maxMb: Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024),
        defaultValue: '文件超过 {{maxMb}}MB 上限',
      }),
    );
  }
  return sizeBytes;
}

/**
 * 尺寸来源二选一,用联合类型逼调用方必须给一个:本地文件给 uri(这里 stat),
 * 内存里的 Blob 给它自己的 size。
 */
export type UploadSizeSource =
  | { fileUri: string; sizeBytes?: never }
  | { sizeBytes: number; fileUri?: never };

export async function requestUploadPresign(
  payload: {
    filename: string;
    contentType: string;
    folder: UploadFolder;
  } & UploadSizeSource,
) {
  const sizeBytes = assertUploadSize(
    typeof payload.sizeBytes === 'number'
      ? payload.sizeBytes
      : await resolveLocalFileSize(payload.fileUri),
  );
  const raw = await apiClient<UploadPresignResponse>('/upload/presign', {
    method: 'POST',
    // 逐字段拼:fileUri 只是本地取值用的,绝不能进请求体(后端 DTO 不认)。
    body: {
      filename: ensureFilenameExtension(payload.filename, payload.contentType),
      contentType: payload.contentType,
      folder: payload.folder,
      sizeBytes,
    },
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
  requiredHeaders: UploadRequiredHeaders,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
) {
  return runStorageUpload({ kind: 'presigned-put', contentType }, async () => {
    assertPresignedUploadUrlReachableOnCurrentPlatform(uploadUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: requiredHeaders,
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
      const body = await response.text().catch(() => '');
      throw uploadStatusError(response.status, body);
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
  requiredHeaders: UploadRequiredHeaders,
  timeoutMs: number = UPLOAD_TIMEOUT_MS,
) {
  if (Platform.OS === 'web') {
    // Web 没有 RNFS/uploadAsync：blob:/data: URI 取成 Blob 后走通用 fetch PUT
    // 通道（同一套超时与错误语义；requiredHeaders 原样转发，见 presign 契约）。
    const blob = await readLocalBlobOnWeb(fileUri);
    // timeoutMs 必须透传：视频那几个调用点传的是 VIDEO_UPLOAD_TIMEOUT_MS（分钟级），
    // 丢掉就退回 60 秒默认值 —— 网页端发稍大一点的视频必然超时失败，
    // 而原生端同样的文件是好的，很难联想到是平台分支吃掉了参数。
    await uploadFileToPresignedUrl(
      uploadUrl,
      contentType,
      blob,
      requiredHeaders,
      timeoutMs,
    );
    return;
  }
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
          headers: requiredHeaders,
          method: 'PUT',
        });
        return { promise: handle.promise, jobId: handle.jobId };
      }, timeoutMs);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw uploadStatusError(response.statusCode, response.body);
      }

      return response;
    }

    const response = await withUploadTimeout(
      () => ({
        promise: FileSystem.uploadAsync(uploadUrl, fileUri, {
          headers: requiredHeaders,
          httpMethod: 'PUT',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        }),
      }),
      timeoutMs,
    );

    if (response.status < 200 || response.status >= 300) {
      throw uploadStatusError(response.status, response.body);
    }

    return response;
  });
}
