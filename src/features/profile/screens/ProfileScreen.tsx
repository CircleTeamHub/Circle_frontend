import { Avatar } from "@/components/ui/avatar";
import { Divider } from "@/components/ui/divider";
import { MenuRow } from "@/components/ui/menu-row";
import { UserIconRow } from "@/components/ui/user-icon-row";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { fetchCurrentUser } from "@/services/api/auth";
import { fetchIconOptions } from "@/services/api/icons";
import { markProfileNotificationsRead } from "@/services/api/notifications";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import type { DisplayIcon, MenuItem } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useTabBadgeStore } from "@/stores/tabBadgeStore";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, type TextStyle, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MENU_ITEM_KEYS: {
  id: string;
  icon: string;
  labelKey: string;
  rightTextKey?: string;
}[] = [
  { id: "2", icon: "gift-outline", labelKey: "profile.memberCenter", rightTextKey: "profile.viewMember" },
  { id: "3", icon: "wallet-outline", labelKey: "profile.wallet" },
  { id: "5", icon: "hand-left-outline", labelKey: "profile.mall", rightTextKey: "profile.viewProducts" },
  { id: "6", icon: "bookmark-outline", labelKey: "profile.collections", rightTextKey: "profile.viewCollections" },
  { id: "7", icon: "document-text-outline", labelKey: "profile.notes", rightTextKey: "profile.viewNotes" },
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
    gap: Spacing.sm,
  },
  memberStats: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  memberCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  memberStat: {
    flex: 1,
    borderRadius: Radius.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    gap: 4,
  },
  memberIdentityRow: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingTop: Spacing.xs,
    alignItems: "center",
  },
  memberIdentityItem: {
    alignItems: "center",
    gap: 6,
  },
  memberIdentityEmpty: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  memberIdentityCircle: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, resolvedMode, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const setProfileUnread = useTabBadgeStore((state) => state.setProfileUnread);
  const [profileDisplayIcons, setProfileDisplayIcons] = useState<DisplayIcon[]>(
    user?.displayIcons ?? [],
  );

  const MENU_ITEMS: MenuItem[] = MENU_ITEM_KEYS.map((m) => ({
    id: m.id,
    icon: m.icon,
    label: t(m.labelKey),
    rightText: m.rightTextKey ? t(m.rightTextKey) : undefined,
  }));

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      profileName: { color: colors.text, ...Typography.h2 },
      profileAccount: { color: colors.textSecondary, ...Typography.small },
      profileActionLabel: { color: colors.textSecondary, ...Typography.tiny },
      memberCard: {
        backgroundColor: colors.memberCardBg,
      },
      memberStat: {
        backgroundColor: colors.memberTagBgLight,
      },
      memberStatLabel: {
        color: colors.memberCardText,
        ...Typography.tiny,
        opacity: 0.72,
      },
      memberStatValue: {
        color: colors.memberCardText,
        fontSize: 20,
        fontWeight: "700" as const,
        fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
      },
      memberIdentityCircle: {
        backgroundColor: colors.memberTagBgLight,
      },
      memberIdentityLabel: {
        color: colors.memberCardText,
        ...Typography.tiny,
        fontWeight: "700" as const,
      },
      memberIdentityHint: {
        color: colors.memberCardText,
        ...Typography.small,
        fontWeight: "600" as const,
      },
      memberCardAction: {
        color: colors.memberCardText,
        ...Typography.tiny,
        fontWeight: "700" as const,
        opacity: 0.8,
      },
    }),
    [colors],
  );

  const isDark = resolvedMode === "dark";
  const displayName = user?.nickname || user?.accountId || t('profile.notLoggedIn');
  const displayAccount = user?.accountId || t('profile.notBound');
  const vipLevel = user?.vipLevel ?? 0;
  const creditScore = user?.creditScore ?? 0;
  const displayIcons = profileDisplayIcons.length > 0 ? profileDisplayIcons : user?.displayIcons ?? [];

  useEffect(() => {
    setProfileDisplayIcons(user?.displayIcons ?? []);
  }, [user?.displayIcons]);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return undefined;
      }

      let isActive = true;

      const refreshCurrentUser = async () => {
        try {
          const [nextUser, nextIcons] = await Promise.all([
            fetchCurrentUser(),
            fetchIconOptions(),
          ]);
          if (isActive) {
            setUser(nextUser);
            setProfileDisplayIcons(nextIcons.displayIcons);
          }
          await markProfileNotificationsRead();
          if (isActive) {
            setProfileUnread(0);
          }
        } catch (error) {
          console.warn(
            '[profile] failed to refresh current user',
            error instanceof Error ? error.message : error,
          );
        }
      };

      refreshCurrentUser();

      return () => {
        isActive = false;
      };
    }, [setProfileUnread, setUser, user?.id]),
  );

  const handleOpenShare = useCallback(() => {
    router.push("/(tabs)/profile/share");
  }, [router]);

  const handleOpenSettings = useCallback(() => {
    router.push("/(tabs)/profile/settings");
  }, [router]);

  const handleOpenIcons = useCallback(() => {
    router.push('/(tabs)/profile/icons' as never);
  }, [router]);

  const handleMenuPress = useCallback(
    (item: MenuItem) => {
      if (item.id === '2') {
        router.push('/(tabs)/profile/member-center' as never);
        return;
      }

      if (item.id === '3') {
        router.push('/(tabs)/profile/wallet' as never);
        return;
      }

      if (item.id === '5') {
        router.push('/(tabs)/profile/mall' as never);
        return;
      }

      if (item.id === '6') {
        router.push('/(tabs)/profile/collections' as never);
        return;
      }

      if (item.id === '7') {
        router.push('/(tabs)/profile/notes' as never);
      }
    },
    [router],
  );

  const renderMenuItem = useCallback(
    ({ item, index }: { item: MenuItem; index: number }) => (
      <View>
        <MenuRow
          icon={item.icon as keyof typeof Ionicons.glyphMap}
          label={item.label}
          rightText={item.rightText}
          onPress={() => handleMenuPress(item)}
        />
        {index < MENU_ITEMS.length - 1 ? <Divider /> : null}
      </View>
    ),
    [handleMenuPress],
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
            <Text style={d.profileAccount}>{t('contacts.accountId', { id: displayAccount })}</Text>
          </View>
        </View>
        <View style={s.profileRight}>
          <Pressable style={s.profileAction} onPress={handleOpenShare}>
            <Ionicons
              name="share-social-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text style={d.profileActionLabel}>{t('profile.share')}</Text>
          </Pressable>
          <Pressable style={s.profileAction} onPress={toggleTheme}>
            <Ionicons
              name={isDark ? "sunny-outline" : "moon-outline"}
              size={20}
              color={colors.textSecondary}
            />
            <Text style={d.profileActionLabel}>
              {isDark ? t('profile.lightMode') : t('profile.darkMode')}
            </Text>
          </Pressable>
          <Pressable style={s.profileAction} onPress={handleOpenSettings}>
            <Ionicons
              name="settings-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text style={d.profileActionLabel}>{t('profile.settings')}</Text>
          </Pressable>
        </View>
      </View>

      {/* Member card */}
      <Pressable style={[s.memberCard, d.memberCard]} onPress={handleOpenIcons}>
        <View style={s.memberCardHeader}>
          <Text style={d.memberCardAction}>我的图标</Text>
          <Ionicons name="chevron-forward-outline" size={18} color={colors.memberCardText} />
        </View>
        <View style={s.memberStats}>
          <View style={[s.memberStat, d.memberStat]}>
            <Text style={d.memberStatLabel}>{t('profile.vipLevel')}</Text>
            <Text style={d.memberStatValue}>VIP {vipLevel}</Text>
          </View>
          <View style={[s.memberStat, d.memberStat]}>
            <Text style={d.memberStatLabel}>{t('profile.reputationValue')}</Text>
            <Text style={d.memberStatValue}>{creditScore}</Text>
          </View>
        </View>
        <View style={s.memberIdentityRow}>
          {displayIcons.length > 0 ? (
            <View style={s.memberIdentityItem}>
              <UserIconRow icons={displayIcons} />
            </View>
          ) : (
            <View style={s.memberIdentityEmpty}>
              <View style={[s.memberIdentityCircle, d.memberIdentityCircle]}>
                <Ionicons name="add-outline" size={20} color={colors.memberCardText} />
              </View>
              <Text style={d.memberIdentityHint}>添加图标</Text>
            </View>
          )}
        </View>
      </Pressable>

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
