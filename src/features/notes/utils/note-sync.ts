import type { NoteStatus, NoteSummary, NoteWorkStatus } from '../types';

export interface NoteSourceStatusChangeLike {
  sourceNoteId: string;
  workStatus: Exclude<NoteWorkStatus, 'UNSET'> | null;
  status: NoteStatus;
  available: boolean;
}

function readHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

/**
 * 给当前已经显示的行做一次低成本即时 patch。
 * 服务端随后仍会重新返回完整投影，负责处理过滤、分组和来源链。
 */
export function applyNoteSourceStatusToSummaries(
  notes: NoteSummary[],
  change: NoteSourceStatusChangeLike,
): NoteSummary[] {
  const matches = notes.some(
    (note) =>
      note.id === change.sourceNoteId ||
      note.collectedFrom?.sourceNoteId === change.sourceNoteId,
  );
  if (!matches) return notes;
  return notes.map((note) => {
    if (
      note.id !== change.sourceNoteId &&
      note.collectedFrom?.sourceNoteId !== change.sourceNoteId
    ) {
      return note;
    }
    return {
      ...note,
      status: change.status,
      available: change.available,
      workStatus: change.workStatus,
    };
  });
}

/**
 * 笔记列表和详情的 GET 同步允许短暂网络抖动后重试。
 *
 * 这里只用于幂等的读取请求。认证/权限错误不重试，避免把无效会话或
 * 已失效的权限拖成后台请求风暴；网络错误、超时、限流和服务端错误才
 * 使用有限的指数退避。
 */
const DEFAULT_RETRY_DELAYS_MS = [200, 500] as const;

export function isRetryableNoteSyncError(error: unknown): boolean {
  const status = readHttpStatus(error);
  if (status !== null) {
    if (status === 401 || status === 403) return false;
    return (
      status === 0 ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }
  // fetch/network implementations may reject with a plain TypeError.
  return true;
}

export async function withNoteSyncRetry<T>(
  operation: () => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    sleep?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryableNoteSyncError(error) || attempt >= delays.length) {
        throw error;
      }
      await sleep(delays[attempt]);
    }
  }
}
