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
import { Radius, Spacing, Typography, useTheme } from '@/theme';
import { fetchMyCircles } from '@/services/api/circles';
import type { MyCircle } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { reportHandledFailure } from '@/observability/report-failure';

/** 自研栈下「群聊」= 圈子;沿用旧字段名以少动渲染层。 */
interface GroupItem {
  groupID: string;
  groupName: string;
  faceURL: string | null;
  memberCount: number;
  introduction: string | null;
  ownerUserID: string;
}

function circleToGroupItem(circle: MyCircle): GroupItem {
  return {
    groupID: circle.id,
    groupName: circle.name,
    faceURL: circle.avatarUrl,
    memberCount: circle.memberCount,
    introduction: circle.description || null,
    ownerUserID: circle.ownerID,
  };
}

interface GroupSection {
  title: string;
  data: GroupItem[];
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
});

export default function GroupsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();

  // 当前账号 ID 决定哪些群是"我创建的"（ownerUserID === 我）。
  const currentUserID = useAuthStore((state) => state.user?.id ?? null);

  const [groups, setGroups] = useState<GroupItem[]>([]);
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
        reportHandledFailure('contacts', 'fetchMyCircles', caughtError);
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

  const sections = useMemo<GroupSection[]>(() => {
    if (!currentUserID) {
      return [{ title: t('contacts.groupsScreen.myJoined'), data: groups }];
    }

    // 拆"我创建"与"我加入"两段。
    const created: GroupItem[] = [];
    const joined: GroupItem[] = [];
    for (const group of groups) {
      if (group.ownerUserID === currentUserID) {
        created.push(group);
      } else {
        joined.push(group);
      }
    }

    const result: GroupSection[] = [];
    if (created.length > 0) {
      result.push({ title: t('contacts.groupsScreen.myCreated'), data: created });
    }
    if (joined.length > 0) {
      result.push({ title: t('contacts.groupsScreen.myJoined'), data: joined });
    }
    return result;
  }, [groups, currentUserID, t]);

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
