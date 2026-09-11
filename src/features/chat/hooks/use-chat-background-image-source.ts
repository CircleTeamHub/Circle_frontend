import { useEffect, useState } from 'react';
import { resolveChatBackgroundImageSource } from '@/features/chat/utils/chat-background-image';

/**
 * 把偏好里存的 `chat-bg:<name>` 换成渲染用的 uri。
 *
 * 两个平台都只能在渲染时现取：原生要拼绝对路径（容器路径不保证跨重装稳定），
 * web 要从 IndexedDB 取回 blob 再建 object URL。所以解析是异步的，统一收在这个
 * hook 里，屏幕侧照旧拿到一个「有就画、没有就退回底色」的字符串。
 */
export function useChatBackgroundImageSource(
  stored: string | null | undefined,
): string | null {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    if (!stored) {
      setSource(null);
      return;
    }

    let cancelled = false;
    // 换会话/换背景时先清掉：宁可闪一下底色，也不要把上一张壁纸挂在新会话上。
    setSource(null);
    void resolveChatBackgroundImageSource(stored).then(
      (resolved) => {
        if (!cancelled) setSource(resolved);
      },
      () => {
        if (!cancelled) setSource(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [stored]);

  return source;
}
