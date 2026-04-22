import { Divider } from "@/components/ui/divider";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { useCirclesStore } from "@/features/discover/store/use-circles-store";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { Circle } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

const CIRCLE_FILTER_TABS = ["已加入", "我创建的", "我申请的"];

const TAG_MAP: Record<string, { label: string; color: string }> = {
  joined: { label: "已加入", color: "#22C55E" },
  created: { label: "我创建的", color: "#F5B318" },
  applied: { label: "审核中", color: "#3B82F6" },
};

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
  cover: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  tag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
});

export const MyCirclesPanel: React.FC = () => {
  const { colors } = useTheme();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);
  const {
    joinedCircles,
    createdCircles,
    appliedCircles,
    myCirclesLoading,
    myCirclesError,
    fetchMyCircles,
  } = useCirclesStore();

  useEffect(() => {
    fetchMyCircles();
  }, [fetchMyCircles]);

  const tabKey = activeTab === 0 ? "joined" : activeTab === 1 ? "created" : "applied";
  const circles =
    activeTab === 0
      ? joinedCircles
      : activeTab === 1
        ? createdCircles
        : appliedCircles;

  const tagInfo = TAG_MAP[tabKey];

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
      tagText: {
        color: colors.white,
        ...Typography.small,
        fontWeight: "600" as const,
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
        <Text style={d.title}>圈子详情</Text>
        <Pressable
          style={[s.createButton, d.createButton]}
          onPress={() => router.push('/(tabs)/discover/create-circle')}
        >
          <Text style={d.createButtonText}>创建圈子</Text>
        </Pressable>
      </View>

      <FilterTabs
        tabs={CIRCLE_FILTER_TABS}
        activeIndex={activeTab}
        onTabPress={setActiveTab}
      />

      {myCirclesLoading ? (
        <View style={s.emptyContainer}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : myCirclesError && circles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>{myCirclesError}</Text>
          <Pressable style={d.retryButton} onPress={fetchMyCircles}>
            <Text style={d.retryText}>重试</Text>
          </Pressable>
        </View>
      ) : circles.length === 0 ? (
        <View style={s.emptyContainer}>
          <Text style={d.emptyText}>暂无圈子</Text>
        </View>
      ) : (
        <View style={s.listContent}>
          {myCirclesError ? (
            <View style={s.emptyContainer}>
              <Text style={d.emptyText}>{myCirclesError}</Text>
              <Pressable style={d.retryButton} onPress={fetchMyCircles}>
                <Text style={d.retryText}>重试</Text>
              </Pressable>
            </View>
          ) : null}
          {circles.map((item, index) => (
            <View key={item.id}>
              <Pressable
                style={s.row}
                onPress={() => router.push({ pathname: '/(tabs)/discover/circle/[id]', params: { id: item.id } })}
              >
                <Image
                  source={{ uri: item.avatarUrl ?? undefined }}
                  style={[s.cover, d.cover]}
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
