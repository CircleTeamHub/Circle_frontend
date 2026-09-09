import { Avatar } from "@/components/ui/avatar";
import { GradientCover } from "@/components/ui/gradient-cover";
import { MemberName } from "@/components/ui/member-name";
import { UserIconRow } from "@/components/ui/user-icon-row";
import { FEATURE_FLAGS } from "@/constants/feature-flags";
import {
  getCreditStatBackground,
  getCreditStatTextColor,
  getVipStatBackground,
  getVipStatTextColor,
} from "@/features/profile/member-stat-colors";
import {
  getMembershipTierForVipLevel,
  type MembershipTier,
} from "@/features/profile/membership-plans";
import { getAvatarFrameSource } from "@/features/profile/membership-frames";
import { getUserProfileHref } from "@/features/user/utils/routes";
import { fetchCurrentUser } from "@/services/api/auth";
import { fetchIconOptions } from "@/services/api/icons";
import { Gradients, Radius, Spacing, Typography, iconForeground, useTheme, withAlpha } from "@/theme";
import type { DisplayIcon, MenuItem } from "@/types";
import { useAuthStore } from "@/stores/authStore";
import { useTabBadgeStore } from "@/stores/tabBadgeStore";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, type TextStyle, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { E2E_TEST_IDS } from "@/testing/e2e-test-ids";
import { reportHandledFailure } from '@/observability/report-failure';

const MENU_ID = {
  SYSTEM_ANNOUNCEMENTS: "system-announcements",
  MEMBER_CENTER: "member-center",
  WALLET: "wallet",
  COLLECTIONS: "collections",
  NOTES: "notes",
  CUSTOMER_SERVICE: "customer-service",
} as const;

type MenuId = (typeof MENU_ID)[keyof typeof MENU_ID];
type ProfileMenuItem = MenuItem & { accent: string };

const DEFAULT_MEMBERSHIP_NAMES: Record<MembershipTier, string> = {
  silver: "包月会员",
  gold: "半年会员",
  diamond: "年费会员",
  super: "永久会员",
};

const MENU_ROUTE: Record<MenuId, string> = {
  [MENU_ID.SYSTEM_ANNOUNCEMENTS]: "/(tabs)/profile/system-announcements",
  [MENU_ID.MEMBER_CENTER]: "/(tabs)/profile/member-center",
  [MENU_ID.WALLET]: "/(tabs)/profile/wallet",
  [MENU_ID.COLLECTIONS]: "/(tabs)/profile/collections",
  [MENU_ID.NOTES]: "/(tabs)/profile/notes",
  [MENU_ID.CUSTOMER_SERVICE]: "/(tabs)/profile/customer-service",
};

const MENU_ITEM_KEYS: {
  id: MenuId;
  icon: string;
  labelKey: string;
  accent: string;
}[] = [
  { id: MENU_ID.SYSTEM_ANNOUNCEMENTS, icon: "newspaper-outline", labelKey: "profile.systemAnnouncements", accent: "#D97732" },
  { id: MENU_ID.MEMBER_CENTER, icon: "gift-outline", labelKey: "profile.memberCenter", accent: "#8B5CF6" },
  { id: MENU_ID.WALLET, icon: "wallet-outline", labelKey: "profile.wallet.menuLabel", accent: "#387BE5" },
  { id: MENU_ID.COLLECTIONS, icon: "bookmark-outline", labelKey: "profile.collections.menuLabel", accent: "#D95688" },
  { id: MENU_ID.NOTES, icon: "document-text-outline", labelKey: "profile.notes", accent: "#6366F1" },
  { id: MENU_ID.CUSTOMER_SERVICE, icon: "headset-outline", labelKey: "profile.customerService.menuLabel", accent: "#168C91" },
];

