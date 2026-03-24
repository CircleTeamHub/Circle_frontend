import { NavHeader } from "@/components/ui/nav-header";
import { NOTIFICATION_CATEGORIES } from "@/features/messages/data/notifications";
import { Spacing, Typography, useTheme } from "@/theme";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        content: {
          paddingHorizontal: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.xl,
          gap: Spacing.xl,
        },
        cardRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: Spacing.md,
          paddingTop: Spacing.md,
        },
        cardButton: {
          flex: 1,
          alignItems: "center",
          gap: Spacing.md,
        },
        iconBox: {
          width: 35,
          height: 35,
          borderRadius: 32,
          justifyContent: "center",
          alignItems: "center",
        },
        cardTitle: {
          color: colors.text,
          ...Typography.h1,
        },
        cardsOnly: {
          paddingTop: Spacing.md,
        },
      }),
    [colors, insets.bottom],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <NavHeader title="动态通知" />
      <View style={styles.content}>
        <View style={[styles.cardRow, styles.cardsOnly]}>
          {NOTIFICATION_CATEGORIES.map((category) => (
            <Pressable
              key={category.id}
              style={styles.cardButton}
              onPress={() => router.push(category.route)}
            >
              <View
                style={[
                  styles.iconBox,
                  { backgroundColor: category.backgroundColor },
                ]}
              >
                <Ionicons
                  name={category.icon as keyof typeof Ionicons.glyphMap}
                  size={30}
                  color={category.iconColor}
                />
              </View>
              <Text style={styles.cardTitle}>{category.title}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}
