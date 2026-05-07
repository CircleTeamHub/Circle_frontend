import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Divider } from '@/components/ui/divider';
import { MenuRow } from '@/components/ui/menu-row';
import { NavHeader } from '@/components/ui/nav-header';
import { buildChatInfoState } from '@/features/chat/chat-info';
import {
  DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  getChatBackgroundPreferenceLabel,
  useChatPreferencesStore,
} from '@/features/chat/store/use-chat-preferences-store';
import {
  clearConversationMessages,
  fromImUserId,
  getOrCreateSingleConversation,
  setConversationBurnDuration,
  setConversationMute,
  toggleConversationPinned,
} from '@/im/client';
import {
  getChatDetailHref,
  getChatBackgroundHref,
  getChatHistorySearchHubHref,
  getEditFriendRemarkHref,
  getEditFriendTagsHref,
  getRecommendFriendHref,
  getUserProfileHref,
} from '@/features/user/utils/routes';
import {
  addFriendToBlacklist,
  deleteFriendRelationship,
  fetchFriendStatus,
  removeFriendFromBlacklist,
} from '@/services/api/friends';
import { useIMStore } from '@/stores/imStore';
import { Radius, Spacing, useTheme } from '@/theme';

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  section: {
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.md,
  },
});

const initialActionPending = {
  pin: false,
  mute: false,
  burn: false,
  clear: false,
};

type ConversationActionKey = keyof typeof initialActionPending;
type OptimisticConversationState = {
  pinned?: boolean;
  muted?: boolean;
  burnDuration?: number;
};
type OptimisticConversationStateKey = keyof OptimisticConversationState;