const s = StyleSheet.create({
  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
  listHeader: { gap: Spacing.sm, marginBottom: Spacing.lg },
  menuRow: { gap: 12, marginBottom: 12 },
  menuTile: {
    flex: 1,
    minWidth: 0,
    minHeight: 124,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderRadius: Radius.xl,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  menuTilePressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  menuIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: { ...Typography.bodyRegular, fontWeight: "500", textAlign: "center" },
  menuUnreadDot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
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
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  profileRight: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "center",
  },
  profileAction: { alignItems: "center", gap: Spacing.xs },
  memberCard: {
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md - 4,
    overflow: "hidden",
  },
  memberCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  memberHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  memberStatsPanel: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
  memberStatCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 9,
    overflow: "hidden",
  },
  memberIdentityRow: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingTop: 2,
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
  const profileUnread = useTabBadgeStore((state) => state.profileUnread);
  const [profileDisplayIcons, setProfileDisplayIcons] = useState<DisplayIcon[]>(
    user?.displayIcons ?? [],
  );
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef(false);
  const lastRefreshRef = useRef(0);

  const MENU_ITEMS: ProfileMenuItem[] = MENU_ITEM_KEYS.map((m) => ({
    id: m.id,
    icon: m.icon,
    label: t(m.labelKey),
    accent: m.accent,
  }));

  const d = useMemo(
    () => ({
      container: { flex: 1, backgroundColor: colors.background },
      profileName: { color: colors.text, ...Typography.h2 },
      profileAccount: { color: colors.textSecondary, ...Typography.small },
      profileActionLabel: { color: colors.text, ...Typography.tiny },
      memberCard: {
        // 渐变由 GradientCover 铺底，这里只作 SVG 挂载前的兜底色
        backgroundColor: "#6E5CF0",
      },
      memberStat: {
        borderColor: "rgba(255, 255, 255, 0.18)",
      },
      memberStatLabel: {
        color: colors.white,
        ...Typography.tiny,
        opacity: 0.78,
      },
      memberStatValue: {
        color: colors.white,
        fontSize: 22,
        fontWeight: "700" as const,
        fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
      },
      memberIdentityCircle: {
        backgroundColor: colors.memberTagBg,
      },
      memberIdentityLabel: {
        color: colors.white,
        ...Typography.tiny,
        fontWeight: "700" as const,
      },
      memberIdentityHint: {
        color: colors.white,
        ...Typography.small,
        fontWeight: "600" as const,
      },
      memberCardAction: {
        color: colors.white,
        ...Typography.caption,
        fontWeight: "700" as const,
      },
    }),
    [colors],
  );

  const isDark = resolvedMode === "dark";
  const displayAccountId =
    FEATURE_FLAGS.fancyNumbers && user?.fancyNumber && user.accountId
      ? user.accountId.toUpperCase()
      : user?.accountId;
  const displayName =
    user?.nickname || displayAccountId || t('profile.notLoggedIn');
  const displayAccount = displayAccountId || t('profile.notBound');
  const vipLevel = user?.vipLevel ?? 0;
  const membershipTier = getMembershipTierForVipLevel(vipLevel);
  const membershipLabel = membershipTier
    ? t(`profile.membership.tiers.${membershipTier}.name`, {
        defaultValue: DEFAULT_MEMBERSHIP_NAMES[membershipTier],
      })
    : t('profile.membership.regularUser', { defaultValue: '普通用户' });
  const creditScore = user?.creditScore ?? 0;
  const vipStatBackground = getVipStatBackground(vipLevel);
  const creditStatBackground = getCreditStatBackground(creditScore);
  const vipStatTextColor = getVipStatTextColor();
  const creditStatTextColor = getCreditStatTextColor();
  const displayIcons = profileDisplayIcons.length > 0 ? profileDisplayIcons : user?.displayIcons ?? [];

  useEffect(() => {
    setProfileDisplayIcons(user?.displayIcons ?? []);
  }, [user?.displayIcons]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const refreshCurrentUser = useCallback(
    async (options?: { force?: boolean; isActive?: () => boolean }) => {
      if (!user) {
        return;
      }

      const now = Date.now();
      if (!options?.force && now - lastRefreshRef.current < 10_000) {
        return;
      }
      lastRefreshRef.current = now;

      const isActive = options?.isActive ?? (() => true);
      try {
        const [nextUser, nextIcons] = await Promise.all([
          fetchCurrentUser(),
          fetchIconOptions(),
        ]);
        if (isActive()) {
          setUser({
            ...nextUser,
            displayIcons: nextIcons.displayIcons,
          });
          setProfileDisplayIcons(nextIcons.displayIcons);
        }
      } catch (error) {
        // Best-effort refresh; keep existing state on failure. Surface in dev so
        // a broken /auth/me + notifications round-trip doesn't pass silently.
        reportHandledFailure('profile', 'refreshCurrentUser', error);
      }
    },
    [setUser, user],
  );

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      void refreshCurrentUser({ isActive: () => isActive });

      return () => {
        isActive = false;
      };
    }, [refreshCurrentUser]),
  );

  const handleRefreshProfile = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setRefreshing(true);
    try {
      await refreshCurrentUser({ force: true, isActive: () => mountedRef.current });
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, [refreshCurrentUser]);

  const handleOpenShare = useCallback(() => {
    router.push("/(tabs)/profile/share");
  }, [router]);

  // 我的二维码(名片):微信同款,账号行右侧的小码图标进入。
  const handleOpenMyQr = useCallback(() => {
    router.push({ pathname: "/qr-code", params: { type: "user" } });
  }, [router]);

  const handleOpenSettings = useCallback(() => {
    router.push("/(tabs)/profile/app-settings");
  }, [router]);

  const handleOpenMemberCenter = useCallback(() => {
    router.push("/(tabs)/profile/member-center" as never);
  }, [router]);

  const handleOpenCreditScore = useCallback(() => {
    router.push("/(tabs)/profile/credit-score" as never);
  }, [router]);

  const handleOpenDecorations = useCallback(() => {
    router.push('/(tabs)/profile/decorations' as never);
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
    ({ item }: { item: ProfileMenuItem }) => {
      const tint = iconForeground(item.accent, resolvedMode);
      const hasUnread = item.id === MENU_ID.SYSTEM_ANNOUNCEMENTS && profileUnread > 0;

      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityHint={hasUnread ? t('messages.unread') : undefined}
          onPress={() => handleMenuPress(item)}
          style={({ pressed }) => [
            s.menuTile,
            { backgroundColor: colors.surface, borderColor: withAlpha(colors.text, 0.06) },
            pressed && s.menuTilePressed,
          ]}
        >
          <View style={[s.menuIcon, { backgroundColor: withAlpha(tint, isDark ? 0.16 : 0.1) }]}>
            <Ionicons
              name={item.icon as keyof typeof Ionicons.glyphMap}
              size={28}
              color={tint}
            />
            {hasUnread ? (
              <View style={[s.menuUnreadDot, { backgroundColor: colors.error, borderColor: colors.surface }]} />
            ) : null}
          </View>
          <Text style={[s.menuLabel, { color: colors.text }]}>{item.label}</Text>
        </Pressable>
      );
    },
    [colors, handleMenuPress, isDark, profileUnread, resolvedMode, t],
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
              shape="circle"
              compactFrame
              frameSource={getAvatarFrameSource(user?.avatarFrameAppearance) ?? undefined}
            />
          </Pressable>
          <View style={s.profileInfo}>
            <MemberName
              name={displayName}
              vipLevel={vipLevel}
              style={d.profileName}
            />
            <Pressable
              style={s.accountRow}
              onPress={handleOpenMyQr}
              accessibilityRole="button"
              accessibilityLabel={t('qr.userTitle')}
            >
              <Text style={d.profileAccount}>{t('contacts.accountId', { id: displayAccount })}</Text>
              <Ionicons name="qr-code-outline" size={14} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>
        <View style={s.profileRight}>
          <Pressable style={s.profileAction} onPress={handleOpenShare}>
            <Ionicons
              name="share-social-outline"
              size={20}
              color={colors.text}
            />
            <Text style={d.profileActionLabel}>{t('profile.share')}</Text>
          </Pressable>
          <Pressable style={s.profileAction} onPress={toggleTheme}>
            <Ionicons
              name={isDark ? "sunny-outline" : "moon-outline"}
              size={20}
              color={colors.text}
            />
            <Text style={d.profileActionLabel}>
              {isDark ? t('profile.lightMode') : t('profile.darkMode')}
            </Text>
          </Pressable>
          <Pressable
            testID={E2E_TEST_IDS.profileSettings}
            style={s.profileAction}
            onPress={handleOpenSettings}
          >
            <Ionicons
              name="settings-outline"
              size={20}
              color={colors.text}
            />
            <Text style={d.profileActionLabel}>{t('profile.settings')}</Text>
          </Pressable>
        </View>
      </View>

      {/* Member card */}
      <View style={[s.memberCard, d.memberCard]}>
        <GradientCover colors={Gradients.memberCard} />
        <View style={s.memberStatsPanel}>
          <Pressable
            accessibilityRole="button"
            onPress={handleOpenMemberCenter}
            style={[s.memberStatCell, d.memberStat, { backgroundColor: vipStatBackground }]}
          >
            <Text style={[d.memberStatLabel, { color: vipStatTextColor }]}>{t('profile.vipLevel')}</Text>
            <Text
              style={[d.memberStatValue, { color: vipStatTextColor }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {membershipLabel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleOpenCreditScore}
            style={[s.memberStatCell, d.memberStat, { backgroundColor: creditStatBackground }]}
          >
            <Text style={[d.memberStatLabel, { color: creditStatTextColor }]}>{t('profile.reputationValue')}</Text>
            <Text style={[d.memberStatValue, { color: creditStatTextColor }]}>{creditScore}</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.myDecorations')}
          accessibilityHint={t('profile.decorations.openHint')}
          style={s.memberCardHeader}
          onPress={handleOpenDecorations}
        >
          <View style={s.memberHeaderLeft}>
            <Ionicons name="sparkles" size={15} color={colors.white} />
            <Text style={d.memberCardAction}>
              {t('profile.myDecorations', { defaultValue: '我的装扮' })}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color="rgba(255, 255, 255, 0.85)"
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.myDecorations')}
          accessibilityHint={t('profile.decorations.openHint')}
          style={s.memberIdentityRow}
          onPress={handleOpenDecorations}
        >
          {displayIcons.length > 0 ? (
            <View style={s.memberIdentityItem}>
              <UserIconRow icons={displayIcons} tone="member" />
            </View>
          ) : (
            <View style={s.memberIdentityEmpty}>
              <View style={[s.memberIdentityCircle, d.memberIdentityCircle]}>
                <Ionicons name="add-outline" size={20} color={colors.white} />
              </View>
              <Text style={d.memberIdentityHint}>
                {t('profile.addIcon', { defaultValue: '添加徽章' })}
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <View testID={E2E_TEST_IDS.profileScreen} style={d.container}>
      <FlatList
        data={MENU_ITEMS}
        numColumns={3}
        columnWrapperStyle={s.menuRow}
        renderItem={renderMenuItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={[
          s.listContent,
          { paddingTop: insets.top + Spacing.md - 4 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={handleRefreshProfile}
      />
    </View>
  );
}
