/**
 * 批量操作（删除/下架/改分组）的并发限流执行器。
 *
 * 与 GroupManagerSheet 内联的 runWithConcurrencyLimit 不同：那边 fail-fast 抛错，
 * 这里逐项 settle 收敛成/败清单 —— 批量动作要在部分失败时告诉用户失败了几条、
 * 并把成功的那部分如实刷新出来，而不是整批回滚不了又假装没发生。
 */

export interface BatchRunResult {
  succeeded: string[];
  failed: string[];
}

/** 与 GroupManagerSheet 的保存并发一致，别把移动端网络打满。 */
export const NOTE_BATCH_CONCURRENCY = 5;

export async function runNoteBatch(
  ids: readonly string[],
  task: (id: string) => Promise<void>,
  concurrency: number = NOTE_BATCH_CONCURRENCY,
): Promise<BatchRunResult> {
  const limit = Math.max(1, concurrency);
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (let index = 0; index < ids.length; index += limit) {
    const chunk = ids.slice(index, index + limit);
    const settled = await Promise.allSettled(chunk.map((id) => task(id)));
    settled.forEach((result, offset) => {
      if (result.status === 'fulfilled') {
        succeeded.push(chunk[offset]);
      } else {
        failed.push(chunk[offset]);
      }
    });
  }

  return { succeeded, failed };
}
