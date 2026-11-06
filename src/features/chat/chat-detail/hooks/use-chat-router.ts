import { createContext, useContext, useMemo } from 'react';
import { router, type Href } from 'expo-router';

/**
 * 半屏聊天(app/quick-chat.tsx)是根栈上的透明 modal。从它里面直接 push `/(tabs)/...`,
 * expo-router 会在根栈分叉、再压一整份 (tabs) 盖在 modal 上。半屏里往外跳之前先处理掉 modal:
 * - 离开聊天的跳转(资料页、群信息、笔记详情…)先关掉半屏,落进原来那份 (tabs);
 * - 选完要回到聊天的页面(分享选择、转账)先展开成完整聊天页,再压在它上面。
 * QuickChatScreen 提供这两个方法,普通聊天页没有 Provider,行为不变。
 */
export type ChatSheetNavigation = { dismiss: () => void; expand: () => void };

export const ChatSheetNavigationContext = createContext<ChatSheetNavigation | null>(null);

export type ChatRouter = {
  /** 离开聊天:半屏先关掉。 */
  push: (href: Href) => void;
  navigate: (href: Href) => void;
  /** 结果要回到这个聊天:半屏先展开成完整聊天页。 */
  pushOverChat: (href: Href) => void;
};

export function useChatRouter(): ChatRouter {
  const sheet = useContext(ChatSheetNavigationContext);
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
      pushOverChat: (href: Href) => {
        sheet?.expand();
        router.push(href);
      },
    }),
    [sheet],
  );
}
