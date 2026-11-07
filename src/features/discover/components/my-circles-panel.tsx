import { CircleAvatar } from "@/components/ui/circle-avatar";
import { Divider } from "@/components/ui/divider";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { useCirclesStore, useHydrateCirclesSnapshot } from "@/features/discover/store/use-circles-store";
import { useDiscoverFilterStore } from "@/features/discover/store/use-discover-filter-store";
import { applyCircleFilter } from "@/features/discover/utils/circle-filter";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { Circle } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

const CIRCLE_TAB_KEYS = ["all", "joined", "created", "managed", "applied"] as const;

const s = StyleSheet.create({
  container: {
    gap: Spacing.lg,
  },
  filterNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  createButton: {
    paddingHorizontal: Spacing.md,
    height: 32,
    borderRadius: Radius.full,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  listContent: {
    marginTop: Spacing.sm,
  },
  listSurface: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
});

export const MyCirclesPanel: React.FC = () => {
  useHydrateCirclesSnapshot();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);
  const {
    joinedCircles,
    createdCircles,
    managedCircles,
    appliedCircles,
    myCirclesLoading,
    myCirclesError,
    fetchMyCircles,
  } = useCirclesStore(
    useShallow((s) => ({
      joinedCircles: s.joinedCircles,
      createdCircles: s.createdCircles,
      managedCircles: s.managedCircles,
      appliedCircles: s.appliedCircles,
      myCirclesLoading: s.myCirclesLoading,
      myCirclesError: s.myCirclesError,
      fetchMyCircles: s.fetchMyCircles,
    })),
  );

  useFocusEffect(useCallback(() => {
    void fetchMyCircles();
  }, [fetchMyCircles]));

  const tabKey = CIRCLE_TAB_KEYS[activeTab] ?? CIRCLE_TAB_KEYS[0];
  const filterCircleIds = useDiscoverFilterStore((st) => st.appliedCircleIds);
  const filterCities = useDiscoverFilterStore((st) => st.appliedCities);
  const clearAppliedFilter = useDiscoverFilterStore(
    (st) => st.clearAppliedFilter,
  );
  // 筛选条件是在广场页设的、全局生效。这个面板挂在「圈子管理 / 我的圈子」下，
  // 那两个页面都没有筛选入口——不给提示的话，圈子会被静默隐藏，用户只会以为
  // 自己退圈了，而且没有任何地方可以清掉它。
  const filterActive = filterCircleIds.length > 0 || filterCities.length > 0;

  const circles = useMemo(() => {
    const circlesByTab: Record<(typeof CIRCLE_TAB_KEYS)[number], Circle[]> = {
      // 已创建的圈子也在已加入里,管理圈子是这两者派生的子集;按 id 去重并集即可。
      all: [
        ...new Map(
          [...joinedCircles, ...createdCircles, ...appliedCircles].map(
            (circle) => [circle.id, circle] as const,
          ),
        ).values(),
      ],
      joined: joinedCircles,
      created: createdCircles,
      managed: managedCircles,
      applied: appliedCircles,
    };
    return applyCircleFilter(circlesByTab[tabKey], {
      circleIds: filterCircleIds,
      cities: filterCities,
    });
  }, [
    appliedCircles,
    createdCircles,
    filterCircleIds,
    filterCities,
    joinedCircles,
    managedCircles,
    tabKey,
  ]);

  const circleFilterTabs = useMemo(
    () => [
      t('common.all'),
      t('discover.joined'),
      t('discover.myCreated'),
      t('discover.myManaged'),
      t('discover.myApplied'),
    ],
    [t],
  );

  const d = useMemo(
    () => ({
      title: {
        color: colors.text,
        ...Typography.title,
      },
      createButton: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      createButtonText: {
        color: colors.iconAccent,
        ...Typography.caption,
        fontWeight: "600" as const,
      },
      cover: {
        backgroundColor: colors.surfaceBorder,
      },
      name: {
        color: colors.text,
        fontSize: 16,
        fontWeight: "600" as const,
        flex: 1,
      },
      emptyText: {
        color: colors.textSecondary,
        ...Typography.body,
      },
      retryButton: {
        marginTop: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.full,
        backgroundColor: colors.primary,
      },
      retryText: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: "600" as const,
      },
      filterNotice: {
        backgroundColor: colors.surface,
      },
      filterNoticeText: {
        flex: 1,
        color: colors.textSecondary,
        ...Typography.caption,
      },
      filterNoticeAction: {
        color: colors.iconAccent,
        ...Typography.caption,
        fontWeight: "600" as const,
      },
      listSurface: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
    }),
    [colors],
  );

  return (
    <View style={s.container}>
      <View style={s.headerRow}>
        <Text style={d.title}>{t('discover.circleDetail')}</Text>
        <Pressable
          style={[s.createButton, d.createButton]}
          onPress={() => router.push('/(tabs)/discover/create-circle')}
        >
          <Text style={d.createButtonText}>{t('discover.createCircle')}</Text>
        </Pressable>
      </View>

      <FilterTabs
        tabs={circleFilterTabs}
        activeIndex={activeTab}
        onTabPress={setActiveTab}
        // 5 个筛选标签在西语/日语下更长，改可横向滚动避免挤压/换行。
        scrollable
      />

      {filterActive ? (
        <View style={[s.filterNotice, d.filterNotice]}>
          <Text style={d.filterNoticeText} numberOfLines={2}>
            {t('discover.filter.activeInMyCircles', {
              defaultValue: '筛选条件生效中，部分圈子已隐藏',
            })}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={clearAppliedFilter}
            hitSlop={8}
          >
            <Text style={d.filterNoticeAction}>
              {t('discover.filter.clear', { defaultValue: '清空条件' })}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* 只有手上什么都没有时才转圈;后台刷新时已缓存的列表留在屏上。 */}
      {myCirclesLoading && circles.length === 0 ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.iconAccent} />
        </View>
      ) : myCirclesError && circles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{myCirclesError}</Text>
          <Pressable style={d.retryButton} onPress={() => fetchMyCircles()}>
            <Text style={d.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : circles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{t('discover.noCircles')}</Text>
        </View>
      ) : (
        <View style={[s.listContent, s.listSurface, d.listSurface]}>
          {myCirclesError ? (
            <View style={s.emptyContainer}>
              <Text style={d.emptyText}>{myCirclesError}</Text>
              <Pressable style={d.retryButton} onPress={() => fetchMyCircles()}>
                <Text style={d.retryText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : null}
          {circles.map((item, index) => (
            <View key={item.id}>
              <Pressable
                style={s.row}
                onPress={() => router.push(`/(tabs)/discover/circle/${encodeURIComponent(item.id)}`)}
              >
                <CircleAvatar
                  uri={item.avatarUrl}
                  size={56}
                  borderRadius={Radius.md}
                  style={d.cover}
                />
                <View style={s.body}>
                  <Text style={d.name} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </View>
              </Pressable>
              {index < circles.length - 1 ? <Divider /> : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
};
