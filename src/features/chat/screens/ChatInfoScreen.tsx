import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  setConversationBurnDuration,
  setConversationMute,
  toggleConversationPinned,
} from '@/im/client';
import {
  getChatBackgroundHref,
  getEditFriendRemarkHref,
  getEditFriendTagsHref,
  getRecommendFriendHref,
} from '@/features/user/utils/routes';
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

const BURN_DURATION_OPTIONS = [
  { label: '关闭', duration: 0 },
  { label: '10秒', duration: 10 },
  { label: '1分钟', duration: 60 },
  { label: '5分钟', duration: 300 },
] as const;

const PENDING_TEXT = '处理中';
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
  const params = useLocalSearchParams<{
    id?: string;
    sourceID?: string;
    name?: string;
    title?: string;
    conversationID?: string;
  }>();
  const [blacklist, setBlacklist] = useState(false);
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

  const friendId =
    typeof params.id === 'string'
      ? params.id
      : typeof params.sourceID === 'string'
        ? params.sourceID
        : '';
  const friendName =
    typeof params.name === 'string'
      ? params.name
      : typeof params.title === 'string'
        ? params.title
        : '好友';
  const routeSourceID = friendId;
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

  const openUnsupportedAction = useCallback((label: string) => {
    Alert.alert('暂未开放', `${label} 稍后提供。`);
  }, []);

  const openActionError = useCallback((error: unknown) => {
    Alert.alert(
      '操作失败',
      error instanceof Error ? error.message : '请稍后重试',
    );
  }, []);

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

  const handleDeleteContact = useCallback(() => {
    openUnsupportedAction('删除联系人');
  }, [openUnsupportedAction]);

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
      '好友消息自毁',
      '选择消息自毁时间',
      [
        ...BURN_DURATION_OPTIONS.map(({ label, duration }) => ({
          text: label,
          onPress: () => applyBurnDuration(duration),
        })),
        { text: '取消', style: 'cancel' as const },
      ],
      { cancelable: true },
    );
  }, [actionPending.burn, applyBurnDuration, resolvedConversationID]);

  const handleConfirmClearHistory = useCallback(() => {
    if (!resolvedConversationID || actionPending.clear) {
      return;
    }

    Alert.alert(
      '清空聊天记录',
      '清空后将删除当前会话的聊天记录，且无法恢复。',
      [
        { text: '取消', style: 'cancel' as const },
        {
          text: '清空',
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
  }, [actionPending.clear, resolvedConversationID, runConversationAction]);

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
      <NavHeader title="聊天信息" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.content,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[s.section, d.section]}>
          <MenuRow icon="create-outline" label="设置备注" onPress={handleOpenRemark} />
          <Divider />
          <MenuRow icon="pricetag-outline" label="标签" onPress={handleOpenTags} />
          <Divider />
          <MenuRow
            icon="image-outline"
            label="聊天背景"
            rightText={backgroundLabel}
            onPress={handleOpenChatBackground}
          />
          <Divider />
          <MenuRow
            icon="arrow-up-circle-outline"
            label="置顶聊天"
            hasToggle={!actionPending.pin}
            onToggle={actionPending.pin ? undefined : handleTogglePinned}
            toggleValue={pinned}
            rightText={actionPending.pin ? PENDING_TEXT : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="notifications-off-outline"
            label="消息免打扰"
            hasToggle={!actionPending.mute}
            onToggle={actionPending.mute ? undefined : handleToggleMuted}
            toggleValue={muted}
            rightText={actionPending.mute ? PENDING_TEXT : undefined}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="flame-outline"
            label="好友消息自毁"
            onPress={actionPending.burn ? undefined : handleOpenBurnDurationPicker}
            rightText={actionPending.burn ? PENDING_TEXT : burnLabel}
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="share-social-outline"
            label="把他推荐给朋友"
            onPress={handleOpenRecommendFriend}
          />
          <Divider />
          <MenuRow
            icon="ban-outline"
            label="加入黑名单"
            hasToggle
            toggleValue={blacklist}
            onToggle={setBlacklist}
            showArrow={false}
          />
          <Divider />
          <MenuRow
            icon="trash-outline"
            label="清空聊天记录"
            onPress={actionPending.clear ? undefined : handleConfirmClearHistory}
            rightText={actionPending.clear ? PENDING_TEXT : undefined}
          />
          <Divider />
          <MenuRow
            icon="warning-outline"
            label="投诉举报"
            onPress={() => openUnsupportedAction('投诉举报')}
          />
        </View>

        <View style={[s.section, d.section]}>
          <MenuRow
            icon="person-remove-outline"
            label="删除联系人"
            destructive
            onPress={handleDeleteContact}
          />
        </View>
      </ScrollView>
    </View>
  );
}
