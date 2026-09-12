import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Divider } from '@/components/ui/divider';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { loadChatConversations } from '@/chat-core/api';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { useChatStore } from '@/chat-core/store';
import {
  filterGroupChatRows,
  selectGroupConversations,
} from '@/features/contacts/utils/group-chat-rows';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { reportHandledFailure } from '@/observability/report-failure';
import { Spacing, Typography, useTheme } from '@/theme';
import { getLocalizedDateTimeLocale } from '@/utils/locale';

const s = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 14,
  },
  rowMeta: {
    flex: 1,
    gap: 4,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: 56,
  },
  retryButton: {
    minWidth: 96,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
});

interface NewGroupsInboxListProps {
  /** 顶部搜索框的关键词，两个页签共用一个输入框。 */
  query: string;
}

/**
 * 「新的群组」页签：最近加入的群聊。
 *
 * 群聊没有入群申请流程（拉人即进），所以这张表按本人入群时刻倒序 ——
 * 刚被拉进来的群排在最上面。圈子的入圈申请是另一回事，不在这里。
 */
export const NewGroupsInboxList: React.FC<NewGroupsInboxListProps> = ({ query }) => {
  const router = useRouter();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const conversations = useChatStore((state) => state.conversations);
  const [loading, setLoading] = useState(conversations.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  const loadGroups = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const isCancelled = () => Boolean(signal?.cancelled) || !mountedRef.current;

      try {
        await loadChatConversations();
        if (isCancelled()) return;
        setError(null);
      } catch (caughtError) {
        if (isCancelled()) return;
        setError(t('contacts.groupInbox.loadFailed'));
        reportHandledFailure('contacts', 'loadChatConversations', caughtError);
      } finally {
        if (!isCancelled()) {
          setLoading(false);
        }
      }
    },
    [t],
  );

  // 会话列表是全局 store：进屏拉一次即可，别的屏改了群名这里也跟着变。
  useFocusEffect(
    useCallback(() => {
      mountedRef.current = true;
      const signal = { cancelled: false };
      void loadGroups(signal);
      return () => {
        signal.cancelled = true;
        mountedRef.current = false;
      };
    }, [loadGroups]),
  );

  const handleRefreshGroups = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await loadGroups();
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [loadGroups]);

  const d = useMemo(
    () => ({
      title: {
        color: colors.text,
        ...Typography.body,
        fontWeight: '500' as const,
      },
      subtitle: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      retryButton: {
        backgroundColor: colors.primary,
      },
      retryButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
    }),
    [colors],
  );

  const rows = useMemo(() => {
    const groups = selectGroupConversations(conversations).map(
      (conversation) => ({
        conversation,
        ui: mapChatConversationToUI(conversation),
        joinedAt: conversation.joinedAt ?? null,
      }),
    );
    return filterGroupChatRows(
      groups.map((group) => ({ ...group, name: group.ui.name })),
      query,
    );
  }, [conversations, query]);

  const openGroup = useCallback(
    (row: (typeof rows)[number]) => {
      router.push(
        getChatDetailHref(
          'contacts',
          row.ui.sourceID,
          row.ui.name,
          row.ui.avatarUrl,
          row.conversation.id,
          undefined,
          'group',
        ),
      );
    },
    [router],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: (typeof rows)[number]; index: number }) => (
      <View>
        <Pressable style={s.row} onPress={() => openGroup(item)}>
          <GroupChatAvatar size={44} name={item.name} uri={item.ui.avatarUrl} />
          <View style={s.rowMeta}>
            <Text style={d.title} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={d.subtitle} numberOfLines={1}>
              {item.joinedAt
                ? t('contacts.groupInbox.joinedAt', {
                    time: new Date(item.joinedAt).toLocaleString(
                      getLocalizedDateTimeLocale(i18n.language),
                    ),
                  })
                : t('contacts.groupInbox.joined')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
        {index < rows.length - 1 ? <Divider /> : null}
      </View>
    ),
    [colors.textSecondary, d, i18n.language, openGroup, rows.length, t],
  );

  const emptyState = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('contacts.groupInbox.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable
        style={[s.retryButton, d.retryButton]}
        onPress={() => {
          void loadGroups();
        }}
      >
        <Text style={d.retryButtonText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  ) : (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>
        {query.trim()
          ? t('contacts.friendActivity.noMatches')
          : t('contacts.groupInbox.empty')}
      </Text>
    </View>
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.conversation.id}
      renderItem={renderItem}
      ListEmptyComponent={emptyState}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      refreshing={refreshing}
      onRefresh={handleRefreshGroups}
    />
  );
};
