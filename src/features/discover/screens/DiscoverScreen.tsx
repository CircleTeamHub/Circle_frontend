import { Badge } from "@/components/ui/badge";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { MyCirclesPanel } from "@/features/discover/components/my-circles-panel";
import { MomentsFeed } from "@/features/discover/components/moments-feed";
import { PlazaFeed } from "@/features/discover/components/plaza-feed";
import { useTabBadgeStore } from "@/stores/tabBadgeStore";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const s = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerIcons: {
    flexDirection: "row",
    gap: Spacing.md,
    alignItems: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  managementContent: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    right: Spacing.lg,
    bottom: 110,
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    justifyContent: "center",
    alignItems: "center",
  },
  filterButton: {
    position: "relative",
  },
  notificationButton: {
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  notificationBadge: {
    position: "absolute",
    top: -8,
    right: -12,
  },
});

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0);
  const discoverUnread = useTabBadgeStore((state) => state.systemUnread);

  const FILTER_TABS = useMemo(
    () => [
      t('discover.plaza'),
      t('discover.management'),
      t('discover.moments'),
    ],
    [t],
  );

  const d = useMemo(
    () => ({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      title: {
        color: colors.text,
        ...Typography.title,
      },
      placeholderText: {
        color: colors.textSecondary,
        ...Typography.body,
      },
      fab: {
        backgroundColor: colors.primary,
      },
    }),
    [colors],
  );

  const handleFabPress = useCallback(() => {
    if (activeTab === 0) {
      router.push("/(tabs)/discover/create-post");
    } else if (activeTab === 2) {
      router.push("/(tabs)/discover/create-moment");
    }
  }, [activeTab, router]);

  const handleDiscoverCirclesPress = useCallback(() => {
    router.push("/(tabs)/discover/circles");
  }, [router]);

  const handleOpenNotifications = useCallback(() => {
    // Open the notification center inside the Discover (动态) stack so backing out
    // returns here, not to the messages/chat tab.
    router.push("/(tabs)/discover/notification-center" as Href);
  }, [router]);

  const handleFilterPress = useCallback(() => {
    router.push("/(tabs)/discover/filter");
  }, [router]);

  const handleSettingsPress = useCallback(() => {
    router.push("/(tabs)/discover/notifications");
  }, [router]);

  return (
    <View style={d.container}>
      {/* Fixed header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.md - 4, borderBottomColor: colors.divider }]}>
        <View style={s.headerRow}>
          <Text style={d.title}>{t('discover.title')}</Text>
          <View style={s.headerIcons}>
            <Pressable
              onPress={handleDiscoverCirclesPress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('discover.discoverCircles', {
                defaultValue: '发现圈子',
              })}
            >
              <Ionicons name="search-outline" size={22} color={colors.text} />
            </Pressable>
            <Pressable
              style={s.notificationButton}
              onPress={handleOpenNotifications}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('notifications.title')}
            >
              <Ionicons
                name="notifications-outline"
                size={22}
                color={colors.text}
              />
              <View style={s.notificationBadge}>
                <Badge count={discoverUnread} />
              </View>
            </Pressable>
            <Pressable
              onPress={handleFilterPress}
              hitSlop={8}
              style={s.filterButton}
            >
              <Ionicons
                name="options-outline"
                size={22}
                color={colors.text}
              />
            </Pressable>
            <Pressable onPress={handleSettingsPress} hitSlop={8}>
              <Ionicons
                name="settings-outline"
                size={22}
                color={colors.text}
              />
            </Pressable>
          </View>
        </View>

        <FilterTabs
          tabs={FILTER_TABS}
          activeIndex={activeTab}
          onTabPress={setActiveTab}
        />
      </View>

      {/* Tab content */}
      {activeTab === 0 ? (
        <View style={s.content}>
          <PlazaFeed />
        </View>
      ) : activeTab === 1 ? (
        <ScrollView style={s.managementContent} showsVerticalScrollIndicator={false}>
          <MyCirclesPanel />
        </ScrollView>
      ) : (
        <View style={s.content}>
          <MomentsFeed />
        </View>
      )}

      {/* FAB — 圈子广场 and 朋友圈 */}
      {activeTab === 0 || activeTab === 2 ? (
        <Pressable
          style={[s.fab, d.fab]}
          onPress={handleFabPress}
        >
          <Ionicons name="add" size={24} color={colors.white} />
        </Pressable>
      ) : null}
    </View>
  );
}
