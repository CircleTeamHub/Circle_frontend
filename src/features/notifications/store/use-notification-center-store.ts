import { create } from 'zustand';
import type { MyCirclePost, NotificationItem } from '@/types';

interface NotificationCenterState {
  interactive: NotificationItem[];
  /** 报名管理 tab: posts the current user authored. */
  signupPosts: MyCirclePost[];
  setInteractive: (items: NotificationItem[]) => void;
  setSignupPosts: (items: MyCirclePost[]) => void;
  markInteractiveReadLocal: (id: string) => void;
  removeInteractiveLocal: (id: string) => void;
  markAllInteractiveReadLocal: () => void;
  /** Zero one post's unread signup count (author opened its signer list). */
  markPostSignupsSeenLocal: (postId: string) => void;
  markAllSignupsSeenLocal: () => void;
}

export const useNotificationCenterStore = create<NotificationCenterState>(
  (set) => ({
    interactive: [],
    signupPosts: [],
    setInteractive: (items) => set({ interactive: items }),
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
