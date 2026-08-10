import * as Notifications from 'expo-notifications';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
import { useLocalUnreadStore } from '@/features/messages/store/use-local-unread-store';
import { countLocalUnreadOverrides } from '@/features/messages/utils/local-unread';
import { selectTotalUnread, useChatStore } from './store';

/**
 * G-18 轻方案:App 图标角标跟随消息 tab 未读合计(免打扰会话不计入,
 * 与 tab 角标同一口径 selectTotalUnread)。
 *
 * 已知取舍:推送 payload 尚无 badge 字段(remediation §2.12 批5),
 * 杀后台期间角标停留在最后一次前台值,回前台任一 store 变化即校准。
 */
let installed = false;
let lastApplied: number | null = null;

export function syncAppBadge(total: number): void {
  if (total === lastApplied) return;
  lastApplied = total;
  // G-10:消息 tab 红点同源同步 —— 不再依赖 MessagesScreen 挂载,
  // 冷启动本地水合一完成红点即准。
  try {
    useTabBadgeStore.getState().setMessagesUnread(total);
  } catch {
    // tab store 未就绪不阻塞图标角标。
  }
  void Notifications.setBadgeCountAsync(total)
    .then((applied) => {
      // 未授权/桌面不支持角标时,这个 API **resolve(false)** 而不是 reject。
      // 只在 catch 里复位的话,之后同一个未读数的每次同步都会被
      // `total === lastApplied` 短路 —— 用户后来打开了角标权限,图标却一直
      // 停在旧值,直到未读数字碰巧变化为止。
      if (applied === false) lastApplied = null;
    })
    .catch(() => {
      lastApplied = null;
    });
}

/** tab 与图标角标共用的口径:服务端未读 + 本机「标记为未读」覆盖。 */
function totalWithLocalOverrides(): number {
  const state = useChatStore.getState();
  const serverTotal = selectTotalUnread(state);
  let overrides = 0;
  try {
    // 与 MessagesScreen 的 tab 角标同一个函数、同一个口径。
    overrides = countLocalUnreadOverrides(
      state.conversations.map((c) => ({ id: c.id, unreadCount: c.unreadCount })),
      useLocalUnreadStore.getState().overrides,
    );
  } catch {
    // 本地覆盖 store 未就绪:退回纯服务端口径。
  }
  return serverTotal + overrides;
}

/** 幂等安装 store 订阅;connectChat 时调用,登出 reset 会把角标随之清零。 */
export function initChatAppBadgeSync(): void {
  if (installed) return;
  installed = true;
  const push = (): void => syncAppBadge(totalWithLocalOverrides());
  useChatStore.subscribe(push);
  // 「滑动标记为未读」只改本地覆盖 store,chat store 一动不动 —— 不订阅它的话
  // tab 上有红点、图标角标却是 0,而且此后再也不会自己对上。
  useLocalUnreadStore.subscribe(push);
  push();
}
