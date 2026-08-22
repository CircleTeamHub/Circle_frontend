/**
 * 把一张网络图片交给浏览器下载（Web 档，导出面与 save-image.ts 一致）。
 *
 * 首选把字节 fetch 下来变成 blob 再触发 `<a download>` —— 只有这条路能
 * 真正落到「下载」而不是导航。媒体走的是 MinIO 的另一个源，一旦它没放行
 * CORS 就拿不到字节，此时退回新标签打开原图（用户右键另存），仍然可用。
 *
 * 浏览器自己有下载提示，所以调用方在 web 上成功时不再弹「已保存」。
 *
 * 拿不到字节时**不在这里**开标签页，而是回 'blocked' 让调用方问一句。原因是
 * transient activation：`window.open` 只在用户手势那一拍里获准执行，而这里
 * 前面已经 await 过一次 fetch —— Safari/Firefox 基本会当成弹窗拦掉，Chrome
 * 也只是因为手势有效期还没过才侥幸放行。让用户在提示里再点一下「打开原图」，
 * 那一下是全新的手势，任何浏览器都不会拦。
 */
export type SaveImageResult = 'saved' | 'denied' | 'failed' | 'blocked';

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
    // 字节拿不到（源没放行 CORS / 预签名过期 / 断网）。开标签页这件事交给
    // 调用方在下一次用户手势里做，见上面关于 transient activation 的说明。
    return 'blocked';
  }
}

/**
 * 在新标签打开原图，供用户右键另存。
 *
 * **必须在用户手势的同一拍里调用**（比如提示框按钮的 onPress 里），
 * 中间不能夹 await —— 否则就是上面那个被弹窗拦截的老问题。
 */
export function openImageInNewTab(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // 不能带 noopener/noreferrer：规范规定这两个特性中任一存在时
    // window.open 一律返回 null —— 于是"新标签明明打开了"也会被判成失败。
    // 改成拿句柄后手动切断 opener，反向 tabnabbing 的防护等价。
    const opened = window.open(url, '_blank');
    if (!opened) return false;
    try {
      opened.opener = null;
    } catch {
      // 跨源窗口不允许写 opener，忽略（新标签已经打开，这才是重点）。
    }
    return true;
  } catch {
    return false;
  }
}
