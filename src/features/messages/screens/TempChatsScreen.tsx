import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  ListRenderItemInfo,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { getApiErrorMessage } from '@/services/api/errors';
import { useChatStore } from '@/chat-core/store';
import {
  createTempChat,
  deleteTempChat,
  endTempChat,
  fetchMyTempChats,
  isTempChatOpenable,
  type TempChatListItem,
} from '@/services/api/temp-chat';
import CreateTempChatModal, {
  type CreateTempChatPayload,
} from '@/features/messages/components/CreateTempChatModal';
import ShareTempChatModal from '@/features/messages/components/ShareTempChatModal';
import TempChatRow from '@/features/messages/components/TempChatRow';
import TempChatListState from '@/features/messages/components/TempChatListState';
import { Spacing, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

const s = StyleSheet.create({
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
});

export default function TempChatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const openingGroupRef = useRef<string | null>(null);
  const creatingRoomRef = useRef(false);
  // 结束 / 删除共用一把闸:同一时刻只处理一间房,防双击确认发两次请求。
  const pendingRoomRef = useRef<string | null>(null);

  const [rooms, setRooms] = useState<TempChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingGroupId, setOpeningGroupId] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<{
    title: string;
    shareUrl: string | null;
  } | null>(null);

  const loadRooms = useCallback(
    async (options?: { refresh?: boolean; cancelled?: () => boolean }) => {
      if (options?.refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const nextRooms = await fetchMyTempChats();
        if (options?.cancelled?.()) return;
        setRooms(nextRooms);
        setError(null);
      } catch (caughtError) {
        if (options?.cancelled?.()) return;
        setError(getApiErrorMessage(caughtError, t('tempChats.loadFailed')));
        reportHandledFailure('tempChats', 'fetch', caughtError);
      } finally {
        if (!options?.cancelled?.()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadRooms({ cancelled: () => cancelled });
      return () => {
        cancelled = true;
      };
    }, [loadRooms]),
  );

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      listContent: {
        ...s.listContent,
        paddingBottom: insets.bottom + Spacing.xl,
      },
    }),
    [colors.background, insets.bottom],
  );

  const handleRefresh = useCallback(() => {
    void loadRooms({ refresh: true });
  }, [loadRooms]);

  const handleCreateRoom = useCallback(() => {
    setCreateVisible(true);
  }, []);

  // 操作失败走对话框:列表的 error 只在空列表时渲染,新建面板开着时也会把它盖住。
  const showActionError = useCallback(
    (titleKey: string, caughtError: unknown) => {
      const title = t(titleKey);
      const message = getApiErrorMessage(caughtError, title);
      Alert.alert(title, message === title ? undefined : message);
    },
    [t],
  );

  const handleSubmitCreate = useCallback(
    async (payload: CreateTempChatPayload) => {
      if (creatingRoomRef.current) return;
      creatingRoomRef.current = true;
      setCreatingRoom(true);
      try {
        const created = await createTempChat(payload);
        setCreateVisible(false);
        await loadRooms({ refresh: true });
        // 刚建好就展示链接，方便房主直接复制给参与者。
        setShareTarget({ title: created.title, shareUrl: created.shareUrl });
      } catch (caughtError) {
        // 面板保持打开;每日上限等服务端错误按 errorCode 本地化后弹出来。
        showActionError('tempChats.createFailed', caughtError);
        reportHandledFailure('tempChats', 'create', caughtError);
      } finally {
        creatingRoomRef.current = false;
        setCreatingRoom(false);
      }
    },
    [loadRooms, showActionError],
  );

  const endRoom = useCallback(
    async (room: TempChatListItem) => {
      if (pendingRoomRef.current) return;
      pendingRoomRef.current = room.id;
      setPendingRoomId(room.id);
      try {
        await endTempChat(room.id);
        await loadRooms({ refresh: true });
      } catch (caughtError) {
        showActionError('tempChats.endFailed', caughtError);
        reportHandledFailure('tempChats', 'end', caughtError);
      } finally {
        pendingRoomRef.current = null;
        setPendingRoomId(null);
      }
    },
    [loadRooms, showActionError],
  );

  const deleteRoom = useCallback(
    async (room: TempChatListItem) => {
      if (pendingRoomRef.current) return;
      pendingRoomRef.current = room.id;
      setPendingRoomId(room.id);
      try {
        await deleteTempChat(room.id);
        setRooms((current) =>
          current.filter((candidate) => candidate.id !== room.id),
        );
        // 服务端让房主离座并推 left 事件给其他设备;本机直接收走,不等事件。
        if (room.conversationId) {
          useChatStore.getState().removeConversation(room.conversationId);
        }
      } catch (caughtError) {
        showActionError('tempChats.deleteFailed', caughtError);
        reportHandledFailure('tempChats', 'delete', caughtError);
      } finally {
        pendingRoomRef.current = null;
        setPendingRoomId(null);
      }
    },
    [showActionError],
  );

  const confirmEndRoom = useCallback(
    (room: TempChatListItem) => {
      Alert.alert(
        t('tempChats.endConfirmTitle'),
        t('tempChats.endConfirmMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('tempChats.endConfirm'),
            style: 'destructive',
            onPress: () => void endRoom(room),
          },
        ],
      );
    },
    [endRoom, t],
  );

  const confirmDeleteRoom = useCallback(
    (room: TempChatListItem) => {
      // 进行中的房间删除前会先被结束,提示里要说清访客会被移出。
      const messageKey = isTempChatOpenable(room)
        ? 'tempChats.deleteActiveConfirmMessage'
        : 'tempChats.deleteConfirmMessage';
      Alert.alert(t('tempChats.deleteConfirmTitle'), t(messageKey), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('tempChats.deleteConfirm'),
          style: 'destructive',
          onPress: () => void deleteRoom(room),
        },
      ]);
    },
    [deleteRoom, t],
  );

  const handleRoomActions = useCallback(
    (room: TempChatListItem) => {
      const deleteAction = {
        text: t('tempChats.actionDelete'),
        style: 'destructive' as const,
        onPress: () => confirmDeleteRoom(room),
      };
      const cancelAction = { text: t('common.cancel'), style: 'cancel' as const };
      if (!isTempChatOpenable(room)) {
        Alert.alert(room.title, undefined, [deleteAction, cancelAction]);
        return;
      }
      Alert.alert(room.title, undefined, [
        {
          text: t('tempChats.copyLink'),
          onPress: () =>
            setShareTarget({ title: room.title, shareUrl: room.shareUrl }),
        },
        {
          text: t('tempChats.actionEnd'),
          style: 'destructive',
          onPress: () => confirmEndRoom(room),
        },
        deleteAction,
        cancelAction,
      ]);
    },
    [confirmDeleteRoom, confirmEndRoom, t],
  );

  const handleOpenRoom = useCallback(
    async (room: TempChatListItem) => {
      if (openingGroupRef.current) return;
      // 列表里的 isActive 是抓取时的快照，可能已过期。进群前按当前时间复核一次。
      if (!isTempChatOpenable(room)) {
        if (room.isActive) {
          setError(t('tempChats.expiredNow'));
          void loadRooms({ refresh: true });
        }
        return;
      }
      // 自研栈:列表已带会话 id,直接进;旧 OpenIM 时代房间(null)不可再进入。
      if (!room.conversationId) {
        setError(t('tempChats.expiredNow'));
        return;
      }
      openingGroupRef.current = room.groupId;
      setOpeningGroupId(room.groupId);
      try {
        router.push({
          pathname: '/(tabs)/messages/chat-detail',
          params: {
            conversationID: room.conversationId,
            sourceID: room.groupId,
            title: room.title,
            conversationType: 'group',
            conversationKind: 'temp',
          },
        });
      } finally {
        openingGroupRef.current = null;
        setOpeningGroupId(null);
      }
    },
    [loadRooms, router, t],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<TempChatListItem>) => (
      <TempChatRow
        room={item}
        isLast={index === rooms.length - 1}
        isBusy={openingGroupId === item.groupId || pendingRoomId === item.id}
        disabled={!isTempChatOpenable(item) || Boolean(openingGroupRef.current)}
        onOpen={handleOpenRoom}
        onActions={handleRoomActions}
      />
    ),
    [handleOpenRoom, handleRoomActions, openingGroupId, pendingRoomId, rooms.length],
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('tempChats.title')}
        rightActions={[
          {
            icon: 'add-outline',
            onPress: () => void handleCreateRoom(),
            accessibilityLabel: t('tempChats.create'),
            disabled: creatingRoom,
          },
          {
            icon: 'refresh-outline',
            onPress: handleRefresh,
            accessibilityLabel: t('tempChats.refresh'),
          },
        ]}
      />
      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <TempChatListState
            loading={loading && rooms.length === 0}
            error={error}
            onRetry={handleRefresh}
          />
        }
        contentContainerStyle={d.listContent}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        showsVerticalScrollIndicator={false}
      />
      <CreateTempChatModal
        visible={createVisible}
        creating={creatingRoom}
        onClose={() => setCreateVisible(false)}
        onSubmit={handleSubmitCreate}
      />
      <ShareTempChatModal
        visible={shareTarget !== null}
        title={shareTarget?.title ?? ''}
        shareUrl={shareTarget?.shareUrl ?? null}
        onClose={() => setShareTarget(null)}
      />
    </View>
  );
}
