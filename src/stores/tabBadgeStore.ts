import { create } from 'zustand';

// 注意：这里没有 systemUnread。它曾是「写不读」的死状态，且两条写入路径对语义
// 各执一词（realtime 推 profile-only 计数，恢复路径写 discover+profile 总和），
// 谁先渲染它谁踩雷 —— 已整体删除（#103）。tab 徽标读 profileUnread，
// 发现页铃铛读 discoverUnread。
type TabBadgeSnapshot = {
  messagesUnread?: number;
  contactsUnread?: number;
  groupAdmissionsUnread?: number;
  discoverUnread?: number;
  momentsUnread?: number;
  circleUnread?: number;
  signupUnread?: number;
  profileUnread?: number;
  groupNoticeUnread?: number;
  circlePlazaHasUpdate?: boolean;
  circlePlazaChangedAt?: number;
};

type TabBadgeState = {
  messagesUnread: number;
  contactsUnread: number;
  groupAdmissionsUnread: number;
  /** 互动消息 unread 总数 (= momentsUnread + circleUnread + 好友申请通知). */
  discoverUnread: number;
  /** 朋友圈铃铛 unread —— 动态点赞/评论/回复/@ + 资料点赞。 */
  momentsUnread: number;
  /** 圈子铃铛 unread —— 担保验证/入圈审批/活动结束与认可（不含报名）。 */
  circleUnread: number;
  /** 报名管理 unread (signups on my posts). */
  signupUnread: number;
  profileUnread: number;
  /** 消息页「通知」里的群聊知会（被移出独立群聊 / 群聊解散）。 */
  groupNoticeUnread: number;
  /** 飞机 tab 的红点：圈子帖子列表有别人发的新帖。只是一个点，不计数。 */
  circlePlazaHasUpdate: boolean;
  circlePlazaChangedAt: number | null;
  /** 探索 tab / 朋友圈磁贴的小红点：好友发了新动态（不推送，只亮这个点）。不计数。 */
  momentsHasUpdate: boolean;
  isRealtimeConnected: boolean;
  lastSyncedAt: number | null;
  setMessagesUnread: (count: number) => void;
  setGroupAdmissionsUnread: (count: number) => void;
  setContactsUnread: (count: number) => void;
  setDiscoverUnread: (count: number) => void;
  setMomentsUnread: (count: number) => void;
  setCircleUnread: (count: number) => void;
  setSignupUnread: (count: number) => void;
  setProfileUnread: (count: number) => void;
  setGroupNoticeUnread: (count: number) => void;
  setCirclePlazaHasUpdate: (hasUpdate: boolean, changedAt?: number) => void;
  setMomentsHasUpdate: (hasUpdate: boolean) => void;
  applySnapshot: (snapshot: TabBadgeSnapshot) => void;
  setRealtimeConnected: (connected: boolean) => void;
  reset: () => void;
};

const initialState = {
  messagesUnread: 0,
  contactsUnread: 0,
  groupAdmissionsUnread: 0,
  discoverUnread: 0,
  momentsUnread: 0,
  circleUnread: 0,
  signupUnread: 0,
  profileUnread: 0,
  groupNoticeUnread: 0,
  circlePlazaHasUpdate: false,
  circlePlazaChangedAt: null,
  momentsHasUpdate: false,
  isRealtimeConnected: false,
  lastSyncedAt: null,
};

export const useTabBadgeStore = create<TabBadgeState>((set) => ({
  ...initialState,
  setMessagesUnread: (messagesUnread) => set({ messagesUnread }),
  setGroupAdmissionsUnread: (groupAdmissionsUnread) => set({ groupAdmissionsUnread }),
  setContactsUnread: (contactsUnread) => set({ contactsUnread }),
  setDiscoverUnread: (discoverUnread) => set({ discoverUnread }),
  setMomentsUnread: (momentsUnread) => set({ momentsUnread }),
  setCircleUnread: (circleUnread) => set({ circleUnread }),
  setSignupUnread: (signupUnread) => set({ signupUnread }),
  setProfileUnread: (profileUnread) => set({ profileUnread }),
  setGroupNoticeUnread: (groupNoticeUnread) => set({ groupNoticeUnread }),
  setCirclePlazaHasUpdate: (circlePlazaHasUpdate, changedAt) => set((state) => {
    if (changedAt !== undefined && state.circlePlazaChangedAt !== null
      && changedAt < state.circlePlazaChangedAt) return state;
    return {
      circlePlazaHasUpdate,
      circlePlazaChangedAt: changedAt ?? state.circlePlazaChangedAt,
    };
  }),
  setMomentsHasUpdate: (momentsHasUpdate) => set({ momentsHasUpdate }),
  applySnapshot: (snapshot) =>
    set((state) => {
      // A legacy snapshot cannot replace a known semantic version.
      const applyPlaza = snapshot.circlePlazaHasUpdate !== undefined
        && (state.circlePlazaChangedAt === null
          || (snapshot.circlePlazaChangedAt !== undefined
            && snapshot.circlePlazaChangedAt >= state.circlePlazaChangedAt));
      return {
        messagesUnread: snapshot.messagesUnread ?? state.messagesUnread,
        contactsUnread: snapshot.contactsUnread ?? state.contactsUnread,
        groupAdmissionsUnread: snapshot.groupAdmissionsUnread ?? state.groupAdmissionsUnread,
        discoverUnread: snapshot.discoverUnread ?? state.discoverUnread,
        momentsUnread: snapshot.momentsUnread ?? state.momentsUnread,
        circleUnread: snapshot.circleUnread ?? state.circleUnread,
        signupUnread: snapshot.signupUnread ?? state.signupUnread,
        profileUnread: snapshot.profileUnread ?? state.profileUnread,
        groupNoticeUnread: snapshot.groupNoticeUnread ?? state.groupNoticeUnread,
        circlePlazaHasUpdate: applyPlaza ? snapshot.circlePlazaHasUpdate! : state.circlePlazaHasUpdate,
        circlePlazaChangedAt: applyPlaza
          ? snapshot.circlePlazaChangedAt ?? state.circlePlazaChangedAt : state.circlePlazaChangedAt,
        lastSyncedAt: Date.now(),
      };
    }),
  setRealtimeConnected: (isRealtimeConnected) => set({ isRealtimeConnected }),
  reset: () => set(initialState),
}));

/**
 * 消息页「通知」行的数字 = 圈子以外的全部未读：朋友圈互动、群聊知会、系统公告，
 * 加上「新的朋友」里待处理的好友申请和入群申请。它也是消息 tab 角标里通知的那一份。
 */
export const selectNoticeUnread = (state: Pick<
  TabBadgeState,
  'momentsUnread' | 'groupNoticeUnread' | 'profileUnread' | 'contactsUnread' | 'groupAdmissionsUnread'
>): number =>
  state.momentsUnread +
  state.groupNoticeUnread +
  state.profileUnread +
  state.contactsUnread +
  state.groupAdmissionsUnread;
