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

export function reconcileNoteMediaDrafts(
  current: readonly EditorNoteMediaDraft[],
  successful: readonly Pick<EditorNoteMediaDraft, 'clientId' | 'objectKey' | 'url' | 'mimeType'>[],
): EditorNoteMediaDraft[] {
  const uploadedByClientId = new Map(successful.map((item) => [item.clientId, item]));
  return current.flatMap((draft) => {
    if (draft.uploadStatus === 'UPLOADED') return [draft];
    const uploaded = uploadedByClientId.get(draft.clientId);
    return uploaded ? [{ ...draft, ...uploaded, uploadStatus: 'UPLOADED' as const }] : [];
  });
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
