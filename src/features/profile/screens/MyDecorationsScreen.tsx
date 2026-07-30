import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavHeader } from '@/components/ui/nav-header';
import { Radius, Spacing, Typography, useTheme } from '@/theme';

const s = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  row: {
    minHeight: 84,
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {
    ...Typography.body,
    fontWeight: '700',
  },
  subtitle: {
    ...Typography.small,
    lineHeight: 18,
  },
});

export default function MyDecorationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      row: {
        backgroundColor: colors.surface,
        borderColor: colors.surfaceBorder,
      },
      title: { color: colors.text },
      subtitle: { color: colors.textSecondary },
    }),
    [colors],
  );

  const rows = [
    {
      key: 'badges',
      icon: 'ribbon-outline' as const,
      color: colors.brandPurple,
      title: t('profile.decorations.badges'),
      subtitle: t('profile.decorations.badgesSubtitle'),
      href: '/(tabs)/profile/icons',
    },
    {
      key: 'avatar-frames',
      icon: 'image-outline' as const,
      color: colors.blue,
      title: t('profile.decorations.avatarFrames'),
      subtitle: t('profile.decorations.avatarFramesSubtitle'),
      href: '/(tabs)/profile/avatar-frames',
    },
  ];

  return (
    <View style={[s.container, styles.container]}>
      <View style={{ paddingTop: insets.top }}>
        <NavHeader
          title={t('profile.decorations.title')}
          fallbackHref="/(tabs)/profile"
        />
      </View>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          s.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.xl) },
        ]}
      >
        {rows.map((row) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={row.title}
            accessibilityHint={row.subtitle}
            onPress={() => router.push(row.href as never)}
            style={({ pressed }) => [
              s.row,
              styles.row,
              pressed && { opacity: 0.72 },
            ]}
          >
            <View style={[s.icon, { backgroundColor: `${row.color}1A` }]}>
              <Ionicons name={row.icon} size={24} color={row.color} />
            </View>
            <View style={s.text}>
              <Text style={[s.title, styles.title]}>{row.title}</Text>
              <Text style={[s.subtitle, styles.subtitle]}>
                {row.subtitle}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
