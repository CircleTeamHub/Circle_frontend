import { create } from 'zustand';

export type UploadByteProgress = { loaded: number; total: number | null };
export type UploadProgressOptions = {
  progressKey?: string;
  onProgress?: (progress: UploadByteProgress) => void;
};
export type UploadProgressTask = UploadByteProgress & {
  id: string;
  kind: 'image' | 'video';
  progressKey?: string;
};

export const useUploadProgressStore = create<{ tasks: Record<string, UploadProgressTask> }>(() => ({ tasks: {} }));

let nextId = 1;
let generation = 0;

/** Keep asynchronous preparation/presigning attached to its original session. */
export function captureUploadProgressScope(): () => boolean {
  const capturedGeneration = generation;
  return () => capturedGeneration === generation;
}

export function resetUploadProgress(): void {
  generation += 1;
  useUploadProgressStore.setState({ tasks: {} });
}

/** In-memory transfer metadata only. No media URLs, filenames or account data. */
export function startUploadProgress(contentType: string, options?: UploadProgressOptions): { update(loaded: number, total?: number | null): void; finish(): void } {
  const kind = contentType.startsWith('image/') ? 'image' : contentType.startsWith('video/') ? 'video' : null;
  const id = kind ? `upload-${nextId++}` : undefined;
  const startedGeneration = generation;
  let finished = false;
  let lastBucket: string | null = null;
  if (id && kind) {
    useUploadProgressStore.setState(state => ({ tasks: {
      ...state.tasks,
      [id]: { id, kind, ...(options?.progressKey ? { progressKey: options.progressKey } : {}), loaded: 0, total: null },
    } }));
  }
  return {
    update(loaded, total) {
      if (finished || startedGeneration !== generation) return;
      const expected = typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : null;
      const sent = Number.isFinite(loaded) ? Math.max(0, expected === null ? loaded : Math.min(loaded, expected)) : 0;
      // One notification per whole percentage, not per native network chunk.
      // Unknown totals only need to distinguish preparation from active bytes.
      const bucket = expected === null ? `unknown:${sent > 0}` : `percent:${Math.floor(sent / expected * 100)}`;
      if (bucket === lastBucket) return;
      lastBucket = bucket;
      const progress = { loaded: sent, total: expected };
      if (id) {
        useUploadProgressStore.setState(state => ({ tasks: {
          ...state.tasks,
          [id]: { ...state.tasks[id], ...progress },
        } }));
      }
      options?.onProgress?.(progress);
    },
    finish() {
      if (finished || startedGeneration !== generation) return;
      finished = true;
      if (id) {
        useUploadProgressStore.setState(state => {
          const tasks = { ...state.tasks };
          delete tasks[id];
          return { tasks };
        });
      }
    },
  };
}
