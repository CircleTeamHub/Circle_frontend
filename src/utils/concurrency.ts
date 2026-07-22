/**
 * utils/concurrency.ts — 有界并发的 map
 *
 * Promise.all 全量并发会同时打满 presign + S3 PUT（九图场景 18 个请求），
 * 串行又慢到 18s 级。固定 worker 池按序领任务：结果数组与输入序一一对应，
 * mapper 抛错则原样冒泡（调用方自行决定 per-item 捕获还是整体失败）。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapWithConcurrency: invalid limit ${limit}`);
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
