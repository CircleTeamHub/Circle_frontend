import { useEffect } from 'react';
import Head from 'expo-router/head';
import { usePathname } from 'expo-router';
import { APP_WEB_TITLE } from '@/constants/branding';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

/**
 * 浏览器标签页标题（仅 web 挂载，见 app/_layout）。
 *
 * 双通道：expo-router/head 管首帧与头部声明；导航后的重申走下面的
 * effect（expo-router 每次导航会自己同步一次 document.title，深层路由
 * 没配 title 就写成空，必须有人最后再写一笔）。未读数与消息 tab 红点
 * 同源（tabBadgeStore），消息到达/已读即时刷新，形如「(3) WindNote 风信」。
 */
export function WebDocumentTitle() {
  const unread = useTabBadgeStore((state) => state.messagesUnread);
  const pathname = usePathname();
  const title =
    unread > 0
      ? `(${unread > 99 ? '99+' : unread}) ${APP_WEB_TITLE}`
      : APP_WEB_TITLE;

  // expo-router 在每次导航时会自己同步一次 document.title（深层路由没配
  // title 就写成空）。Head 管首帧，这里在每次 pathname 变化后再断言一次，
  // 保证我们的值落在最后。直写是安全的：badgin 那类 defineProperty 劫持
  // 已在 app-badge 里绕开，<title> 也有真文本节点了。
  useEffect(() => {
    if (typeof document !== 'undefined' && document.title !== title) {
      document.title = title;
    }
  }, [pathname, title]);

  return (
    <Head>
      <title>{title}</title>
    </Head>
  );
}
