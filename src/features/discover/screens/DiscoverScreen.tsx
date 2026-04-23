import { FilterTabs } from "@/components/ui/filter-tabs";
import { MyCirclesPanel } from "@/features/discover/components/my-circles-panel";
import { MomentsFeed } from "@/features/discover/components/moments-feed";
import { PlazaFeed } from "@/features/discover/components/plaza-feed";
import { Radius, Spacing, Typography, useTheme } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
});

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0);

  const FILTER_TABS = [t('discover.plaza'), t('discover.management'), t('discover.moments')];

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

  return (
    <View style={d.container}>
      {/* Fixed header */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.md - 4, borderBottomColor: colors.divider }]}>
        <View style={s.headerRow}>
          <Text style={d.title}>{t('discover.title')}</Text>
          <View style={s.headerIcons}>
            <Pressable>
              <Ionicons name="options-outline" size={22} color={colors.text} />
            </Pressable>
            <Pressable>
              <Ionicons
                name="settings-outline"
                size={22}
                color={colors.textSecondary}
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
