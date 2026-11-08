import { createContext, useContext, useMemo } from 'react';
import { router, useSegments, type Href } from 'expo-router';

/**
 * 半屏聊天(app/quick-chat.tsx)是根栈上的透明 modal。从它里面直接 push `/(tabs)/...`,
 * React Navigation 7 会在根栈再压一整份 (tabs)(两份 tab 栏抢同一个桥,点 tab 没反应);
 * iOS 还会把模态之后的普通 push 页放到模态下面,根本看不见。所以半屏里往外跳要分两种:
 * - 离开聊天的跳转(资料页、群信息、笔记详情…)先关掉半屏,落进原来那份 (tabs);
 * - 选完要回到聊天的页面(分享选择、转账、选位置)走 app/chat-sheet/ 下的同名页面,
 *   以模态盖在半屏之上,返回后仍是半屏。只有右上角「展开」才进完整聊天页。
 * QuickChatScreen 提供 Provider,完整聊天页没有 Provider,行为不变。
 */
export type ChatSheetNavigation = { dismiss: () => void };

export const ChatSheetNavigationContext = createContext<ChatSheetNavigation | null>(null);

/** 选完要回到这个聊天的页面。 */
export type OverChatPage = 'share-picker' | 'transfer-composer' | 'location-picker';

/** app/chat-sheet/ 的路由段:这组页面盖在半屏聊天之上。 */
const CHAT_SHEET_SEGMENT = 'chat-sheet';

/** 各自镜像了一份分享选择 / 转账页的 tab 栈(app/(tabs)/<tab>/share-picker 等)。 */
const CHAT_TABS = new Set(['messages', 'contacts', 'discover', 'explore', 'profile']);

/**
 * 完整聊天页里压在聊天所在的那个 tab 栈上:聊天页按来源 scope 分栈(通讯录、发现…都有),
 * 选择页要和它同栈,返回才回到原聊天。以前一律压进消息栈,别的 tab 里打开会跳去消息 tab,
 * 选完落在消息列表。选位置页在根上的 (chat) 栈,从哪个 tab 压都会盖在聊天上。
 */
function fullChatPath(page: OverChatPage, tab: string): string {
  if (page === 'location-picker') return '/(chat)/location-picker';
  return `/(tabs)/${tab}/${page}`;
}

export type ChatRouter = {
  /** 离开聊天:半屏先关掉。 */
  push: (href: Href) => void;
  navigate: (href: Href) => void;
  /** 结果要回到这个聊天:半屏里盖在半屏上,完整聊天页里压在聊天上。 */
  pushOverChat: (page: OverChatPage, params?: Record<string, string>) => void;
};

export function useChatRouter(): ChatRouter {
  const sheet = useContext(ChatSheetNavigationContext);
  const segments = useSegments();
  // 只取 tab 名(字符串)做依赖:别处路由变化时 segments 数组会换引用,不该让聊天页的回调跟着换。
  const tab = segments[0] === '(tabs)' && CHAT_TABS.has(segments[1]) ? segments[1] : 'messages';
  return useMemo(
    () => ({
      push: (href: Href) => {
        sheet?.dismiss();
        router.push(href);
      },
      navigate: (href: Href) => {
        sheet?.dismiss();
        router.navigate(href);
      },
      pushOverChat: (page: OverChatPage, params?: Record<string, string>) => {
        const pathname = sheet ? `/${CHAT_SHEET_SEGMENT}/${page}` : fullChatPath(page, tab);
        router.push((params ? { pathname, params } : pathname) as Href);
      },
    }),
    [sheet, tab],
  );
}

/**
 * 盖在半屏上的页面(app/chat-sheet/*)要离开聊天时,先把自己连同下面的半屏一起关掉再跳,
 * 否则从根栈往 `/(tabs)/...` 跳又会多压一份 (tabs)。不在半屏之上时直接跳。
 * dismiss(2):这一层的嵌套栈只有一页、退不了,POP 冒泡到根栈,一次退掉这一层和半屏。
 */
export function leaveOverChatPage(segments: readonly string[], go: () => void): void {
  if (segments[0] === CHAT_SHEET_SEGMENT) {
    router.dismiss(2);
  }
  go();
}
