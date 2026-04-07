import { Avatar } from "@/components/ui/avatar";
import { Divider } from "@/components/ui/divider";
import { MenuRow } from "@/components/ui/menu-row";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { MenuItem } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
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

const s = StyleSheet.create({
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
  profileRight: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "center",
  },
  profileAction: { alignItems: "center", gap: Spacing.xs },
  memberCard: {
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
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: 10,
  },
  memberTagLight: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: 10,
  },
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
  },
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, resolvedMode, toggleTheme } = useTheme();
  const user = useAuthStore((state) => state.user);

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      profileName: { color: colors.text, ...Typography.h2 },
      profileAccount: { color: colors.textSecondary, ...Typography.small },
      profileActionLabel: { color: colors.textSecondary, ...Typography.tiny },
      memberCard: {
        backgroundColor: colors.memberCardBg,
      },
      memberTag: {
        backgroundColor: colors.memberTagBg,
      },
      memberTagLight: {
        backgroundColor: colors.memberTagBgLight,
      },
      memberTagText: {
        color: colors.memberCardText,
        ...Typography.small,
        fontWeight: "500" as const,
      },
      memberText: { color: colors.memberCardText, fontSize: 14 },
      greenBadge: {
        backgroundColor: colors.success,
      },
    }),
    [colors],
  );

  const isDark = resolvedMode === "dark";
  const displayName = user?.nickname || user?.username || "未登录用户";
  const displayAccount = user?.accountId || user?.username || "未绑定";
  const membershipTag = user?.role === "ADMIN" ? "管理员" : "普通用户";
  const profileSignature =
    user?.helloWords || user?.persona || "完善资料后会在这里展示你的介绍。";

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
    <View style={s.listHeader}>
      {/* Profile header */}
      <View style={s.profileRow}>
        <View style={s.profileLeft}>
          <Pressable
            onPress={() =>
              router.push(
                getUserProfileHref("profile", user?.id ?? "me", displayName),
              )
            }
          >
            <Avatar
              size={56}
              name={displayName}
              uri={user?.avatarUrl ?? undefined}
              bgColor={colors.surface}
            />
          </Pressable>
          <View style={s.profileInfo}>
            <Text style={d.profileName}>{displayName}</Text>
            <Text style={d.profileAccount}>账号：{displayAccount}</Text>
          </View>
        </View>
        <View style={s.profileRight}>
          <Pressable style={s.profileAction} onPress={handleOpenShare}>
            <Ionicons
              name="share-social-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text style={d.profileActionLabel}>分享</Text>
          </Pressable>
          <Pressable style={s.profileAction} onPress={toggleTheme}>
            <Ionicons
              name={isDark ? "sunny-outline" : "moon-outline"}
              size={20}
              color={colors.textSecondary}
            />
            <Text style={d.profileActionLabel}>
              {isDark ? "浅色" : "深色"}
            </Text>
          </Pressable>
          <Pressable style={s.profileAction} onPress={handleOpenSettings}>
            <Ionicons
              name="settings-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text style={d.profileActionLabel}>设置</Text>
          </Pressable>
        </View>
      </View>

      {/* Member card */}
      <View style={[s.memberCard, d.memberCard]}>
        <View style={s.memberTags}>
          <View style={[s.memberTag, d.memberTag]}>
            <Text style={d.memberTagText}>{membershipTag}</Text>
          </View>
          <View style={[s.memberTagLight, d.memberTagLight]}>
            <Text style={d.memberTagText}>
              {user?.status === "ACTIVE" ? "账号正常" : user?.status ?? "状态未知"}
            </Text>
          </View>
        </View>
        <Text style={d.memberText}>{profileSignature}</Text>
        <Text style={d.memberText}>
          {user?.email || user?.phoneNumber || "可在账号设置中完善联系方式"}
        </Text>
      </View>

      {/* Badge row */}
      <View style={s.badgeRow}>
        <View style={[s.greenBadge, d.greenBadge]} />
      </View>

      <Divider />
    </View>
  );

  return (
    <View style={d.container}>
      <FlatList
        data={MENU_ITEMS}
        renderItem={renderMenuItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[
          s.listContent,
          { paddingTop: insets.top + Spacing.md - 4 },
        ]}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
