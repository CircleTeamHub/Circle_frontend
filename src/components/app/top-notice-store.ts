import { create } from 'zustand';

/**
 * 顶部提醒（toast）状态。「最新的赢」而不是排队：提醒是对刚才那一下操作的回执，
 * 排队展示 3 秒前的回执只会让人困惑。要按顺序逐条看的（收到消息 / 通知）
 * 走 NotificationSnackbarHost 那条队列。
 */

export type TopNoticeType = 'success' | 'error' | 'warning' | 'info';

export interface TopNoticeAction {
  label: string;
  onPress: () => void;
}

export interface TopNoticeRequest {
  type?: TopNoticeType;
  title: string;
  message?: string;
  /** 自动消失的毫秒数；缺省按类型（错误停得更久）。 */
  durationMs?: number;
  action?: TopNoticeAction;
}

export interface TopNotice extends TopNoticeRequest {
  id: number;
  type: TopNoticeType;
  durationMs: number;
}

const DEFAULT_DURATION_MS: Record<TopNoticeType, number> = {
  success: 2400,
  info: 2400,
  warning: 3200,
  error: 4000,
};

interface TopNoticeState {
  current: TopNotice | null;
  show: (request: TopNoticeRequest) => number;
  hide: (id?: number) => void;
  reset: () => void;
}

let nextId = 1;

export const useTopNoticeStore = create<TopNoticeState>((set, get) => ({
  current: null,
  show: (request) => {
    const type = request.type ?? 'info';
    const id = nextId++;
    set({
      current: {
        ...request,
        id,
        type,
        durationMs: request.durationMs ?? DEFAULT_DURATION_MS[type],
      },
    });
    return id;
  },
  hide: (id) => {
    const { current } = get();
    if (!current) return;
    // 带 id 的隐藏（自动消失计时器）只许隐藏自己那条，别把刚换上来的新提醒一起收掉。
    if (id !== undefined && current.id !== id) return;
    set({ current: null });
  },
  reset: () => set({ current: null }),
}));

export function showTopNotice(request: TopNoticeRequest): number {
  return useTopNoticeStore.getState().show(request);
}

export function hideTopNotice(id?: number): void {
  useTopNoticeStore.getState().hide(id);
}

type Shorthand = (title: string, message?: string) => number;

const shorthand =
  (type: TopNoticeType): Shorthand =>
  (title, message) =>
    showTopNotice({ type, title, message });

/** `topNotice.success('已复制')` —— 业务代码里最常见的四种一行搞定。 */
export const topNotice = {
  success: shorthand('success'),
  error: shorthand('error'),
  warning: shorthand('warning'),
  info: shorthand('info'),
} as const;
