import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchMyCircles } from '@/services/api/circles';
import type { MyCircle } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import {
  filterGroupList,
  type GroupListFilter,
} from '@/features/contacts/utils/group-list-filter';

/** 自研栈下「群聊」= 圈子;沿用旧字段名以少动渲染层。 */
interface GroupItem {
  groupID: string;
  groupName: string;
  faceURL: string | null;
  memberCount: number;
  introduction: string | null;
  ownerUserID: string;
  myRole: MyCircle['myRole'];
}

function circleToGroupItem(circle: MyCircle): GroupItem {
  return {
    groupID: circle.id,
    groupName: circle.name,
    faceURL: circle.avatarUrl,
    memberCount: circle.memberCount,
    introduction: circle.description || null,
    ownerUserID: circle.ownerID,
    myRole: circle.myRole,
  };
}

const s = StyleSheet.create({
  controls: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  filterButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  searchBox: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
  },
  clearButton: {
    padding: Spacing.xs,
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
});

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  // 当前账号 ID 决定哪些群是"我创建的"（ownerUserID === 我）。
  const currentUserID = useAuthStore((state) => state.user?.id ?? null);

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [activeFilter, setActiveFilter] =
    useState<GroupListFilter>('created');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);

  const loadGroups = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const isCancelled = () => Boolean(signal?.cancelled) || !mountedRef.current;
      setLoading(true);
      try {
        // created/joined 两个 tab 并发拉全量,按 id 去重(自研栈 群=圈子)。
        const [created, joined] = await Promise.all([
          fetchMyCircles('created'),
          fetchMyCircles('joined'),
        ]);
        if (isCancelled()) return;
        const byId = new Map<string, MyCircle>();
        for (const circle of [...created, ...joined]) {
          byId.set(circle.id, circle);
        }
        setGroups([...byId.values()].map(circleToGroupItem));
        setError(null);
      } catch (caughtError) {
        if (isCancelled()) return;
        setError(t('contacts.groupsScreen.loadFailed'));
        if (__DEV__) {
          console.warn('[GroupsScreen] fetchMyCircles failed', caughtError);
        }
      } finally {
        if (!isCancelled()) {
          setLoading(false);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void loadGroups(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadGroups]);

  // Focus refresh: 用户创建/退出群后回到这屏需要立刻看到变化。
  useFocusEffect(
    useCallback(() => {
      void loadGroups();
    }, [loadGroups]),
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
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

  const filterItems = useMemo(
    () => [
      {
        id: 'created' as const,
        label: t('contacts.groupsScreen.myCreated'),
      },
      {
        id: 'joined' as const,
        label: t('contacts.groupsScreen.myJoined'),
      },
      {
        id: 'managed' as const,
        label: t('contacts.groupsScreen.myManaged'),
      },
    ],
    [t],
  );

  const visibleGroups = useMemo(
    () => filterGroupList(groups, activeFilter, currentUserID, query),
    [activeFilter, currentUserID, groups, query],
  );

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
      filterButton: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      filterButtonActive: {
        backgroundColor: colors.brandPurple,
        borderColor: colors.brandPurple,
      },
      filterButtonText: {
        color: colors.textSecondary,
        ...Typography.caption,
        fontWeight: '600' as const,
      },
      filterButtonTextActive: {
        color: colors.white,
      },
      searchBox: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      searchInput: {
        color: colors.text,
        ...Typography.bodyRegular,
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
      retryButton: {
        backgroundColor: colors.primary,
        borderRadius: Radius.full,
      },
      retryButtonText: {
        color: colors.white,
        ...Typography.bodyRegular,
        fontWeight: '600' as const,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.bodyRegular,
        textAlign: 'center' as const,
        paddingTop: Spacing.xl,
      },
    }),
    [colors, insets.bottom],
  );

  const handleOpenGroup = useCallback(
    (group: GroupItem) => {
      router.push({
        pathname: '/(tabs)/messages/chat-detail',
        params: {
          sourceID: group.groupID,
          conversationType: 'group',
          title: group.groupName,
        },
      });
    },
    [router],
  );

  const hasSearchQuery = query.trim().length > 0;
  const emptyState =
    loading ? (
      <View style={s.stateBlock}>
        <ActivityIndicator color={colors.primary} />
        <Text style={d.stateText}>
          {t('contacts.groupsScreen.loading', { defaultValue: '正在加载群聊' })}
        </Text>
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
    ) : (
      <Text style={d.emptyText}>
        {hasSearchQuery
          ? t('contacts.groupsScreen.noMatches')
          : t('contacts.groupsScreen.empty')}
      </Text>
    );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('contacts.groupsScreen.title')} />
      <View style={s.controls}>
        <View style={[s.searchBox, d.searchBox]}>
          <Ionicons
            name="search-outline"
            size={19}
            color={colors.textSecondary}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            style={[s.searchInput, d.searchInput]}
            placeholder={t('contacts.groupsScreen.searchPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="never"
            accessibilityLabel={t('contacts.groupsScreen.searchPlaceholder')}
          />
          {query.length > 0 ? (
            <Pressable
              style={s.clearButton}
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('common.clear')}
            >
              <Ionicons
                name="close-circle"
                size={19}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={s.filterRow} accessibilityRole="tablist">
          {filterItems.map((item) => {
            const selected = activeFilter === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setActiveFilter(item.id)}
                style={({ pressed }) => [
                  s.filterButton,
                  d.filterButton,
                  selected && d.filterButtonActive,
                  pressed && { opacity: 0.78 },
                ]}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    d.filterButtonText,
                    selected && d.filterButtonTextActive,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={visibleGroups}
        keyExtractor={(item) => item.groupID}
        contentContainerStyle={d.listContent}
        renderItem={({ item, index }) => (
          <View>
            <Pressable style={s.groupRow} onPress={() => handleOpenGroup(item)}>
              <GroupChatAvatar
                size={40}
                name={item.groupName}
                uri={item.faceURL || undefined}
              />
              <View style={s.groupBody}>
                <View style={s.topRow}>
                  <Text style={d.groupName} numberOfLines={1}>
                    {item.groupName}
                  </Text>
                  <Text style={d.memberCount}>
                    {t('contacts.groupsScreen.memberCount', {
                      count: item.memberCount,
                    })}
                  </Text>
                </View>
                {item.introduction ? (
                  <Text style={d.description} numberOfLines={1}>
                    {item.introduction}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            {index < visibleGroups.length - 1 ? <Divider /> : null}
          </View>
        )}
        ListEmptyComponent={emptyState}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={handleRefreshGroups}
      />
    </View>
  );
}
