import { create } from 'zustand';

// 注意：这里没有 systemUnread。它曾是「写不读」的死状态，且两条写入路径对语义
// 各执一词（realtime 推 profile-only 计数，恢复路径写 discover+profile 总和），
// 谁先渲染它谁踩雷 —— 已整体删除（#103）。tab 徽标读 profileUnread，
// 发现页铃铛读 discoverUnread。
type TabBadgeSnapshot = {
  messagesUnread?: number;
  contactsUnread?: number;
  discoverUnread?: number;
  momentsUnread?: number;
  circleUnread?: number;
  signupUnread?: number;
  profileUnread?: number;
};

type TabBadgeState = {
  messagesUnread: number;
  contactsUnread: number;
  /** 互动消息 unread 总数 (= momentsUnread + circleUnread + 好友申请通知). */
  discoverUnread: number;
  /** 朋友圈铃铛 unread —— 动态点赞/评论/回复/@ + 资料点赞。 */
  momentsUnread: number;
  /** 圈子铃铛 unread —— 担保验证/入圈审批/圈子帖动态（不含报名）。 */
  circleUnread: number;
  /** 报名管理 unread (signups on my posts). */
  signupUnread: number;
  profileUnread: number;
  isRealtimeConnected: boolean;
  lastSyncedAt: number | null;
  setMessagesUnread: (count: number) => void;
  setContactsUnread: (count: number) => void;
  setDiscoverUnread: (count: number) => void;
  setMomentsUnread: (count: number) => void;
  setCircleUnread: (count: number) => void;
  setSignupUnread: (count: number) => void;
  setProfileUnread: (count: number) => void;
  applySnapshot: (snapshot: TabBadgeSnapshot) => void;
  setRealtimeConnected: (connected: boolean) => void;
  reset: () => void;
};

const initialState = {
  messagesUnread: 0,
  contactsUnread: 0,
  discoverUnread: 0,
  momentsUnread: 0,
  circleUnread: 0,
  signupUnread: 0,
  profileUnread: 0,
  isRealtimeConnected: false,
  lastSyncedAt: null,
};

export const useTabBadgeStore = create<TabBadgeState>((set) => ({
  ...initialState,
  setMessagesUnread: (messagesUnread) => set({ messagesUnread }),
  setContactsUnread: (contactsUnread) => set({ contactsUnread }),
  setDiscoverUnread: (discoverUnread) => set({ discoverUnread }),
  setMomentsUnread: (momentsUnread) => set({ momentsUnread }),
  setCircleUnread: (circleUnread) => set({ circleUnread }),
  setSignupUnread: (signupUnread) => set({ signupUnread }),
  setProfileUnread: (profileUnread) => set({ profileUnread }),
  applySnapshot: (snapshot) =>
    set((state) => ({
      messagesUnread: snapshot.messagesUnread ?? state.messagesUnread,
      contactsUnread: snapshot.contactsUnread ?? state.contactsUnread,
      discoverUnread: snapshot.discoverUnread ?? state.discoverUnread,
      momentsUnread: snapshot.momentsUnread ?? state.momentsUnread,
      circleUnread: snapshot.circleUnread ?? state.circleUnread,
      signupUnread: snapshot.signupUnread ?? state.signupUnread,
      profileUnread: snapshot.profileUnread ?? state.profileUnread,
      lastSyncedAt: Date.now(),
    })),
  setRealtimeConnected: (isRealtimeConnected) => set({ isRealtimeConnected }),
  reset: () => set(initialState),
}));
