import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useTabBadgeStore } from '@/stores/tabBadgeStore';
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
  // Web:expo-notifications 的角标实现走 badgin,它 defineProperty 劫持
  // document.title;<title> 没有文本子节点时(Expo web 默认就是空标题),
  // expo-router 后续一设标题就在 badgin.changeTitle 里抛
  // 「Cannot set properties of undefined ('nodeValue')」打崩整页。
  // 网页版不做系统级角标 —— tab 内红点已由 tabBadgeStore 覆盖。
  if (Platform.OS === 'web') return;
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

let lastConversations: unknown = null;
let lastTotal = 0;

/** tab 与图标角标共用的口径:服务端未读合计。 */
function memoizedTotalUnread(): number {
  const state = useChatStore.getState();
  // chat store 每次写入都会来到这里(「正在输入」「在线」「已送达」也算),而这些事件
  // 不改会话列表。会话列表引用没变就直接用上次的结果,免得每次都整表求和。
  if (lastConversations === state.conversations) return lastTotal;
  lastTotal = selectTotalUnread(state);
  lastConversations = state.conversations;
  return lastTotal;
}

/** 幂等安装 store 订阅;connectChat 时调用,登出 reset 会把角标随之清零。 */
export function initChatAppBadgeSync(): void {
  if (installed) return;
  installed = true;
  const push = (): void => syncAppBadge(memoizedTotalUnread());
  useChatStore.subscribe(push);
  push();
}
