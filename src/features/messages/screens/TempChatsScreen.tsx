import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  ListRenderItemInfo,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { getApiErrorMessage } from '@/services/api/errors';
import {
  createTempChat,
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
  const endingRoomRef = useRef<string | null>(null);

  const [rooms, setRooms] = useState<TempChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingGroupId, setOpeningGroupId] = useState<string | null>(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [endingRoomId, setEndingRoomId] = useState<string | null>(null);
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
        if (__DEV__) {
          console.warn('[TempChatsScreen] fetchMyTempChats failed', caughtError);
        }
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

  const shareRoomLink = useCallback(
    async (title: string, shareUrl: string | null) => {
      if (!shareUrl) return;
      try {
        await Share.share({
          message: t('tempChats.shareMessage', { title, url: shareUrl }),
        });
      } catch {
        // 用户主动取消不会抛错；走到这里说明系统分享面板不可用，退回复制链接。
        try {
          const Clipboard = await import('expo-clipboard');
          await Clipboard.setStringAsync(shareUrl);
          Alert.alert(t('tempChats.linkCopied'));
        } catch {
          setError(t('tempChats.shareFailed'));
        }
      }
    },
    [t],
  );

  const handleSubmitCreate = useCallback(
    async (payload: CreateTempChatPayload) => {
      if (creatingRoomRef.current) return;
      creatingRoomRef.current = true;
      setCreatingRoom(true);
      setError(null);
      try {
        const created = await createTempChat(payload);
        setCreateVisible(false);
        await loadRooms({ refresh: true });
        // 刚建好就弹出二维码/复制面板，对齐"创建即分享"的使用习惯。
        setShareTarget({ title: created.title, shareUrl: created.shareUrl });
      } catch (caughtError) {
        setError(getApiErrorMessage(caughtError, t('tempChats.createFailed')));
        if (__DEV__) {
          console.warn('[TempChatsScreen] create temp chat failed', caughtError);
        }
      } finally {
        creatingRoomRef.current = false;
        setCreatingRoom(false);
      }
    },
    [loadRooms, t],
  );

  const endRoom = useCallback(
    async (room: TempChatListItem) => {
      // 防止结束请求在途时被重复触发（双击确认 / 列表抖动），避免对同一房间发两次 end。
      if (endingRoomRef.current) return;
      endingRoomRef.current = room.id;
      setEndingRoomId(room.id);
      setError(null);
      try {
        await endTempChat(room.id);
        await loadRooms({ refresh: true });
      } catch (caughtError) {
        setError(getApiErrorMessage(caughtError, t('tempChats.endFailed')));
        if (__DEV__) {
          console.warn('[TempChatsScreen] end temp chat failed', caughtError);
        }
      } finally {
        endingRoomRef.current = null;
        setEndingRoomId(null);
      }
    },
    [loadRooms, t],
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

  const handleRoomActions = useCallback(
    (room: TempChatListItem) => {
      Alert.alert(room.title, undefined, [
        {
          text: t('tempChats.actionShare'),
          onPress: () =>
            setShareTarget({ title: room.title, shareUrl: room.shareUrl }),
        },
        {
          text: t('tempChats.actionEnd'),
          style: 'destructive',
          onPress: () => confirmEndRoom(room),
        },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
    },
    [confirmEndRoom, t],
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
        isBusy={openingGroupId === item.groupId || endingRoomId === item.id}
        disabled={!isTempChatOpenable(item) || Boolean(openingGroupRef.current)}
        onOpen={handleOpenRoom}
        onActions={handleRoomActions}
      />
    ),
    [endingRoomId, handleOpenRoom, handleRoomActions, openingGroupId, rooms.length],
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
        onShareSystem={shareRoomLink}
      />
    </View>
  );
}
