/**
 * 把一张网络图片交给浏览器下载（Web 档，导出面与 save-image.ts 一致）。
 *
 * 首选把字节 fetch 下来变成 blob 再触发 `<a download>` —— 只有这条路能
 * 真正落到「下载」而不是导航。媒体走的是 MinIO 的另一个源，一旦它没放行
 * CORS 就拿不到字节，此时退回新标签打开原图（用户右键另存），仍然可用。
 *
 * 浏览器自己有下载提示，所以调用方在 web 上成功时不再弹「已保存」。
 */
export type SaveImageResult = 'saved' | 'denied' | 'failed';

function filenameFromUrl(url: string): string {
  const path = url.split('?')[0];
  const last = path.split('/').pop();
  return last && last.length > 0 ? last : `image-${Date.now()}.jpg`;
}

export async function saveImageToLibrary(
  url: string,
): Promise<SaveImageResult> {
  if (typeof document === 'undefined') return 'failed';

  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filenameFromUrl(url);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 立刻 revoke 会让部分浏览器的下载中断，给足落盘时间。
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return 'saved';
  } catch {
    try {
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      return opened ? 'saved' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
