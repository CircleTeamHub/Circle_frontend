export const DEFAULT_MEDIA_UPLOAD_CONCURRENCY = 2;
export const MAX_CHAT_IMAGE_SELECTION = 30;

export interface MediaUploadSchedulerOptions {
  /** Maximum number of media uploads that may run at once. */
  concurrency?: number;
}

export interface MediaUploadScheduler {
  /** Queue one upload task and resolve/reject with the task's result. */
  enqueue<T>(task: () => PromiseLike<T> | T): Promise<T>;
  readonly activeCount: number;
  readonly pendingCount: number;
}

interface QueuedTask<T> {
  task: () => PromiseLike<T> | T;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function resolveConcurrency(options?: MediaUploadSchedulerOptions): number {
  const configured = options?.concurrency ?? DEFAULT_MEDIA_UPLOAD_CONCURRENCY;
  if (!Number.isInteger(configured) || configured < 1) {
    throw new RangeError('Media upload concurrency must be a positive integer');
  }
  return configured;
}

/**
 * Small FIFO scheduler for expensive media work. Keeping the queue outside
 * React state avoids rerenders while still putting a hard bound on memory and
 * network pressure when a user selects many assets at once.
 */
export function createMediaUploadScheduler(
  options?: MediaUploadSchedulerOptions,
): MediaUploadScheduler {
  const concurrency = resolveConcurrency(options);
  const queue: QueuedTask<unknown>[] = [];
  let activeCount = 0;

  const pump = () => {
    while (activeCount < concurrency && queue.length > 0) {
      const queued = queue.shift();
      if (!queued) return;
      activeCount += 1;

      // Invoke the task now so an enqueue immediately represents real work.
      // Synchronous throws are converted to a rejected item while the pump
      // continues filling any remaining slot.
      let result: PromiseLike<unknown> | unknown;
      try {
        result = queued.task();
      } catch (error) {
        queued.reject(error);
        activeCount -= 1;
        continue;
      }
      Promise.resolve(result)
        .then(queued.resolve, queued.reject)
        .finally(() => {
          activeCount -= 1;
          pump();
        });
    }
  };

  return {
    enqueue<T>(task: () => PromiseLike<T> | T): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          task,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        pump();
      });
    },
    get activeCount() {
      return activeCount;
    },
    get pendingCount() {
      return queue.length;
    },
  };
}

/** One app-wide pool so leaving a chat screen cannot create a second burst of uploads. */
export const chatMediaUploadScheduler = createMediaUploadScheduler({
  concurrency: DEFAULT_MEDIA_UPLOAD_CONCURRENCY,
});

/**
 * A single selected photo keeps the existing editor flow. A multi-selection
 * skips the editor and returns every asset for independent optimistic sends.
 */
export function splitPhotoSelection<T>(assets: readonly T[]): {
  editorAsset: T | null;
  uploadAssets: T[];
} {
  if (assets.length === 1) {
    return { editorAsset: assets[0] ?? null, uploadAssets: [] };
  }
  return { editorAsset: null, uploadAssets: [...assets] };
}
