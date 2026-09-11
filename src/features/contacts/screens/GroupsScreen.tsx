import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { loadChatConversations } from '@/chat-core/api';
import { mapChatConversationToUI } from '@/chat-core/mappers';
import { useChatStore } from '@/chat-core/store';
import type { ChatConversationDto } from '@/chat-core/protocol';
import {
  filterGroupChatRows,
  selectGroupConversations,
} from '@/features/contacts/utils/group-chat-rows';
import { getChatDetailHref } from '@/features/user/utils/routes';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { reportHandledFailure } from '@/observability/report-failure';

/**
 * 群聊 = 会话（type=GROUP），圈子群和独立群都在内。这里**不是**圈子列表 ——
 * 圈子（含申请中的）在「圈子管理」那屏。分类按本人在群里的角色分，角色由
 * 会话 DTO 的 myRole 给出：圈子群读 CircleMember，独立群读群主/座位管理员。
 */
interface GroupRow {
  conversation: ChatConversationDto;
  name: string;
  avatarUrl?: string;
  sourceID: string;
  /** 行上第二行：独立群的公告；圈子群没有（公告走圈子详情）。 */
  subtitle: string | null;
  memberCount: number | null;
}

interface GroupSection {
  title: string;
  data: GroupRow[];
}

type GroupCategory = 'all' | 'joined' | 'created' | 'managed';

const s = StyleSheet.create({
  sectionHeader: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
  },
  groupBody: {
    flex: 1,
    gap: Spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
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
  categoryTabs: {
    paddingBottom: Spacing.sm,
  },
  searchBox: {
    height: 42,
    borderWidth: 1,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    ...Typography.bodyRegular,
    paddingVertical: 0,
  },
});

