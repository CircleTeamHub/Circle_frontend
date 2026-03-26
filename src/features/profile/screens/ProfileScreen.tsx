import { Avatar } from "@/components/ui/avatar";
import { Divider } from "@/components/ui/divider";
import { MenuRow } from "@/components/ui/menu-row";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { MenuItem } from "@/types";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MENU_ITEMS: MenuItem[] = [
  { id: "1", icon: "shield-checkmark-outline", label: "信用值" },
  { id: "2", icon: "gift-outline", label: "会员中心", rightText: "查看会员" },
  { id: "3", icon: "wallet-outline", label: "我的钱包" },
  {
    id: "4",
    icon: "chatbubble-ellipses-outline",
    label: "管家助手",
    rightText: "用户满写",
  },
  {
    id: "5",
    icon: "hand-left-outline",
    label: "商城",
    rightText: "查看商品",
  },
  {
    id: "6",
    icon: "bookmark-outline",
    label: "我的收藏",
    rightText: "查看收藏",
  },
  {
    id: "7",
    icon: "document-text-outline",
    label: "我的笔记",
    rightText: "查看笔记",
  },
];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, resolvedMode, toggleTheme } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        listContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
        listHeader: { gap: Spacing.sm },
        profileRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingVertical: Spacing.xs,
        },
        profileLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: Spacing.md - 4,
        },
        profileInfo: { gap: Spacing.xs },
        profileName: { color: colors.text, ...Typography.h2 },
        profileAccount: { color: colors.textSecondary, ...Typography.small },
        profileRight: {
          flexDirection: "row",
          gap: Spacing.md,
          alignItems: "center",
        },
        profileAction: { alignItems: "center", gap: Spacing.xs },
        profileActionLabel: { color: colors.textSecondary, ...Typography.tiny },
        memberCard: {
          backgroundColor: colors.memberCardBg,
          borderRadius: Radius.lg,
          padding: Spacing.md,
          gap: 6,
        },
        memberTags: {
          flexDirection: "row",
          gap: Spacing.sm,
          alignItems: "center",
        },
        memberTag: {
          backgroundColor: colors.memberTagBg,
          borderRadius: Radius.md,
          paddingVertical: Spacing.xs,
          paddingHorizontal: 10,
        },
        memberTagLight: {
          backgroundColor: colors.memberTagBgLight,
          borderRadius: Radius.md,
          paddingVertical: Spacing.xs,
          paddingHorizontal: 10,
        },
        memberTagText: {
          color: colors.memberCardText,
          ...Typography.small,
          fontWeight: "500",
        },
        memberText: { color: colors.memberCardText, fontSize: 14 },
        badgeRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: Spacing.sm,
        },
        greenBadge: {
          width: 32,
          height: 32,
          borderRadius: Spacing.md,
          backgroundColor: colors.success,
        },
      }),
    [colors],
  );

  const isDark = resolvedMode === "dark";

  const handleOpenShare = useCallback(() => {
    router.push("/(tabs)/profile/share");
  }, [router]);

  const handleOpenSettings = useCallback(() => {
    router.push("/(tabs)/profile/settings");
  }, [router]);

  const renderMenuItem = useCallback(
    ({ item, index }: { item: MenuItem; index: number }) => (
      <View>
        <MenuRow
          icon={item.icon as keyof typeof Ionicons.glyphMap}
          label={item.label}
          rightText={item.rightText}
        />
        {index < MENU_ITEMS.length - 1 ? <Divider /> : null}
      </View>
    ),
    [],
  );

  const keyExtractor = useCallback((item: MenuItem) => item.id, []);

  const ListHeader = (
    <View style={styles.listHeader}>
      {/* Profile header */}
      <View style={styles.profileRow}>
        <View style={styles.profileLeft}>
          <Pressable
            onPress={() => router.push(getUserProfileHref("profile", "me", "ddddd"))}
          >
            <Avatar size={56} name="🐱" bgColor={colors.surface} />
          </Pressable>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>ddddd</Text>
            <Text style={styles.profileAccount}>账号：134273011l</Text>
          </View>
        </View>
        <View style={styles.profileRight}>
          <Pressable style={styles.profileAction} onPress={handleOpenShare}>
            <Ionicons
              name="share-social-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text style={styles.profileActionLabel}>分享</Text>
          </Pressable>
          <Pressable style={styles.profileAction} onPress={toggleTheme}>
            <Ionicons
              name={isDark ? "sunny-outline" : "moon-outline"}
              size={20}
              color={colors.textSecondary}
            />
            <Text style={styles.profileActionLabel}>
              {isDark ? "浅色" : "深色"}
            </Text>
          </Pressable>
          <Pressable style={styles.profileAction} onPress={handleOpenSettings}>
            <Ionicons
              name="settings-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text style={styles.profileActionLabel}>设置</Text>
          </Pressable>
        </View>
      </View>

      {/* Member card */}
      <View style={styles.memberCard}>
        <View style={styles.memberTags}>
          <View style={styles.memberTag}>
            <Text style={styles.memberTagText}>普通用户</Text>
          </View>
          <View style={styles.memberTagLight}>
            <Text style={styles.memberTagText}>一年购 入门会员</Text>
          </View>
        </View>
        <Text style={styles.memberText}>普通用户经验值不会增长</Text>
        <Text style={styles.memberText}>开通会员，至尊对应等级权益</Text>
      </View>

      {/* Badge row */}
      <View style={styles.badgeRow}>
        <View style={styles.greenBadge} />
      </View>

      <Divider />
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={MENU_ITEMS}
        renderItem={renderMenuItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + Spacing.md - 4 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
