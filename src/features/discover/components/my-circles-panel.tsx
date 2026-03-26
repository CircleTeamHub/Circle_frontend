import { Divider } from "@/components/ui/divider";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { Image } from "expo-image";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

interface CircleItem {
  id: string;
  name: string;
  tag: string;
  imageUrl: string;
}

const CIRCLE_FILTER_TABS = ["已加入", "我创建的", "我申请的"];

const CIRCLES_BY_TAB: CircleItem[][] = [
  [
    {
      id: "joined-1",
      name: "奢品优选",
      tag: "自定义",
      imageUrl:
        "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=200",
    },
    {
      id: "joined-2",
      name: "奢饰品信息交互中心",
      tag: "私有",
      imageUrl:
        "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=200",
    },
  ],
  [
    {
      id: "created-1",
      name: "设计协作站",
      tag: "公开",
      imageUrl:
        "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=200",
    },
    {
      id: "created-2",
      name: "周末探店圈",
      tag: "自定义",
      imageUrl:
        "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=200",
    },
  ],
  [
    {
      id: "applied-1",
      name: "同城摄影社",
      tag: "审核中",
      imageUrl:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=200",
    },
  ],
];

const TAG_COLORS = {
  自定义: "#F5B318",
  私有: "#F5B318",
  公开: "#22C55E",
  审核中: "#3B82F6",
} as const;

export const MyCirclesPanel: React.FC = () => {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState(0);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: Spacing.lg,
        },
        headerRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        title: {
          color: colors.text,
          ...Typography.title,
        },
        createButton: {
          paddingHorizontal: Spacing.md,
          height: 32,
          borderRadius: Radius.full,
          backgroundColor: colors.surface,
          justifyContent: "center",
          alignItems: "center",
          borderWidth: 1,
          borderColor: colors.surfaceBorder,
        },
        createButtonText: {
          color: colors.primary,
          ...Typography.caption,
          fontWeight: "600",
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
          backgroundColor: colors.surfaceBorder,
        },
        body: {
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: Spacing.sm,
        },
        name: {
          color: colors.text,
          fontSize: 16,
          fontWeight: "600",
          flex: 1,
        },
        tag: {
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.xs,
          borderRadius: Radius.full,
        },
        tagText: {
          color: colors.white,
          ...Typography.small,
          fontWeight: "600",
        },
      }),
    [colors],
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>圈子详情</Text>
        <Pressable style={styles.createButton}>
          <Text style={styles.createButtonText}>创建圈子</Text>
        </Pressable>
      </View>

      <FilterTabs
        tabs={CIRCLE_FILTER_TABS}
        activeIndex={activeTab}
        onTabPress={setActiveTab}
      />

      <FlatList
        data={CIRCLES_BY_TAB[activeTab]}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item, index }) => (
          <View>
            <Pressable style={styles.row}>
              <Image source={{ uri: item.imageUrl }} style={styles.cover} />
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <View
                  style={[
                    styles.tag,
                    {
                      backgroundColor:
                        TAG_COLORS[item.tag as keyof typeof TAG_COLORS],
                    },
                  ]}
                >
                  <Text style={styles.tagText}>{item.tag}</Text>
                </View>
              </View>
            </Pressable>
            {index < CIRCLES_BY_TAB[activeTab].length - 1 ? <Divider /> : null}
          </View>
        )}
      />
    </View>
  );
};
