import { create } from 'zustand';
import type { MyCirclePost, NotificationItem } from '@/types';
import {
  notificationDomain,
  type NotificationDomain,
} from '@/features/notifications/utils/notification-domain';

interface NotificationCenterState {
  /** 两个铃铛共用的通知池；各自按 domain 过滤后展示。 */
  interactive: NotificationItem[];
  /** 报名管理 tab: posts the current user authored. */
  signupPosts: MyCirclePost[];
  setInteractive: (items: NotificationItem[]) => void;
  /**
   * 用某个域的最新一页替换该域的旧数据，别的域原样保留 —— 朋友圈铃铛的刷新
   * 不该把圈子铃铛已经拉到的通知冲掉（两个铃铛共用这一个池子）。
   */
  setInteractiveForDomain: (
    domain: NotificationDomain | null,
    items: NotificationItem[],
  ) => void;
  appendInteractivePage: (items: NotificationItem[]) => void;
  setSignupPosts: (items: MyCirclePost[]) => void;
  markInteractiveReadLocal: (id: string) => void;
  removeInteractiveLocal: (id: string) => void;
  markAllInteractiveReadLocal: () => void;
  /** Zero one post's unread signup count (author opened its signer list). */
  markPostSignupsSeenLocal: (postId: string) => void;
  markAllSignupsSeenLocal: () => void;
  /** 只把某个域的通知标记为已读（「全部已读」按域收窄）。 */
  markDomainInteractiveReadLocal: (domain: NotificationDomain | null) => void;
}

function byCreatedAtDesc(a: NotificationItem, b: NotificationItem): number {
  return b.createdAt.localeCompare(a.createdAt);
}

export const useNotificationCenterStore = create<NotificationCenterState>(
  (set) => ({
    interactive: [],
    signupPosts: [],
    setInteractive: (items) => set({ interactive: items }),
    setInteractiveForDomain: (domain, items) =>
      set((s) => {
        if (!domain) return { interactive: items };
        const incomingIds = new Set(items.map((item) => item.id));
        const kept = s.interactive.filter(
          (item) =>
            !incomingIds.has(item.id) &&
            notificationDomain(item.type) !== domain,
        );
        return { interactive: [...items, ...kept].sort(byCreatedAtDesc) };
      }),
    appendInteractivePage: (items) =>
      set((s) => {
        const seen = new Set(s.interactive.map((item) => item.id));
        return {
          interactive: [
            ...s.interactive,
            ...items.filter((item) => !seen.has(item.id)),
          ],
        };
      }),
    setSignupPosts: (items) => set({ signupPosts: items }),
    markInteractiveReadLocal: (id) =>
      set((s) => ({
        interactive: s.interactive.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        ),
      })),
    removeInteractiveLocal: (id) =>
      set((s) => ({ interactive: s.interactive.filter((n) => n.id !== id) })),
    markAllInteractiveReadLocal: () =>
      set((s) => ({
        interactive: s.interactive.map((n) => ({ ...n, read: true })),
      })),
    markDomainInteractiveReadLocal: (domain) =>
      set((s) => ({
        interactive: s.interactive.map((n) =>
          !domain || notificationDomain(n.type) === domain
            ? { ...n, read: true }
            : n,
        ),
      })),
    markPostSignupsSeenLocal: (postId) =>
      set((s) => ({
        signupPosts: s.signupPosts.map((p) =>
          p.id === postId ? { ...p, unreadSignupCount: 0 } : p,
        ),
      })),
    markAllSignupsSeenLocal: () =>
      set((s) => ({
        signupPosts: s.signupPosts.map((p) =>
          p.unreadSignupCount > 0 ? { ...p, unreadSignupCount: 0 } : p,
        ),
      })),
  }),
);