function matchesCategory(
  conversation: ChatConversationDto,
  category: GroupCategory,
) {
  const role = conversation.myRole ?? 'MEMBER';
  switch (category) {
    case 'created':
      return role === 'OWNER';
    case 'managed':
      return role === 'OWNER' || role === 'ADMIN';
    case 'joined':
      return role === 'MEMBER';
    case 'all':
    default:
      return true;
  }
}

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const conversations = useChatStore((state) => state.conversations);

  const [activeCategory, setActiveCategory] = useState<GroupCategory>('all');
  // 关键词跨分类保留：用户常常只记得群名、不记得它算「我加入的」还是「我管理的」。
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(conversations.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  // 会话列表是全局 store（自己带会话期闸门），这屏不留副本，也就没有脏写的问题。
  const loadGroups = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const isCancelled = () => Boolean(signal?.cancelled) || !mountedRef.current;
      try {
        await loadChatConversations();
        if (isCancelled()) return;
        setError(null);
      } catch (caughtError) {
        if (isCancelled()) return;
        setError(t('contacts.groupsScreen.loadFailed'));
        reportHandledFailure('contacts', 'loadChatConversations', caughtError);
      } finally {
        if (!isCancelled()) {
          setLoading(false);
        }
      }
    },
    [t],
  );

  // Focus refresh：用户建群/退群后回到这屏需要立刻看到变化。
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

  // tabLabel 是横向页签用的短文案，长文案留给分区标题——四个长标题会把最后一个
  // 页签挤出屏幕。
  const categories = useMemo(
    () => [
      {
        id: 'all' as const,
        tabLabel: t('contacts.groupsScreen.tabAll'),
        label: t('contacts.groupsScreen.allGroups'),
      },
      {
        id: 'joined' as const,
        tabLabel: t('contacts.groupsScreen.tabMyJoined'),
        label: t('contacts.groupsScreen.myJoined'),
      },
      {
        id: 'created' as const,
        tabLabel: t('contacts.groupsScreen.tabMyCreated'),
        label: t('contacts.groupsScreen.myCreated'),
      },
      {
        id: 'managed' as const,
        tabLabel: t('contacts.groupsScreen.tabMyManaged'),
        label: t('contacts.groupsScreen.myManaged'),
      },
    ],
    [t],
  );

  const rows = useMemo<GroupRow[]>(
    () =>
      selectGroupConversations(conversations)
        .filter((conversation) => matchesCategory(conversation, activeCategory))
        .map((conversation) => {
          const ui = mapChatConversationToUI(conversation);
          return {
            conversation,
            name: ui.name,
            avatarUrl: ui.avatarUrl,
            sourceID: ui.sourceID,
            subtitle: conversation.notice?.trim() || null,
            memberCount: conversation.memberCount ?? null,
          };
        }),
    [activeCategory, conversations],
  );

  const sections = useMemo<GroupSection[]>(() => {
    const active = categories.find((category) => category.id === activeCategory);
    return [
      {
        title: active?.label ?? '',
        // 只过滤当前分类：页签是主轴，分区标题写的就是它，跨分类搜会让标题说谎。
        data: filterGroupChatRows(rows, query),
      },
    ];
  }, [activeCategory, categories, query, rows]);

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      listContent: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      },
      sectionTitle: {
        color: colors.text,
        ...Typography.h3,
      },
      groupName: {
        color: colors.text,
        fontSize: 15,
        fontWeight: '600' as const,
        flex: 1,
        marginRight: Spacing.sm,
      },
      memberCount: {
        color: colors.textSecondary,
        ...Typography.small,
      },
      description: {
        color: colors.textSecondary,
        ...Typography.caption,
      },
      stateText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
        paddingVertical: 56,
      },
      retryButton: {
        backgroundColor: colors.primary,
      },
      retryButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      searchBox: {
        borderColor: colors.surfaceBorder,
        backgroundColor: colors.surface,
      },
      searchInput: {
        color: colors.text,
      },
    }),
    [colors, insets.bottom],
  );

  const handleOpenGroup = useCallback(
    (row: GroupRow) => {
      // 留在联系人栈里：跳 messages 栈的话返回键会把用户扔到消息页。
      router.push(
        getChatDetailHref(
          'contacts',
          row.sourceID,
          row.name,
          row.avatarUrl,
          row.conversation.id,
          undefined,
          'group',
        ),
      );
    },
    [router],
  );

  const emptyState = loading ? (
    <View style={s.stateBlock}>
      <ActivityIndicator color={colors.primary} />
      <Text style={d.stateText}>{t('contacts.groupsScreen.loading')}</Text>
    </View>
  ) : error ? (
    <View style={s.stateBlock}>
      <Text style={d.stateText}>{error}</Text>
      <Pressable
        style={[s.retryButton, d.retryButton]}
        onPress={() => void loadGroups()}
      >
        <Text style={d.retryButtonText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  ) : query.trim() ? (
    <Text style={d.emptyText}>{t('contacts.groupsScreen.noMatches')}</Text>
  ) : (
    <Text style={d.emptyText}>{t('contacts.groupsScreen.empty')}</Text>
  );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader
        title={t('contacts.groupsScreen.title')}
        fallbackHref="/(tabs)/contacts"
      />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.conversation.id}
        contentContainerStyle={d.listContent}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View>
            <View style={[s.searchBox, d.searchBox]}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.textSecondary}
              />
              <TextInput
                style={[s.searchInput, d.searchInput]}
                value={query}
                onChangeText={setQuery}
                placeholder={t('contacts.groupsScreen.searchPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel={t('contacts.groupsScreen.searchPlaceholder')}
              />
              {query ? (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.clear')}
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={colors.textSecondary}
                  />
                </Pressable>
              ) : null}
            </View>
            <View style={s.categoryTabs}>
              <FilterTabs
                tabs={categories.map((category) => category.tabLabel)}
                activeIndex={categories.findIndex(
                  (category) => category.id === activeCategory,
                )}
                onTabPress={(index) => {
                  const category = categories[index];
                  if (category) setActiveCategory(category.id);
                }}
                scrollable
                compact
              />
            </View>
          </View>
        }
        renderSectionHeader={({
          section,
        }: {
          section: SectionListData<GroupRow, GroupSection>;
        }) => (
          <View style={s.sectionHeader}>
            <Text style={d.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View>
            <Pressable style={s.groupRow} onPress={() => handleOpenGroup(item)}>
              <GroupChatAvatar size={40} name={item.name} uri={item.avatarUrl} />
              <View style={s.groupBody}>
                <View style={s.topRow}>
                  <Text style={d.groupName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.memberCount === null ? null : (
                    <Text style={d.memberCount}>
                      {t('contacts.groupsScreen.memberCount', {
                        count: item.memberCount,
                      })}
                    </Text>
                  )}
                </View>
                {item.subtitle ? (
                  <Text style={d.description} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {index < section.data.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={emptyState}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={handleRefreshGroups}
      />
    </View>
  );
}
