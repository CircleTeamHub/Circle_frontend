/**
 * 把一张网络图片交给浏览器下载（Web 档，导出面与 save-image.ts 一致）。
 *
 * 首选把字节 fetch 下来变成 blob 再触发 `<a download>` —— 只有这条路能
 * 真正落到「下载」而不是导航。媒体走的是 MinIO 的另一个源，一旦它没放行
 * CORS 就拿不到字节，此时退回新标签打开原图（用户右键另存），仍然可用。
 *
 * 浏览器自己有下载提示，所以调用方在 web 上成功时不再弹「已保存」。
 *
 * 已知残留：走到回退分支时前面的 await fetch 已经消耗掉这次点击的
 * transient activation，个别浏览器会连带拦掉这次 window.open。要根治得在
 * 点击同帧先开一个占位窗口再回填 —— 那要把长按菜单的交互链整个改掉，
 * 收益不抵改动面，留档。
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
      // 不能带 noopener/noreferrer：规范规定这两个特性中任一存在时
      // window.open 一律返回 null —— 于是"新标签明明打开了"也会被判成失败，
      // 用户看到一条假的保存失败提示。改成拿句柄后手动切断 opener，
      // 反向 tabnabbing 的防护等价。
      const opened = window.open(url, '_blank');
      if (!opened) return 'failed';
      try {
        opened.opener = null;
      } catch {
        // 跨源窗口不允许写 opener，忽略（新标签已经打开，这才是重点）。
      }
      return 'saved';
    } catch {
      return 'failed';
    }
  }
}
