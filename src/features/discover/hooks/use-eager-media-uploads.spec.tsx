import { act, renderHook } from '@testing-library/react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useEagerMediaUploads } from './use-eager-media-uploads';

const asset = (name: string) => ({ uri: `file:///${name}`, width: 10, height: 10 }) as ImagePickerAsset;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('starts uploading as soon as media is added, not when publishing', async () => {
  const upload = jest.fn<Promise<string>, [ImagePickerAsset, string]>(async (picked) => picked.uri);
  const { result } = renderHook(() => useEagerMediaUploads({ upload, onError: jest.fn() }));

  act(() => result.current.add([asset('a'), asset('b')], 9));

  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls.map(([, key]) => key)).toEqual(result.current.items.map((item) => item.id));
  await flush();
  expect(result.current.items.map((item) => item.status)).toEqual(['done', 'done']);

  let settled: Awaited<ReturnType<typeof result.current.settle>> | undefined;
  await act(async () => {
    settled = await result.current.settle();
  });
  expect(settled).toEqual({ ok: true, results: ['file:///a', 'file:///b'] });
  expect(upload).toHaveBeenCalledTimes(2);
});

test('runs at most three uploads at once and keeps results in selection order', async () => {
  const pending = Array.from({ length: 5 }, () => deferred<string>());
  const upload = jest.fn((picked: ImagePickerAsset) => pending[Number(picked.uri.slice(-1))].promise);
  const { result } = renderHook(() => useEagerMediaUploads({ upload, onError: jest.fn() }));

  act(() => result.current.add([0, 1, 2, 3, 4].map((index) => asset(`m${index}`)), 9));
  await flush();
  expect(upload).toHaveBeenCalledTimes(3);

  pending[2].resolve('two');
  await flush();
  expect(upload).toHaveBeenCalledTimes(4);

  let settled: Awaited<ReturnType<typeof result.current.settle>> | undefined;
  const settling = result.current.settle().then((value) => {
    settled = value;
  });
  pending[0].resolve('zero');
  pending[1].resolve('one');
  pending[3].resolve('three');
  await flush();
  expect(settled).toBeUndefined();
  pending[4].resolve('four');
  await flush();
  await act(async () => {
    await settling;
  });
  expect(settled).toEqual({ ok: true, results: ['zero', 'one', 'two', 'three', 'four'] });
});

test('caps the list at the remaining slots', async () => {
  const upload = jest.fn(async () => 'url');
  const { result } = renderHook(() => useEagerMediaUploads({ upload, onError: jest.fn() }));

  act(() => result.current.add([asset('a'), asset('b')], 3));
  act(() => result.current.add([asset('c'), asset('d')], 3));

  expect(result.current.items.map((item) => item.asset.uri)).toEqual(['file:///a', 'file:///b', 'file:///c']);
  expect(upload).toHaveBeenCalledTimes(3);
  await flush();
});

test('publishing re-uploads only the media that failed, once', async () => {
  const onError = jest.fn();
  const upload = jest.fn(async (picked: ImagePickerAsset) => picked.uri);
  upload.mockRejectedValueOnce(new Error('network'));
  const { result } = renderHook(() => useEagerMediaUploads({ upload, onError }));

  act(() => result.current.add([asset('a'), asset('b')], 9));
  await flush();
  expect(result.current.items.map((item) => item.status)).toEqual(['failed', 'done']);
  expect(onError).toHaveBeenCalledTimes(1);

  let settled: Awaited<ReturnType<typeof result.current.settle>> | undefined;
  await act(async () => {
    settled = await result.current.settle();
  });
  expect(settled).toEqual({ ok: true, results: ['file:///a', 'file:///b'] });
  expect(upload.mock.calls.map(([picked]) => picked.uri)).toEqual(['file:///a', 'file:///b', 'file:///a']);
});

test('reports how many still failed after the retry', async () => {
  const upload = jest.fn(async (picked: ImagePickerAsset) => {
    if (picked.uri.endsWith('bad')) throw new Error('network');
    return picked.uri;
  });
  const { result } = renderHook(() => useEagerMediaUploads({ upload, onError: jest.fn() }));

  act(() => result.current.add([asset('ok'), asset('bad')], 9));
  let settled: Awaited<ReturnType<typeof result.current.settle>> | undefined;
  await act(async () => {
    settled = await result.current.settle();
  });

  expect(settled).toEqual({ ok: false, failedCount: 1, error: new Error('network') });
  expect(result.current.items.map((item) => item.status)).toEqual(['done', 'failed']);
});

test('a removed item is neither uploaded from the queue nor published', async () => {
  const pending = Array.from({ length: 4 }, () => deferred<string>());
  const upload = jest.fn((picked: ImagePickerAsset) => pending[Number(picked.uri.slice(-1))].promise);
  const { result } = renderHook(() => useEagerMediaUploads({ upload, onError: jest.fn() }));

  act(() => result.current.add([0, 1, 2, 3].map((index) => asset(`m${index}`)), 9));
  const [first, , , queued] = result.current.items;
  act(() => {
    result.current.remove(first.id);
    result.current.remove(queued.id);
  });
  pending[0].resolve('zero');
  pending[1].resolve('one');
  pending[2].resolve('two');

  let settled: Awaited<ReturnType<typeof result.current.settle>> | undefined;
  await act(async () => {
    settled = await result.current.settle();
  });
  expect(settled).toEqual({ ok: true, results: ['one', 'two'] });
  expect(upload).toHaveBeenCalledTimes(3);
});

test('retry re-uploads a failed item on demand', async () => {
  const upload = jest.fn(async (picked: ImagePickerAsset) => picked.uri);
  upload.mockRejectedValueOnce(new Error('network'));
  const { result } = renderHook(() => useEagerMediaUploads({ upload, onError: jest.fn() }));

  act(() => result.current.add([asset('a')], 9));
  await flush();
  expect(result.current.items[0].status).toBe('failed');

  act(() => result.current.retry(result.current.items[0].id));
  expect(result.current.items[0].status).toBe('uploading');
  await flush();
  expect(result.current.items[0].status).toBe('done');
  expect(upload).toHaveBeenCalledTimes(2);
});
