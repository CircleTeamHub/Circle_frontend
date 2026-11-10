import { useEffect, useMemo, useState } from 'react';
import { loadChatConversations } from '@/chat-core/api';
import { selectConversations } from '@/chat-core/conversation-selectors';
import { useChatStore } from '@/chat-core/store';
import { reportHandledFailure } from '@/observability/report-failure';
import { fetchFriends, type FriendProfile } from '@/services/api/friends';
import { useAuthStore } from '@/stores/authStore';
import {
  isSendableConversation,
  targetFromConversation,
  targetFromFriend,
  type ChatTarget,
} from './types';
import { useRecentForwardTargetsStore } from './use-recent-forward-targets-store';

export type ChatTargetTab = 'recent' | 'contacts' | 'groups';

const EMPTY_RECENT: ChatTarget[] = [];

/**
 * 选择页的三路数据:最近聊天(会话列表顺序)、通讯录(好友,点开页签或开始搜索才拉)、我的群聊。
 * 「最近转发」从本地记录里取,名字头像按当前会话列表刷新,已退出的会话不再显示。
 */
export function useChatTargetSources(activeTab: ChatTargetTab, searching = false) {
  const conversations = useChatStore(selectConversations);
  const snapshotLoaded = useChatStore((state) => state.conversationsSnapshotLoaded);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);
  const accountScope = `${sessionEpoch}:${userId ?? ''}`;
  const storedRecent = useRecentForwardTargetsStore(
    (state) => (userId ? state.byUser[userId] : undefined) ?? EMPTY_RECENT,
  );
  const [friendsState, setFriendsState] = useState<{
    scope: string;
    value: FriendProfile[] | null;
    failed: boolean;
  }>({ scope: accountScope, value: null, failed: false });
  const friends = friendsState.scope === accountScope ? friendsState.value : null;
  const friendsFailed = friendsState.scope === accountScope && friendsState.failed;
  const [friendsAttempt, setFriendsAttempt] = useState(0);

  useEffect(() => {
    if (snapshotLoaded) return;
    loadChatConversations().catch((error: unknown) => {
      reportHandledFailure('chatTargetPicker', 'loadConversations', error);
    });
  }, [snapshotLoaded]);

  // 搜索也要覆盖还没聊过天的好友,不能等用户先切到通讯录页签。
  const wantsFriends = activeTab === 'contacts' || searching;
  useEffect(() => {
    if (!wantsFriends || friends) return;
    let cancelled = false;
    setFriendsState({ scope: accountScope, value: null, failed: false });
    fetchFriends()
      .then((list) => {
        if (!cancelled) setFriendsState({ scope: accountScope, value: list, failed: false });
      })
      .catch((error: unknown) => {
        reportHandledFailure('chatTargetPicker', 'fetchFriends', error);
        if (!cancelled) setFriendsState({ scope: accountScope, value: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [accountScope, friends, friendsAttempt, wantsFriends]);

  return useMemo(() => {
    const sendable = conversations.filter(isSendableConversation);
    const recentChats = sendable.map(targetFromConversation);
    const groups = recentChats.filter((target) => target.kind !== 'direct');
    const directByPeer = new Map(
      sendable
        .filter((dto) => dto.type === 'DIRECT' && dto.peer?.id)
        .map((dto) => [dto.peer?.id as string, dto.id]),
    );
    const contacts = (friends ?? [])
      .map((friend) => targetFromFriend(friend, directByPeer.get(friend.id) ?? null))
      .sort((left, right) => left.name.localeCompare(right.name));
    const liveByKey = new Map(recentChats.map((target) => [target.key, target]));
    const recentForwards = storedRecent.flatMap((target) => {
      const live = liveByKey.get(target.key);
      return live ? [live] : [];
    });
    return {
      userId,
      recentForwards,
      recentChats,
      contacts,
      groups,
      contactsLoading: wantsFriends && friends === null && !friendsFailed,
      contactsFailed: friendsFailed,
      retryContacts: () => {
        setFriendsState({ scope: accountScope, value: null, failed: false });
        setFriendsAttempt((value) => value + 1);
      },
    };
  }, [accountScope, conversations, friends, friendsFailed, storedRecent, userId, wantsFriends]);
}

/** 搜索跨三个来源:同一个人既是最近聊天又是好友时只出现一次。 */
export function searchChatTargets(
  query: string,
  sources: readonly (readonly ChatTarget[])[],
): ChatTarget[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [];
  const seen = new Set<string>();
  const results: ChatTarget[] = [];
  for (const list of sources) {
    for (const target of list) {
      const dedupeKey = target.userId ? `user:${target.userId}` : target.key;
      if (seen.has(dedupeKey) || !target.name.toLowerCase().includes(keyword)) continue;
      seen.add(dedupeKey);
      results.push(target);
    }
  }
  return results;
}
