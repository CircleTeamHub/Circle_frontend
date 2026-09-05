import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GroupChatAvatar } from '@/components/ui/group-chat-avatar';
import { Divider } from '@/components/ui/divider';
import { NavHeader } from '@/components/ui/nav-header';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchMyCircles } from '@/services/api/circles';
import type { MyCircle } from '@/types';
import { reportHandledFailure } from '@/observability/report-failure';
import { useAuthStore } from '@/stores/authStore';
import { createGroupsRequestGuard } from '@/features/contacts/groups-request-guard';

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

interface GroupSection {
  title: string;
  data: GroupItem[];
}

type GroupCategory = 'new' | 'joined' | 'created' | 'managed';

const EMPTY_GROUPS_BY_CATEGORY: Record<GroupCategory, GroupItem[]> = {
  new: [],
  joined: [],
  created: [],
  managed: [],
};

function dedupeCircles(circles: MyCircle[]) {
  return [...new Map(circles.map((circle) => [circle.id, circle])).values()];
}

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
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
});

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const sessionEpoch = useAuthStore((state) => state.sessionEpoch);

  const [activeCategory, setActiveCategory] = useState<GroupCategory>('joined');
  const [groupsState, setGroupsState] = useState(() => ({
    sessionEpoch,
    groupsByCategory: EMPTY_GROUPS_BY_CATEGORY,
  }));
  const groupsByCategory =
    groupsState.sessionEpoch === sessionEpoch
      ? groupsState.groupsByCategory
      : EMPTY_GROUPS_BY_CATEGORY;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const requestGuardRef = useRef(createGroupsRequestGuard());

  const loadGroups = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const token = requestGuardRef.current.begin(sessionEpoch);
      const isCancelled = () =>
        Boolean(signal?.cancelled) ||
        !mountedRef.current ||
        !requestGuardRef.current.isActive(
          token,
          useAuthStore.getState().sessionEpoch,
        );
      setLoading(true);
      try {
        const [applied, joined, created] = await Promise.all([
          fetchMyCircles('applied'),
          fetchMyCircles('joined'),
          fetchMyCircles('created'),
        ]);
        if (isCancelled()) return;
        const createdIDs = new Set(created.map((circle) => circle.id));
        const allActive = dedupeCircles([...created, ...joined]);
        const managed = allActive.filter(
          (circle) => circle.myRole === 'OWNER' || circle.myRole === 'ADMIN',
        );
        setGroupsState({
          sessionEpoch: token.sessionEpoch,
          groupsByCategory: {
            new: dedupeCircles(applied).map(circleToGroupItem),
            joined: dedupeCircles(
              joined.filter((circle) => !createdIDs.has(circle.id)),
            ).map(circleToGroupItem),
            created: dedupeCircles(created).map(circleToGroupItem),
            managed: managed.map(circleToGroupItem),
          },
        });
        setError(null);
      } catch (caughtError) {
        if (isCancelled()) return;
        setError(t('contacts.groupsScreen.loadFailed'));
        reportHandledFailure('contacts', 'fetchMyCircles', caughtError);
      } finally {
        if (!isCancelled()) {
          setLoading(false);
        }
      }
    },
    [sessionEpoch, t],
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGuardRef.current.invalidate();
    };
  }, []);

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

  const categories = useMemo(
    () => [
      { id: 'new' as const, label: t('contacts.groupsScreen.newGroups') },
      { id: 'joined' as const, label: t('contacts.groupsScreen.myJoined') },
      { id: 'created' as const, label: t('contacts.groupsScreen.myCreated') },
      { id: 'managed' as const, label: t('contacts.groupsScreen.myManaged') },
    ],
    [t],
  );

  const sections = useMemo<GroupSection[]>(() => {
    const active = categories.find((category) => category.id === activeCategory);
    return [{
      title: active?.label ?? '',
      data: groupsByCategory[activeCategory],
    }];
  }, [activeCategory, categories, groupsByCategory]);

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
      <Text style={d.emptyText}>{t('contacts.groupsScreen.empty')}</Text>
    );

  return (
    <View style={[d.container, { paddingTop: insets.top }]}>
      <NavHeader title={t('contacts.groupsScreen.title')} />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.groupID}
        contentContainerStyle={d.listContent}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={s.categoryTabs}>
            <FilterTabs
              tabs={categories.map((category) => category.label)}
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
        }
        renderSectionHeader={({
          section,
        }: {
          section: SectionListData<GroupItem, GroupSection>;
        }) => (
          <View style={s.sectionHeader}>
            <Text style={d.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
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