export default function ChatInfoScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    id?: string;
    sourceID?: string;
    name?: string;
    title?: string;
    conversationID?: string;
    originScope?: string;
  }>();
  const [blacklist, setBlacklist] = useState(false);
  const [blacklistPending, setBlacklistPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [actionPending, setActionPending] = useState(initialActionPending);
  const actionPendingRef = useRef(initialActionPending);
  const actionRequestTokenRef = useRef({
    pin: 0,
    mute: 0,
    burn: 0,
    clear: 0,
  });
  const currentConversationIDRef = useRef('');
  const [optimisticConversationState, setOptimisticConversationState] =
    useState<OptimisticConversationState>({});
  const conversations = useIMStore((state) => state.conversations);

  // 来源可能是 OpenIM 去连字符的 32 位 hex（从会话列表跳进来）或后端的 UUID
  // （从联系人/资料页跳进来）。两种用途要区分：
  //   - friendId：所有业务后端 /friend/* 接口都被 ParseUUIDPipe 校验，必须 UUID。
  //   - routeSourceID：保留原始形式，用来按 conversation.userID 在 IM 会话列表里查找。
  const rawFriendId =
    typeof params.id === 'string'
      ? params.id
      : typeof params.sourceID === 'string'
        ? params.sourceID
        : '';
  const friendId = rawFriendId ? fromImUserId(rawFriendId) : '';
  const friendName =
    typeof params.name === 'string'
      ? params.name
      : typeof params.title === 'string'
        ? params.title
        : t('chat.friend');
  const routeSourceID = rawFriendId;
  const originScope =
    params.originScope === 'contacts' || params.originScope === 'profile'
      ? params.originScope
      : 'messages';
  const conversationID =
    typeof params.conversationID === 'string' ? params.conversationID : '';
  const conversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.conversationID === conversationID) ??
      conversations.find(
        (conversation) =>
          conversation.userID === routeSourceID || conversation.groupID === routeSourceID,
      ) ??
      null,
    [conversationID, conversations, routeSourceID],
  );
  const resolvedConversationID = conversation?.conversationID ?? '';
  currentConversationIDRef.current = resolvedConversationID;
  const baseState = useMemo(
    () => buildChatInfoState(conversation),
    [conversation],
  );
  const backgroundPreference = useChatPreferencesStore(
    (state) =>
      state.backgroundsByConversationID[resolvedConversationID] ??
      DEFAULT_CHAT_BACKGROUND_PREFERENCE,
  );
  const backgroundLabel = useMemo(
    () => getChatBackgroundPreferenceLabel(backgroundPreference),
    [backgroundPreference],
  );
  const backHref = useMemo(() => {
    if (originScope === 'messages') {
      return getChatDetailHref(
        routeSourceID,
        friendName,
        undefined,
        resolvedConversationID || conversationID,
      );
    }

    return getUserProfileHref(originScope, friendId, friendName);
  }, [
    conversationID,
    friendId,
    friendName,
    originScope,
    resolvedConversationID,
    routeSourceID,
  ]);
  const pinned = optimisticConversationState.pinned ?? baseState.pinned;
  const muted = optimisticConversationState.muted ?? baseState.muted;
  const burnDuration = optimisticConversationState.burnDuration ?? conversation?.burnDuration ?? 0;
  const hasOptimisticConversationState =
    optimisticConversationState.pinned !== undefined ||
    optimisticConversationState.muted !== undefined ||
    optimisticConversationState.burnDuration !== undefined;
  const burnLabel = useMemo(
    () =>
      buildChatInfoState({
        isPinned: pinned,
        recvMsgOpt: muted ? 2 : 0,
        burnDuration,
      }).burnLabel,
    [burnDuration, muted, pinned],
  );
  const burnDurationOptions = useMemo(
    () => [
      { label: t('chat.burnOff'), duration: 0 },
      { label: t('chat.burn10s'), duration: 10 },
      { label: t('chat.burn1m'), duration: 60 },
      { label: t('chat.burn5m'), duration: 300 },
    ],
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      if (!friendId) {
        setBlacklist(false);
        return () => {
          cancelled = true;
        };
      }

      fetchFriendStatus(friendId)
        .then((status) => {
          if (!cancelled) {
            setBlacklist(status.status === 'BLOCKED');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setBlacklist(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [friendId]),
  );

  useEffect(() => {
    actionPendingRef.current = initialActionPending;
    setActionPending(initialActionPending);
    setOptimisticConversationState({});
  }, [resolvedConversationID]);

  useEffect(() => {
    if (!hasOptimisticConversationState) {
      return;
    }

    setOptimisticConversationState((current) => {
      const nextState = { ...current };
      let changed = false;

      if (current.pinned !== undefined && current.pinned === baseState.pinned) {
        delete nextState.pinned;
        changed = true;
      }

      if (current.muted !== undefined && current.muted === baseState.muted) {
        delete nextState.muted;
        changed = true;
      }

      if (
        current.burnDuration !== undefined &&
        current.burnDuration === (conversation?.burnDuration ?? 0)
      ) {
        delete nextState.burnDuration;
        changed = true;
      }

      return changed ? nextState : current;
    });
  }, [
    baseState.muted,
    baseState.pinned,
    conversation?.burnDuration,
    hasOptimisticConversationState,
  ]);

  const openActionError = useCallback((error: unknown) => {
    Alert.alert(
      t('common.errorOccurred'),
      error instanceof Error ? error.message : t('common.networkError'),
    );
  }, [t]);

  const setConversationActionPending = useCallback(
    (action: ConversationActionKey, nextPending: boolean) => {
      actionPendingRef.current = {
        ...actionPendingRef.current,
        [action]: nextPending,
      };
      setActionPending(actionPendingRef.current);
    },
    [],
  );

  const startActionRequest = useCallback((action: ConversationActionKey) => {
    const nextToken = actionRequestTokenRef.current[action] + 1;
    actionRequestTokenRef.current = {
      ...actionRequestTokenRef.current,
      [action]: nextToken,
    };
    return nextToken;
  }, []);

  const isActionConversationCurrent = useCallback(
    (conversationID: string) => currentConversationIDRef.current === conversationID,
    [],
  );

  const isLatestActionRequest = useCallback(
    (action: ConversationActionKey, requestToken: number) =>
      actionRequestTokenRef.current[action] === requestToken,
    [],
  );

  const dropOptimisticConversationStateKey = useCallback(
    (key: OptimisticConversationStateKey) => {
      setOptimisticConversationState((current) => {
        if (current[key] === undefined) {
          return current;
        }

        const nextState = { ...current };
        delete nextState[key];
        return nextState;
      });
    },
    [],
  );

  const runConversationAction = useCallback(
    async (
      action: ConversationActionKey,
      task: () => Promise<void>,
      onStart?: () => void,
      rollback?: () => void,
    ) => {
      if (!resolvedConversationID || actionPendingRef.current[action]) {
        return;
      }

      const actionConversationID = resolvedConversationID;
      const actionRequestToken = startActionRequest(action);
      setConversationActionPending(action, true);
      onStart?.();

      try {
        await task();
      } catch (error) {
        if (
          isActionConversationCurrent(actionConversationID) &&
          isLatestActionRequest(action, actionRequestToken)
        ) {
          rollback?.();
          openActionError(error);
        }
      } finally {
        if (
          isActionConversationCurrent(actionConversationID) &&
          isLatestActionRequest(action, actionRequestToken)
        ) {
          setConversationActionPending(action, false);
        }
      }
    },
    [
      isActionConversationCurrent,
      isLatestActionRequest,
      openActionError,
      resolvedConversationID,
      startActionRequest,
      setConversationActionPending,
    ],
  );

  const handleOpenRemark = useCallback(() => {
    if (!friendId) {
      return;
    }

    router.push(getEditFriendRemarkHref('messages', friendId, friendName));
  }, [friendId, friendName]);

  const handleOpenTags = useCallback(() => {
    if (!friendId) {
      return;
    }

    router.push(getEditFriendTagsHref('messages', friendId, friendName));
  }, [friendId, friendName]);

  const handleOpenChatBackground = useCallback(() => {
    if (!resolvedConversationID) {
      return;
    }

    router.push(
      getChatBackgroundHref(resolvedConversationID, routeSourceID, friendName),
    );
  }, [friendName, resolvedConversationID, routeSourceID]);

  const handleOpenRecommendFriend = useCallback(() => {
    if (!resolvedConversationID || !friendId) {
      return;
    }

    router.push(
      getRecommendFriendHref(resolvedConversationID, friendId, friendName),
    );
  }, [friendId, friendName, resolvedConversationID]);

  const resolveConversationIDForNavigation = useCallback(async () => {
    const existingConversationID = resolvedConversationID.trim();

    if (existingConversationID) {
      return existingConversationID;
    }

    if (!friendId) {
      return '';
    }

    try {
      const conversation = await getOrCreateSingleConversation(friendId);
      return conversation.conversationID;
    } catch (error) {
      openActionError(error);
      return '';
    }
  }, [friendId, openActionError, resolvedConversationID]);

  const handleOpenSearchHistory = useCallback(() => {
    void (async () => {
      const nextConversationID = await resolveConversationIDForNavigation();

      if (!nextConversationID) {
        return;
      }

      router.push(
        getChatHistorySearchHubHref(
          nextConversationID,
          routeSourceID,
          friendName,
        ),
      );
    })();
  }, [friendName, resolveConversationIDForNavigation, routeSourceID]);

  const handleToggleBlacklist = useCallback(
    (nextValue: boolean) => {
      if (!friendId || blacklistPending) {
        return;
      }

      setBlacklistPending(true);
      const previousValue = blacklist;
      setBlacklist(nextValue);

      const request = nextValue
        ? addFriendToBlacklist(friendId)
        : removeFriendFromBlacklist(friendId);

      void request
        .catch((error: unknown) => {
          setBlacklist(previousValue);
          openActionError(error);
        })
        .finally(() => {
          setBlacklistPending(false);
        });
    },
    [blacklist, blacklistPending, friendId, openActionError],
  );

  const handleConfirmDeleteContact = useCallback(() => {
    if (!friendId || deletePending) {
      return;
    }

    Alert.alert(t('chat.deleteFriend'), t('chat.deleteFriendWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          setDeletePending(true);
          void deleteFriendRelationship(friendId)
            .then(() => {
              Alert.alert(t('chat.deleted'), t('chat.friendDeleted'), [
                {
                  text: t('common.ok'),
                  onPress: () => router.back(),
                },
              ]);
            })
            .catch((error: unknown) => {
              openActionError(error);
            })
            .finally(() => {
              setDeletePending(false);
            });
        },
      },
    ]);
  }, [deletePending, friendId, openActionError, t]);

  const handleTogglePinned = useCallback(
    (nextPinned: boolean) => {
      if (!resolvedConversationID || actionPending.pin) {
        return;
      }

      void runConversationAction(
        'pin',
        () => toggleConversationPinned(resolvedConversationID, nextPinned),
        () =>
          setOptimisticConversationState((current) => ({
            ...current,
            pinned: nextPinned,
          })),
        () => dropOptimisticConversationStateKey('pinned'),
      );
    },
    [
      actionPending.pin,
      dropOptimisticConversationStateKey,
      resolvedConversationID,
      runConversationAction,
    ],
  );

  const handleToggleMuted = useCallback(
    (nextMuted: boolean) => {
      if (!resolvedConversationID || actionPending.mute) {
        return;
      }

      void runConversationAction(
        'mute',
        () => setConversationMute(resolvedConversationID, nextMuted),
        () =>
          setOptimisticConversationState((current) => ({
            ...current,
            muted: nextMuted,
          })),
        () => dropOptimisticConversationStateKey('muted'),
      );
    },
    [
      actionPending.mute,
      dropOptimisticConversationStateKey,
      resolvedConversationID,
      runConversationAction,
    ],
  );

  const applyBurnDuration = useCallback(
    (nextBurnDuration: number) => {
      if (
        !resolvedConversationID ||
        actionPending.burn ||
        nextBurnDuration === burnDuration
      ) {
        return;
      }

      void runConversationAction(
        'burn',
        () => setConversationBurnDuration(resolvedConversationID, nextBurnDuration),
        () =>
          setOptimisticConversationState((current) => ({
            ...current,
            burnDuration: nextBurnDuration,
          })),
        () => dropOptimisticConversationStateKey('burnDuration'),
      );
    },
    [
      actionPending.burn,
      burnDuration,
      dropOptimisticConversationStateKey,
      resolvedConversationID,
      runConversationAction,
    ],
  );

  const handleOpenBurnDurationPicker = useCallback(() => {
    if (!resolvedConversationID || actionPending.burn) {
      return;
    }

    Alert.alert(
      t('chat.burnMessage'),
      t('chat.selectBurnTime'),
      [
        ...burnDurationOptions.map(({ label, duration }) => ({
          text: label,
          onPress: () => applyBurnDuration(duration),
        })),
        { text: t('common.cancel'), style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }, [actionPending.burn, applyBurnDuration, burnDurationOptions, resolvedConversationID, t]);

  const handleConfirmClearHistory = useCallback(() => {
    if (!resolvedConversationID || actionPending.clear) {
      return;
    }

    Alert.alert(
      t('chat.clearHistory'),
      t('chat.clearHistoryWarning'),
      [
        { text: t('common.cancel'), style: 'cancel' as const },
        {
          text: t('chat.clear'),
          style: 'destructive' as const,
          onPress: () => {
            void runConversationAction('clear', () =>
              clearConversationMessages(resolvedConversationID),
            );
          },
        },
      ],
      { cancelable: true },
    );
  }, [actionPending.clear, resolvedConversationID, runConversationAction, t]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      section: {
        backgroundColor: colors.surface,
      },
    }),
    [colors],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('chat.chatInfo')} fallbackHref={backHref} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, d.section]}>
          <MenuRow icon="create-outline" label={t('chat.setRemark')} onPress={handleOpenRemark} />
          <Divider />
          <MenuRow icon="pricetag-outline" label={t('chat.tags')} onPress={handleOpenTags} />
          <Divider />
          <MenuRow
            icon="search-outline"
            label={t('chat.searchHistory')}
            onPress={handleOpenSearchHistory}
          />
          <Divider />
          <MenuRow
            icon="image-outline"
            label={t('chat.chatBackground')}
            rightText={backgroundLabel}
            onPress={handleOpenChatBackground}
          />
          <Divider />
          <MenuRow
            icon="arrow-up-circle-outline"
            label={t('chat.pinChat')}
            hasToggle={!actionPending.pin}
            onToggle={actionPending.pin ? undefined : handleTogglePinned}
            toggleValue={pinned}
            rightText={actionPending.pin ? t('chat.pending') : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="notifications-off-outline"
            label={t('chat.muteNotification')}
            hasToggle={!actionPending.mute}
            onToggle={actionPending.mute ? undefined : handleToggleMuted}
            toggleValue={muted}
            rightText={actionPending.mute ? t('chat.pending') : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="flame-outline"
            label={t('chat.burnMessage')}
            onPress={actionPending.burn ? undefined : handleOpenBurnDurationPicker}
            rightText={actionPending.burn ? t('chat.pending') : burnLabel}
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="share-social-outline"
            label={t('chat.recommendFriend')}
            onPress={handleOpenRecommendFriend}
          />
          <Divider />
          <MenuRow
            icon="ban-outline"
            label={t('chat.addBlacklist')}
            hasToggle={!blacklistPending}
            toggleValue={blacklist}
            onToggle={handleToggleBlacklist}
            rightText={blacklistPending ? t('chat.pending') : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="trash-outline"
            label={t('chat.clearHistory')}
            onPress={actionPending.clear ? undefined : handleConfirmClearHistory}
            rightText={actionPending.clear ? t('chat.pending') : undefined}
          />
          <Divider />
          <MenuRow
            icon="warning-outline"
            label={t('chat.report')}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/messages/report-friend',
                params: { friendUserId: friendId, friendName },
              })
            }
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="person-remove-outline"
            label={t('chat.deleteFriend')}
            destructive
            onPress={deletePending ? undefined : handleConfirmDeleteContact}
            rightText={deletePending ? t('chat.pending') : undefined}
          />
        </View>
      </ScrollView>
    </View>
  );
}
