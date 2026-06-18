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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, type TextStyle, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MENU_ID = {
  SYSTEM_ANNOUNCEMENTS: "system-announcements",
  MEMBER_CENTER: "member-center",
  WALLET: "wallet",
  MALL: "mall",
  COLLECTIONS: "collections",
  NOTES: "notes",
  APP_SETTINGS: "app-settings",
} as const;

type MenuId = (typeof MENU_ID)[keyof typeof MENU_ID];

const MENU_ROUTE: Record<MenuId, string> = {
  [MENU_ID.SYSTEM_ANNOUNCEMENTS]: "/(tabs)/profile/system-announcements",
  [MENU_ID.MEMBER_CENTER]: "/(tabs)/profile/member-center",
  [MENU_ID.WALLET]: "/(tabs)/profile/wallet",
  [MENU_ID.MALL]: "/(tabs)/profile/mall",
  [MENU_ID.COLLECTIONS]: "/(tabs)/profile/collections",
  [MENU_ID.NOTES]: "/(tabs)/profile/notes",
  [MENU_ID.APP_SETTINGS]: "/(tabs)/profile/app-settings",
};

const MENU_ITEM_KEYS: {
  id: MenuId;
  icon: string;
  labelKey: string;
  rightTextKey?: string;
}[] = [
  { id: MENU_ID.SYSTEM_ANNOUNCEMENTS, icon: "megaphone-outline", labelKey: "profile.systemAnnouncements", rightTextKey: "profile.viewAnnouncements" },
  { id: MENU_ID.MEMBER_CENTER, icon: "gift-outline", labelKey: "profile.memberCenter", rightTextKey: "profile.viewMember" },
  { id: MENU_ID.WALLET, icon: "wallet-outline", labelKey: "profile.wallet" },
  { id: MENU_ID.MALL, icon: "hand-left-outline", labelKey: "profile.mall", rightTextKey: "profile.viewProducts" },
  { id: MENU_ID.COLLECTIONS, icon: "bookmark-outline", labelKey: "profile.collections", rightTextKey: "profile.viewCollections" },
  { id: MENU_ID.NOTES, icon: "document-text-outline", labelKey: "profile.notes", rightTextKey: "profile.viewNotes" },
  { id: MENU_ID.APP_SETTINGS, icon: "settings-outline", labelKey: "profile.settings" },
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
  const lastRefreshRef = useRef(0);

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

      const now = Date.now();
      if (now - lastRefreshRef.current < 10_000) {
        return undefined;
      }
      lastRefreshRef.current = now;

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
          // Best-effort refresh; keep existing state on failure. Surface in dev so
          // a broken /auth/me + notifications round-trip doesn't pass silently.
          if (__DEV__) {
            console.warn('[ProfileScreen] refreshCurrentUser failed', error);
          }
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
    router.push("/(tabs)/profile/app-settings");
  }, [router]);

  const handleOpenIcons = useCallback(() => {
    router.push('/(tabs)/profile/icons' as never);
  }, [router]);

  const handleMenuPress = useCallback(
    (item: MenuItem) => {
      const route = MENU_ROUTE[item.id as MenuId];
      if (route) {
        router.push(route as never);
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
          <Text style={d.memberCardAction}>
            {t('profile.myIcons', { defaultValue: '我的图标' })}
          </Text>
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
              <UserIconRow icons={displayIcons} tone="member" />
            </View>
          ) : (
            <View style={s.memberIdentityEmpty}>
              <View style={[s.memberIdentityCircle, d.memberIdentityCircle]}>
                <Ionicons name="add-outline" size={20} color={colors.memberCardText} />
              </View>
              <Text style={d.memberIdentityHint}>
                {t('profile.addIcon', { defaultValue: '添加图标' })}
              </Text>
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
