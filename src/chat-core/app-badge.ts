import * as Notifications from 'expo-notifications';
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
  void Notifications.setBadgeCountAsync(total).catch(() => {
    // 设不上(未授权/平台差异)不算错;清掉缓存值让下次变化重试。
    lastApplied = null;
  });
}

/** 幂等安装 store 订阅;connectChat 时调用,登出 reset 会把角标随之清零。 */
export function initChatAppBadgeSync(): void {
  if (installed) return;
  installed = true;
  useChatStore.subscribe((state) => syncAppBadge(selectTotalUnread(state)));
  syncAppBadge(selectTotalUnread(useChatStore.getState()));
}
