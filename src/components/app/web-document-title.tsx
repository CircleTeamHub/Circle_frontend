import Head from 'expo-router/head';
import { APP_WEB_TITLE } from '@/constants/branding';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';

/**
 * 浏览器标签页标题（仅 web 挂载，见 app/_layout）。
 *
 * 走 expo-router/head 的头部管理，而不是直写 document.title —— 直写会和
 * 路由导航时的标题同步互相覆盖（badgin 当年就是在这条路上把整页打崩的，
 * 见 app-badge.ts 的注释）。未读数与消息 tab 红点同源（tabBadgeStore），
 * 消息到达/已读即时刷新，形如「(3) WindNote 风信」。
 */
export function WebDocumentTitle() {
  const unread = useTabBadgeStore((state) => state.messagesUnread);
  const title =
    unread > 0
      ? `(${unread > 99 ? '99+' : unread}) ${APP_WEB_TITLE}`
      : APP_WEB_TITLE;

  return (
    <Head>
      <title>{title}</title>
    </Head>
  );
}
