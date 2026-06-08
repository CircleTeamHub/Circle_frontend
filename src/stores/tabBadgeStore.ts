import { create } from 'zustand';

type TabBadgeSnapshot = {
  messagesUnread?: number;
  contactsUnread?: number;
  discoverUnread?: number;
  signupUnread?: number;
  profileUnread?: number;
  systemUnread?: number;
};

type TabBadgeState = {
  messagesUnread: number;
  contactsUnread: number;
  /** 互动消息 unread (trace comments/replies + circle verification/invitation). */
  discoverUnread: number;
  /** 报名管理 unread (signups on my posts). */
  signupUnread: number;
  profileUnread: number;
  systemUnread: number;
  isRealtimeConnected: boolean;
  lastSyncedAt: number | null;
  setMessagesUnread: (count: number) => void;
  setContactsUnread: (count: number) => void;
  setDiscoverUnread: (count: number) => void;
  setSignupUnread: (count: number) => void;
  setProfileUnread: (count: number) => void;
  setSystemUnread: (count: number) => void;
  applySnapshot: (snapshot: TabBadgeSnapshot) => void;
  setRealtimeConnected: (connected: boolean) => void;
  reset: () => void;
};

const initialState = {
  messagesUnread: 0,
  contactsUnread: 0,
  discoverUnread: 0,
  signupUnread: 0,
  profileUnread: 0,
  systemUnread: 0,
  isRealtimeConnected: false,
  lastSyncedAt: null,
};

export const useTabBadgeStore = create<TabBadgeState>((set) => ({
  ...initialState,
  setMessagesUnread: (messagesUnread) => set({ messagesUnread }),
  setContactsUnread: (contactsUnread) => set({ contactsUnread }),
  setDiscoverUnread: (discoverUnread) => set({ discoverUnread }),
  setSignupUnread: (signupUnread) => set({ signupUnread }),
  setProfileUnread: (profileUnread) => set({ profileUnread }),
  setSystemUnread: (systemUnread) => set({ systemUnread }),
  applySnapshot: (snapshot) =>
    set((state) => ({
      messagesUnread: snapshot.messagesUnread ?? state.messagesUnread,
      contactsUnread: snapshot.contactsUnread ?? state.contactsUnread,
      discoverUnread: snapshot.discoverUnread ?? state.discoverUnread,
      signupUnread: snapshot.signupUnread ?? state.signupUnread,
      profileUnread: snapshot.profileUnread ?? state.profileUnread,
      systemUnread: snapshot.systemUnread ?? state.systemUnread,
      lastSyncedAt: Date.now(),
    })),
  setRealtimeConnected: (isRealtimeConnected) => set({ isRealtimeConnected }),
  reset: () => set(initialState),
}));
