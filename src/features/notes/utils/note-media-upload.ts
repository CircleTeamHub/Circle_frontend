/** Keep picker and upload work bounded so a large selection cannot saturate the device. */
export const MAX_NOTE_MEDIA_SELECTION = 10;
export const NOTE_MEDIA_UPLOAD_CONCURRENCY = 3;

export type NoteMediaBatchResult<TResult> = {
  items: TResult[];
  failedCount: number;
  failedIndexes: number[];
  errors: unknown[];
};

export type PendingNoteMediaAsset = {
  uri: string;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  duration?: number | null;
};

export type EditorNoteMediaDraft = {
  clientId: string;
  type: 'IMAGE' | 'VIDEO';
  objectKey: string;
  url: string;
  previewUri?: string;
  width?: number;
  height?: number;
  size?: number;
  durationMs?: number;
  mimeType?: string;
  posterUrl?: string;
  sortOrder: number;
  uploadStatus: 'PENDING' | 'UPLOADED';
};

let nextDraftSequence = 0;

function createDraftClientId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `draft:${uuid}`;

  nextDraftSequence += 1;
  return `draft:${Date.now().toString(36)}:${nextDraftSequence.toString(36)}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function createPendingNoteMediaDrafts(
  assets: readonly PendingNoteMediaAsset[],
  type: 'IMAGE' | 'VIDEO',
): EditorNoteMediaDraft[] {
  return assets.map((asset, index) => {
    const clientId = createDraftClientId();
    return {
      clientId,
      type,
      objectKey: `pending:${clientId}`,
      url: '',
      previewUri: asset.uri,
      width: asset.width ?? undefined,
      height: asset.height ?? undefined,
      size: asset.fileSize ?? undefined,
      durationMs: typeof asset.duration === 'number' ? Math.round(asset.duration) : undefined,
      sortOrder: index,
      uploadStatus: 'PENDING',
    };
  });
}

/**
 * 一批上传落地后把结果并回草稿列表。
 *
 * `batchDraftIds` 划定这一批的范围。不传的话，**任何**还是 PENDING 的草稿只要
 * 不在成功名单里就会被丢掉 —— 而失焦会把 uploadInFlightRef 复位，于是两批上传
 * 可以叠着跑：先落地的那一批会把后一批的占位图连同它正在传的文件一起抹掉。
 * 一批只处置自己那几条，别人的 PENDING 原样留下等它自己落地。
 */
export function reconcileNoteMediaDrafts(
  current: readonly EditorNoteMediaDraft[],
  successful: readonly Pick<EditorNoteMediaDraft, 'clientId' | 'objectKey' | 'url' | 'mimeType'>[],
  batchDraftIds?: ReadonlySet<string>,
): EditorNoteMediaDraft[] {
  const uploadedByClientId = new Map(successful.map((item) => [item.clientId, item]));
  return current.flatMap((draft) => {
    if (draft.uploadStatus === 'UPLOADED') return [draft];
    const uploaded = uploadedByClientId.get(draft.clientId);
    if (uploaded) return [{ ...draft, ...uploaded, uploadStatus: 'UPLOADED' as const }];
    return batchDraftIds && !batchDraftIds.has(draft.clientId) ? [draft] : [];
  });
}

/**
 * 把一批还没落地的占位草稿摘出来（用于上传抛错后的清理）。
 *
 * `uploadStatus === 'UPLOADED'` 的必须留下：它的 clientId 也在这一批里，但文件
 * 已经传完并且并回了列表。只按 clientId 一刀切，就会把刚刚成功的那几条连同
 * 已经躺在对象存储里的文件一起删掉。
 */
export function partitionUnsettledDrafts(
  current: readonly EditorNoteMediaDraft[],
  batchDraftIds: ReadonlySet<string>,
): { kept: EditorNoteMediaDraft[]; discarded: EditorNoteMediaDraft[] } {
  const kept: EditorNoteMediaDraft[] = [];
  const discarded: EditorNoteMediaDraft[] = [];
  for (const item of current) {
    if (item.uploadStatus === 'UPLOADED' || !batchDraftIds.has(item.clientId)) kept.push(item);
    else discarded.push(item);
  }
  return { kept, discarded };
}

/** 与 report-failure 的 tag 校验同一条规则：只放行稳定的短标识。 */
const STABLE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function classifyBatchError(error: unknown): string {
  // 刻意不用 `instanceof Error`：跨 realm 的错误（web worker、DOMException、另一个
  // bundle 抛出来的）会漏判，而那恰恰是最需要区分的那几种。
  if (typeof error !== 'object' || error === null) return typeof error;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && STABLE_ERROR_NAME.test(name) ? name : 'Error';
}

/**
 * 把一批上传的失败归纳成**一个可上报、且不泄漏任何内容**的错误。
 *
 * 原始错误不能直接上报：上传失败的 message 里常常整条带着预签名 URL（含令牌），
 * 而 reportHandledFailure 会把错误本身交给 Sentry。但此前固定报
 * `new Error('note media batch upload failed')` 又走到了另一个极端 —— 去重签名是
 * 「错误名 + message 前 200 字」，于是网络断、预签名 403、超时、配额满在聚合里
 * 全部塌成同一个签名，`batch.errors` 也从来没有读者，「上传到底怎么失败的」在
 * 线上完全不可知。
 *
 * 折中：message 里只放错误的**类名**，而且过一遍稳定标识白名单。签名因此按失败
 * 种类分开，而离开设备的字节里没有任何 URL、令牌或用户内容。
 */
export function summarizeNoteMediaBatchFailure(errors: readonly unknown[]): {
  error: Error;
  errorNames: string;
} {
  const errorNames = [...new Set(errors.map(classifyBatchError))].sort().join(',') || 'none';
  return {
    error: new Error(`note media batch upload failed [${errorNames}]`),
    errorNames,
  };
}

export function canSubmitNoteMedia(items: readonly EditorNoteMediaDraft[]) {
  return items.every((item) => item.uploadStatus === 'UPLOADED');
}

export function stripEditorMediaDrafts(
  items: readonly EditorNoteMediaDraft[],
) {
  return items
    .filter((item) => item.uploadStatus === 'UPLOADED')
    .map(({ clientId: _clientId, previewUri: _previewUri, uploadStatus: _uploadStatus, ...item }, sortOrder) => ({
      ...item,
      sortOrder,
    }));
}

export function createNoteMediaUploadOperationGuard() {
  let generation = 0;
  let activeToken: number | null = null;
  return {
    begin: () => {
      activeToken = ++generation;
      return activeToken;
    },
    invalidate: () => {
      generation += 1;
      activeToken = null;
    },
    isActive: (token: number) => token === activeToken,
    complete: (token: number) => {
      if (token !== activeToken) return false;
      activeToken = null;
      return true;
    },
  };
}

/**
 * 这批媒体块插在哪个块之后。
 *
 * 没有文字光标是常态，不是异常：作者往往直接点工具栏的图片按钮，从没在正文里点
 * 过一下。此前 DOM 侧遇到这种情况直接返回，而调用方紧接着就把这批 pendingInserts
 * 交割掉 —— 图已经传完、流量已经付过，却一张都没进文档，也没有任何提示。
 * 没有光标就落到文末，那正是作者期待它出现的位置。
 */
export function resolveMediaInsertAnchor<TBlock>(
  cursorBlock: TBlock | null | undefined,
  documentBlocks: readonly TBlock[],
): TBlock | null {
  return cursorBlock ?? documentBlocks[documentBlocks.length - 1] ?? null;
}

export function buildPendingEditorBlocks(
  pendingInserts: readonly { type: 'image' | 'video'; url: string }[],
) {
  return pendingInserts.map((pendingInsert) => ({
    type: pendingInsert.type,
    props: { url: pendingInsert.url, previewWidth: 300, caption: '' },
  }));
}

export async function uploadNoteMediaBatch<TAsset, TResult>(
  assets: readonly TAsset[],
  upload: (asset: TAsset) => Promise<TResult> | TResult,
  { concurrency = NOTE_MEDIA_UPLOAD_CONCURRENCY }: { concurrency?: number } = {},
): Promise<NoteMediaBatchResult<TResult>> {
  const settled: ({ ok: true; value: TResult } | { ok: false; error: unknown } | undefined)[] =
    Array(assets.length);
  const workerCount = Math.min(
    assets.length,
    Math.max(1, Math.floor(concurrency) || NOTE_MEDIA_UPLOAD_CONCURRENCY),
  );
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < assets.length) {
      const index = nextIndex++;
      try {
        settled[index] = { ok: true, value: await upload(assets[index]) };
      } catch (error) {
        settled[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));

  const items: TResult[] = [];
  const errors: unknown[] = [];
  const failedIndexes: number[] = [];
  for (const [index, result] of settled.entries()) {
    if (!result) continue;
    if (result.ok) items.push(result.value);
    else {
      errors.push(result.error);
      failedIndexes.push(index);
    }
  }
  return { items, failedCount: errors.length, failedIndexes, errors };
}
