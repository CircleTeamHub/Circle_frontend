import { CircleAvatar } from "@/components/ui/circle-avatar";
import { Divider } from "@/components/ui/divider";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { useCirclesStore } from "@/features/discover/store/use-circles-store";
import { useDiscoverFilterStore } from "@/features/discover/store/use-discover-filter-store";
import { applyCircleFilter } from "@/features/discover/utils/circle-filter";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { Circle } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

const CIRCLE_TAB_KEYS = ["joined", "created", "managed", "applied"] as const;

const s = StyleSheet.create({
  container: {
    gap: Spacing.lg,
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
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

  useEffect(() => {
    fetchMyCircles();
  }, [fetchMyCircles]);

  const tabKey = CIRCLE_TAB_KEYS[activeTab] ?? CIRCLE_TAB_KEYS[0];
  const filterCircleIds = useDiscoverFilterStore((st) => st.appliedCircleIds);
  const filterCities = useDiscoverFilterStore((st) => st.appliedCities);

  const circles = useMemo(() => {
    const circlesByTab: Record<(typeof CIRCLE_TAB_KEYS)[number], Circle[]> = {
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
        color: colors.primary,
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
        // 4 个筛选标签在西语/日语下更长，改可横向滚动避免挤压/换行。
        scrollable
      />

      {myCirclesLoading ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
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
        <View style={s.listContent}>
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
