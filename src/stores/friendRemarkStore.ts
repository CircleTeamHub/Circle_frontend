import { create } from 'zustand';

// 好友备注的「本地覆盖」store。
//
// 背景：好友资料没有全局 store，各页面（聊天页 / 资料页）各自从导航参数或一次性请求
// 拿到名字快照。用户改备注后只调了 setFriendRemark API，没有任何地方广播变更，
// 已挂载的聊天页因此一直显示旧名字。
//
// 这里维护一份 userID → 备注 的覆盖表，改备注成功后写入，订阅方即时刷新。
// 值约定：
//   - 非空字符串：用该备注覆盖显示名
//   - null：备注被清除，显示名回退到 fallbackName / 订阅方 fallback
//   - 不存在该 key：本次会话未改过，订阅方沿用自身快照
export type FriendRemarkOverride = {
  remark: string | null;
  fallbackName?: string;
};

type FriendRemarkState = {
  remarks: Record<string, FriendRemarkOverride | undefined>;
  setRemark: (
    userID: string,
    remark: string | null,
    fallbackName?: string | null,
  ) => void;
  /** 登出 / 切号时清空，避免跨账号串名。 */
  reset: () => void;
};

export const useFriendRemarkStore = create<FriendRemarkState>((set) => ({
  remarks: {},
  setRemark: (userID, remark, fallbackName) =>
    set((state) => {
      const trimmed = remark?.trim() ?? '';
      const nextFallback =
        fallbackName?.trim() || state.remarks[userID]?.fallbackName;

      return {
        remarks: {
          ...state.remarks,
          [userID]: {
            remark: trimmed.length > 0 ? trimmed : null,
            ...(nextFallback ? { fallbackName: nextFallback } : {}),
          },
        },
      };
    }),
  reset: () => set({ remarks: {} }),
}));
