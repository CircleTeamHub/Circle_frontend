/**
 * web 档:浏览器里没有可以跨刷新留存的本地文件(选图拿到的是 blob: 地址,
 * 刷新即失效),本地库也不存在(见 local-db.web.ts)。待发媒体只活在内存里,
 * 刷新后丢失 —— 与改造前一致。
 *
 * ⚠️ 导出面必须与 pending-media.ts 保持一致。
 */

export function pendingMediaFileName(uploadName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(uploadName);
  return match ? `media.${match[1].toLowerCase()}` : 'media';
}

export async function persistPendingMediaFile(
  _userId: string,
  _d: string,
  _sourceUri: string,
  _uploadName: string,
  _sessionEpoch: number,
): Promise<string | null> {
  return null;
}

export async function resolvePendingMediaUri(
  _userId: string,
  _d: string,
  _fileName: string,
): Promise<string | null> {
  return null;
}

export async function deletePendingMedia(_userId: string, _d: string): Promise<void> {}

export async function prunePendingMedia(
  _userId: string,
  _referencedDeliveries: ReadonlySet<string>,
): Promise<void> {}

export async function clearPendingMediaFiles(
  _clearedSessionEpoch: number,
): Promise<void> {}
