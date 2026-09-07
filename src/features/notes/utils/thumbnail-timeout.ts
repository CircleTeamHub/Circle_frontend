export const NOTE_THUMBNAIL_TIMEOUT_MS = 8_000;

/**
 * 给一个可能永远不 settle 的缩略图任务加上超时，并且不泄漏迟到的结果。
 *
 * 视频缩略图是**串行**排队生成的 —— 一个队列，避免一次选十个视频时同时开十个
 * 原生解码器。串行的代价是：只要有一个文件让原生调用挂住不返回，它后面每一个
 * 缩略图都永远排在它后面。一个坏视频就能让整列预览停在占位方块上，而且既不报错
 * 也不重试，用户只看到「一直在转」。
 *
 * 超时只放弃这一格，让队列继续走。迟到的结果仍然要交给 release：那是一张原生
 * 位图，没人持有就是一次泄漏。释放本身可能因为播放器已经关掉而抛错，吞掉即可 ——
 * 这条路径上没有任何东西比「不要因为清理而崩掉」更重要。
 */
export async function withThumbnailTimeout<T>(
  work: Promise<T>,
  releaseLate: (value: T) => void,
  timeoutMs: number = NOTE_THUMBNAIL_TIMEOUT_MS,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, timeoutMs);
  });

  try {
    const settled = await Promise.race([work, timeout]);
    if (!timedOut) return settled as T;
    void work.then(
      (late) => {
        if (late == null) return;
        try {
          releaseLate(late);
        } catch {
          // 播放器可能早就释放了；清理失败不该再抛出去。
        }
      },
      () => {
        // 超时之后再失败没有任何人需要知道。
      },
    );
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
