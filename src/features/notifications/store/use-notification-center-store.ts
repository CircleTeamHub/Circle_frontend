import { create } from 'zustand';
import type { CircleActivityItem, NotificationItem } from '@/types';

interface NotificationCenterState {
  interactive: NotificationItem[];
  circle: CircleActivityItem[];
  setInteractive: (items: NotificationItem[]) => void;
  setCircle: (items: CircleActivityItem[]) => void;
  markInteractiveReadLocal: (id: string) => void;
  removeInteractiveLocal: (id: string) => void;
  markAllInteractiveReadLocal: () => void;
  markCircleReadLocal: (id: string) => void;
  markAllCircleReadLocal: () => void;
}

export const useNotificationCenterStore = create<NotificationCenterState>(
  (set) => ({
    interactive: [],
    circle: [],
    setInteractive: (items) => set({ interactive: items }),
    setCircle: (items) => set({ circle: items }),
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
    markCircleReadLocal: (id) =>
      set((s) => ({
        circle: s.circle.map((a) =>
          a.id === id ? { ...a, readAt: new Date().toISOString() } : a,
        ),
      })),
    markAllCircleReadLocal: () =>
      set((s) => ({
        circle: s.circle.map((a) =>
          a.readAt ? a : { ...a, readAt: new Date().toISOString() },
        ),
      })),
  }),
);
