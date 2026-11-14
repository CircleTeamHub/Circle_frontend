import { useCallback, useRef, useState } from 'react';
import type { ImagePickerAsset } from 'expo-image-picker';

/** 同时在传的条目数:九个全并发会同时打满 presign + PUT,串行又太慢(同 mapWithConcurrency 的取值)。 */
const UPLOAD_CONCURRENCY = 3;

// 模块级计数:进度环按 progressKey 在全局上传表里找任务,两个页面实例不能撞号。
let nextItemId = 0;

export type EagerMediaStatus = 'uploading' | 'done' | 'failed';

export interface EagerMediaItem {
  /** 同时是这条上传的 progressKey:缩略图上的进度环按它取进度,也不进全局上传卡片。 */
  id: string;
  asset: ImagePickerAsset;
  status: EagerMediaStatus;
}

export type EagerMediaSettled<T> =
  | { ok: true; results: T[] }
  /** error 是第一个失败条目的原因,给要按错误码出文案的调用方用。 */
  | { ok: false; failedCount: number; error: unknown };

interface EagerMediaUploadOptions<T> {
  /** 传一个条目;必须是稳定引用(模块级函数),排队中的任务会在之后调用它。 */
  upload: (asset: ImagePickerAsset, progressKey: string) => Promise<T>;
  onError: (error: unknown) => void;
}

/**
 * 发布页「选完就开始传」:条目一选进来就排队上传,用户写正文的同时字节已经在走,
 * 而不是点了发布才从头传。发布时 settle() 只等还没传完的,失败的补传一次;
 * 传好的结果按条目记住,发布接口失败后重试也不会重传(请求体不变,幂等键才对得上)。
 */
export function useEagerMediaUploads<T>({ upload, onError }: EagerMediaUploadOptions<T>) {
  const [items, setItems] = useState<EagerMediaItem[]>([]);
  // 同步真值:add / remove / settle 在同一帧里先后读写,不能等下一次渲染。
  const itemsRef = useRef<EagerMediaItem[]>([]);
  const resultsRef = useRef(new Map<string, T>());
  const errorsRef = useRef(new Map<string, unknown>());
  const inFlightRef = useRef(new Map<string, Promise<void>>());
  const slotsRef = useRef({ active: 0, waiting: [] as (() => void)[] });

  const commit = useCallback((next: EagerMediaItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const isLive = useCallback((id: string) => itemsRef.current.some((item) => item.id === id), []);

  const setStatus = useCallback(
    (id: string, status: EagerMediaStatus) => {
      if (!isLive(id)) return;
      commit(itemsRef.current.map((item) => (item.id === id ? { ...item, status } : item)));
    },
    [commit, isLive],
  );

  const start = useCallback(
    (item: EagerMediaItem) => {
      const slots = slotsRef.current;
      const run = async () => {
        if (slots.active < UPLOAD_CONCURRENCY) slots.active += 1;
        else await new Promise<void>((resolve) => slots.waiting.push(resolve));
        try {
          // 排队期间被删掉的条目不再上传。
          if (!isLive(item.id)) return;
          const result = await upload(item.asset, item.id);
          if (!isLive(item.id)) return;
          resultsRef.current.set(item.id, result);
          errorsRef.current.delete(item.id);
          setStatus(item.id, 'done');
        } catch (error) {
          onError(error);
          if (isLive(item.id)) errorsRef.current.set(item.id, error);
          setStatus(item.id, 'failed');
        } finally {
          // 名额直接交给下一个排队的,中间不让新来的插队超过并发上限。
          const next = slots.waiting.shift();
          if (next) next();
          else slots.active -= 1;
        }
      };
      const task: Promise<void> = run().finally(() => {
        if (inFlightRef.current.get(item.id) === task) inFlightRef.current.delete(item.id);
      });
      inFlightRef.current.set(item.id, task);
    },
    [isLive, onError, setStatus, upload],
  );

  const add = useCallback(
    (assets: readonly ImagePickerAsset[], max: number) => {
      const room = Math.max(0, max - itemsRef.current.length);
      const added = assets.slice(0, room).map(
        (asset): EagerMediaItem => ({ id: `eager-media-${nextItemId++}`, asset, status: 'uploading' }),
      );
      if (added.length === 0) return;
      commit([...itemsRef.current, ...added]);
      added.forEach(start);
    },
    [commit, start],
  );

  const remove = useCallback(
    (id: string) => {
      resultsRef.current.delete(id);
      errorsRef.current.delete(id);
      commit(itemsRef.current.filter((item) => item.id !== id));
    },
    [commit],
  );

  const retry = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((current) => current.id === id);
      if (item?.status !== 'failed') return;
      setStatus(id, 'uploading');
      start(item);
    },
    [setStatus, start],
  );

  const settle = useCallback(async (): Promise<EagerMediaSettled<T>> => {
    const waitInFlight = () =>
      Promise.all(itemsRef.current.map((item) => inFlightRef.current.get(item.id)));
    await waitInFlight();
    itemsRef.current.filter((item) => item.status === 'failed').forEach((item) => retry(item.id));
    await waitInFlight();
    const current = itemsRef.current;
    const failed = current.filter((item) => !resultsRef.current.has(item.id));
    if (failed.length > 0) {
      return { ok: false, failedCount: failed.length, error: errorsRef.current.get(failed[0].id) };
    }
    return { ok: true, results: current.map((item) => resultsRef.current.get(item.id) as T) };
  }, [retry]);

  return { items, add, remove, retry, settle };
}
